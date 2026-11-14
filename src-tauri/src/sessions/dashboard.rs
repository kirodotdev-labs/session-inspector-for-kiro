use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::time::UNIX_EPOCH;

use super::cli::load_all_cli_session_meta;
use super::workflow::{load_workflow_runs, run_workspace_path};
use super::exec_cache::{self, ExecSummary};
use super::paths::Paths;
use super::types::{DailyStats, DashboardData, Source, SourceStat, WorkspaceStat};
use super::util::{decode_base64_url, sha256_hex_prefix};

fn iso_date(ts_ms: i64) -> String {
    let dt = DateTime::<Utc>::from_timestamp_millis(ts_ms).unwrap_or_else(Utc::now);
    dt.format("%Y-%m-%d").to_string()
}

/// Minimal shape of an IDE execution file — just the handful of fields the
/// dashboard aggregates need. Any other keys (tool call `input`/`output`,
/// which for a real session history is the overwhelming majority of an
/// execution file's bytes — file contents, diffs, command output, etc.) are
/// skipped by serde during parsing rather than built into a `Value` tree,
/// which is what actually makes this cheaper than the old
/// `serde_json::from_str::<Value>` — that skipping avoids allocating owned
/// Rust values for content this call never looks at.
#[derive(Deserialize)]
struct RawExec {
    #[serde(rename = "executionId")]
    execution_id: Option<String>,
    #[serde(rename = "usageSummary")]
    usage_summary: Option<Vec<RawUsage>>,
    #[serde(rename = "startTime")]
    start_time: Option<i64>,
    actions: Option<Vec<RawAction>>,
    input: Option<RawInput>,
}

#[derive(Deserialize)]
struct RawUsage {
    usage: Option<f64>,
}

#[derive(Deserialize)]
struct RawAction {
    #[serde(rename = "actionType")]
    action_type: Option<String>,
    #[serde(rename = "emittedAt")]
    emitted_at: Option<i64>,
}

#[derive(Deserialize)]
struct RawInput {
    model: Option<String>,
}

/// Reads + parses one IDE execution file into just the fields
/// `compute_dashboard` needs. Mirrors the previous inline
/// `serde_json::Value`-based extraction (same "must have executionId and
/// actions keys" gate, same active-time definition, same excluded action
/// types) but via a targeted struct — see `RawExec`.
fn parse_exec_summary(contents: &str) -> Option<ExecSummary> {
    let raw: RawExec = serde_json::from_str(contents).ok()?;
    if raw.execution_id.is_none() || raw.actions.is_none() {
        return None;
    }
    let cost = raw
        .usage_summary
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|u| u.usage.unwrap_or(0.0))
        .sum();
    let start_time = raw.start_time.unwrap_or(0);
    let actions = raw.actions.unwrap_or_default();
    let mut last_emit = start_time;
    let mut action_counts: HashMap<String, u64> = HashMap::new();
    for a in &actions {
        if let Some(e) = a.emitted_at {
            if e > last_emit {
                last_emit = e;
            }
        }
        if let Some(t) = &a.action_type {
            if t != "intentClassification" && t != "model" {
                *action_counts.entry(t.clone()).or_insert(0) += 1;
            }
        }
    }
    let active_ms = if last_emit > start_time { last_emit - start_time } else { 0 };
    let model = raw
        .input
        .and_then(|i| i.model)
        .unwrap_or_else(|| "unknown".to_string());
    Some(ExecSummary {
        cost,
        start_time,
        active_ms,
        model,
        action_counts,
    })
}


/// Dashboard: aggregate stats across all workspaces and executions.
/// When `filter_path` is provided, only sessions/executions whose workspace
/// path (IDE) or cwd (CLI-family) match are included — used for the
/// per-workspace dashboard. When `source_filter` is provided, only that
/// source is aggregated — used for the Unified-only dashboard.
/// Direct port of `computeDashboard` in `server/index.ts`.
pub fn compute_dashboard(
    paths: &Paths,
    filter_path: Option<&str>,
    source_filter: Option<Source>,
) -> DashboardData {
    let mut daily_stats: HashMap<String, DailyStats> = HashMap::new();
    let mut model_usage: HashMap<String, f64> = HashMap::new();
    let mut workspace_stats: HashMap<String, WorkspaceStat> = HashMap::new();
    let mut session_types: HashMap<String, u64> = HashMap::new();
    let mut autonomy_modes: HashMap<String, u64> = HashMap::new();
    let mut model_sessions: HashMap<String, u64> = HashMap::new();
    let mut source_stats: HashMap<Source, SourceStat> = HashMap::new();
    source_stats.insert(Source::Ide, SourceStat::default());
    source_stats.insert(Source::Cli, SourceStat::default());
    source_stats.insert(Source::Unified, SourceStat::default());

    let mut total_cost = 0.0;
    let mut total_executions: u64 = 0;
    let mut total_sessions: u64 = 0;
    let mut total_duration: i64 = 0;

    fn bucket_daily(daily_stats: &mut HashMap<String, DailyStats>, ts_ms: i64) -> &mut DailyStats {
        let date = iso_date(ts_ms);
        daily_stats.entry(date.clone()).or_insert_with(|| DailyStats {
            date,
            ..Default::default()
        })
    }

    // --- IDE ---
    // Legacy IDE sessions are never Unified, so skip them entirely when the
    // dashboard is scoped to a different source.
    if source_filter.is_none() || source_filter == Some(Source::Ide) {
        // Loaded once up front (see `exec_cache`) so the per-execution-file
        // loop below can skip reading+parsing files that haven't changed
        // since the last dashboard computation — for a real install this is
        // the overwhelming majority of files, every time.
        let cached = exec_cache::load_all();
        let mut cache_updates: Vec<(String, i64, i64, ExecSummary)> = Vec::new();

        if let Ok(dirs) = fs::read_dir(&paths.sessions_dir) {
            for entry in dirs.flatten() {
                let dir_path = entry.path();
                if !dir_path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                let sessions_file = dir_path.join("sessions.json");
                let sessions: Vec<Value> = match fs::read_to_string(&sessions_file)
                    .ok()
                    .and_then(|c| serde_json::from_str(&c).ok())
                {
                    Some(v) => v,
                    None => continue,
                };
                if sessions.is_empty() {
                    continue;
                }

                let decoded_path = decode_base64_url(&dir_name);
                if let Some(fp) = filter_path {
                    if decoded_path != fp {
                        continue;
                    }
                }
                let project_name = decoded_path
                    .split('/').rfind(|s| !s.is_empty())
                    .unwrap_or(&dir_name)
                    .to_string();
                let ws_hash = sha256_hex_prefix(&decoded_path, 32);
                let ws_exec_dir = paths.global_storage.join(&ws_hash);

                total_sessions += sessions.len() as u64;
                source_stats.get_mut(&Source::Ide).unwrap().sessions += sessions.len() as u64;

                for s in &sessions {
                    let session_file = dir_path.join(format!(
                        "{}.json",
                        s.get("sessionId").and_then(|v| v.as_str()).unwrap_or("")
                    ));
                    if let Ok(contents) = fs::read_to_string(&session_file) {
                        if let Ok(s_data) = serde_json::from_str::<Value>(&contents) {
                            let model = s_data
                                .get("selectedModel")
                                .and_then(|v| v.as_str())
                                .or_else(|| s_data.get("defaultModelTitle").and_then(|v| v.as_str()))
                                .unwrap_or("unknown")
                                .to_string();
                            let s_type = s_data
                                .get("sessionType")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let a_mode = s_data
                                .get("autonomyMode")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            *model_sessions.entry(model).or_insert(0) += 1;
                            *session_types.entry(s_type).or_insert(0) += 1;
                            *autonomy_modes.entry(a_mode).or_insert(0) += 1;
                        }
                    }
                    let date_created = s
                        .get("dateCreated")
                        .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()))
                        .or_else(|| s.get("dateCreated").and_then(|v| v.as_i64()))
                        .unwrap_or(0);
                    let bucket = bucket_daily(&mut daily_stats, date_created);
                    bucket.sessions += 1;
                    bucket.ide_sessions += 1;
                }

                // Active time accumulator: sum of per-execution (end − start).
                let mut ws_duration: i64 = 0;

                if !ws_exec_dir.exists() {
                    workspace_stats.insert(
                        format!("ide:{}", project_name),
                        WorkspaceStat {
                            name: project_name,
                            cost: 0.0,
                            sessions: sessions.len() as u64,
                            executions: 0,
                            duration: 0,
                            source: Source::Ide,
                        },
                    );
                    continue;
                }

                let mut ws_cost = 0.0;
                let mut ws_execs: u64 = 0;
                if let Ok(entries) = fs::read_dir(&ws_exec_dir) {
                    for entry in entries.flatten() {
                        let sub_dir = entry.path();
                        if !sub_dir.is_dir() {
                            continue;
                        }
                        let files = match fs::read_dir(&sub_dir) {
                            Ok(f) => f,
                            Err(_) => continue,
                        };
                        for file in files.flatten() {
                            let file_path = file.path();
                            let meta = match fs::metadata(&file_path) {
                                Ok(m) => m,
                                Err(_) => continue,
                            };
                            if !meta.is_file() || meta.len() < 100 {
                                continue;
                            }
                            let file_size = meta.len() as i64;
                            let mtime_ms = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                            let path_key = file_path.to_string_lossy().to_string();

                            let summary = match exec_cache::get_fresh(
                                &cached, &path_key, mtime_ms, file_size,
                            ) {
                                Some(s) => s.clone(),
                                None => {
                                    let contents = match fs::read_to_string(&file_path) {
                                        Ok(c) => c,
                                        Err(_) => continue,
                                    };
                                    let s = match parse_exec_summary(&contents) {
                                        Some(s) => s,
                                        None => continue,
                                    };
                                    cache_updates.push((path_key, mtime_ms, file_size, s.clone()));
                                    s
                                }
                            };

                            ws_execs += 1;
                            total_executions += 1;
                            source_stats.get_mut(&Source::Ide).unwrap().executions += 1;
                            ws_cost += summary.cost;
                            total_cost += summary.cost;
                            source_stats.get_mut(&Source::Ide).unwrap().cost += summary.cost;

                            // Active turn time: start → last emitted agent action.
                            ws_duration += summary.active_ms;

                            let bucket = bucket_daily(&mut daily_stats, summary.start_time);
                            bucket.cost += summary.cost;
                            bucket.executions += 1;
                            bucket.ide_cost += summary.cost;
                            bucket.ide_executions += 1;
                            for (t, count) in &summary.action_counts {
                                *bucket.actions.entry(t.clone()).or_insert(0) += count;
                            }
                            *model_usage.entry(summary.model.clone()).or_insert(0.0) +=
                                summary.cost;
                        }
                    }
                }
                workspace_stats.insert(
                    format!("ide:{}", project_name),
                    WorkspaceStat {
                        name: project_name,
                        cost: ws_cost,
                        sessions: sessions.len() as u64,
                        executions: ws_execs,
                        duration: ws_duration,
                        source: Source::Ide,
                    },
                );
                total_duration += ws_duration;
            }
        }

        exec_cache::save_all(&cache_updates);
    }

    // --- CLI-family (legacy CLI v2 -> "cli", shared v3 format -> "unified") ---
    let cli_sessions = load_all_cli_session_meta(paths);
    struct CliWsAgg {
        name: String,
        source: Source,
        cost: f64,
        sessions: u64,
        executions: u64,
        duration: i64,
    }
    let mut cli_ws_agg: HashMap<String, CliWsAgg> = HashMap::new();

    for s in &cli_sessions {
        if let Some(fp) = filter_path {
            if s.cwd != fp {
                continue;
            }
        }
        let source = Source::for_cli_version(s.version);
        if let Some(sf) = source_filter {
            if sf != source {
                continue;
            }
        }

        total_sessions += 1;
        source_stats.get_mut(&source).unwrap().sessions += 1;

        *model_sessions.entry(s.model.clone()).or_insert(0) += 1;
        *session_types.entry(source.as_str().to_string()).or_insert(0) += 1;
        *autonomy_modes.entry(s.agent_name.clone()).or_insert(0) += 1;

        // Count every turn as one "execution" to stay comparable with the IDE side.
        total_executions += s.turn_count;
        source_stats.get_mut(&source).unwrap().executions += s.turn_count;
        total_cost += s.total_cost;
        source_stats.get_mut(&source).unwrap().cost += s.total_cost;
        *model_usage.entry(s.model.clone()).or_insert(0.0) += s.total_cost;

        let is_unified = source == Source::Unified;
        let created = if s.created_at != 0 {
            s.created_at
        } else if s.updated_at != 0 {
            s.updated_at
        } else {
            chrono::Utc::now().timestamp_millis()
        };
        {
            let created_bucket = bucket_daily(&mut daily_stats, created);
            created_bucket.sessions += 1;
            if is_unified {
                created_bucket.unified_sessions += 1;
            } else {
                created_bucket.cli_sessions += 1;
            }
        }
        // Attribute cost/executions to session's last update day.
        let updated = if s.updated_at != 0 { s.updated_at } else { created };
        {
            let bucket = bucket_daily(&mut daily_stats, updated);
            bucket.cost += s.total_cost;
            bucket.executions += s.turn_count;
            if is_unified {
                bucket.unified_cost += s.total_cost;
                bucket.unified_executions += s.turn_count;
            } else {
                bucket.cli_cost += s.total_cost;
                bucket.cli_executions += s.turn_count;
            }
        }

        let cwd = if s.cwd.is_empty() { "(unknown)" } else { &s.cwd };
        let project_name = cwd
            .split('/').rfind(|s| !s.is_empty())
            .unwrap_or("(unknown)")
            .to_string();
        let key = format!("{}:{}", source.as_str(), project_name);
        let dur = (s.updated_at - s.created_at).max(0);
        total_duration += dur;
        let entry = cli_ws_agg.entry(key).or_insert_with(|| CliWsAgg {
            name: project_name.clone(),
            source,
            cost: 0.0,
            sessions: 0,
            executions: 0,
            duration: 0,
        });
        entry.cost += s.total_cost;
        entry.sessions += 1;
        entry.executions += s.turn_count;
        entry.duration += dur;
    }

    for (key, agg) in cli_ws_agg {
        workspace_stats.insert(
            key,
            WorkspaceStat {
                name: agg.name,
                cost: agg.cost,
                sessions: agg.sessions,
                executions: agg.executions,
                duration: agg.duration,
                source: agg.source,
            },
        );
    }

    // --- Workflow runs (Unified only), attributed to workspaces the same way
    // the sidebar lists them. ---
    let total_workflows = if source_filter.is_none() || source_filter == Some(Source::Unified) {
        let cwd_by_session: HashMap<&str, &str> = cli_sessions
            .iter()
            .filter(|s| s.version == 3)
            .map(|s| (s.session_id.as_str(), s.cwd.as_str()))
            .collect();
        load_workflow_runs(paths, &cli_sessions)
            .iter()
            .filter(|r| match filter_path {
                Some(fp) => run_workspace_path(r, &cwd_by_session) == fp,
                None => true,
            })
            .count() as u64
    } else {
        0
    };

    let mut daily: Vec<DailyStats> = daily_stats.into_values().collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    let mut workspaces: Vec<WorkspaceStat> = workspace_stats.into_values().collect();
    workspaces.sort_by(|a, b| b.cost.partial_cmp(&a.cost).unwrap_or(std::cmp::Ordering::Equal));

    DashboardData {
        total_cost,
        total_sessions,
        total_executions,
        total_duration,
        total_workflows,
        daily,
        model_usage,
        model_sessions,
        session_types,
        autonomy_modes,
        workspaces,
        source_stats,
    }
}
