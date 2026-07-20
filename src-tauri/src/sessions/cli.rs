use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use super::paths::Paths;
use super::types::{Action, HistoryMsg, SessionDetail, SessionSummary, Source, Workspace};
use super::util::normalize_cli_tool_type;

// ---------------------------------------------------------------------------
// CLI sessions (~/.kiro/sessions/cli) + CLI v3 / Unified
// (~/.kiro/sessions/{workspaceHash}/sess_{id}/). Port of the CLI sections of
// `server/index.ts`.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct CliSessionMeta {
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub model: String,
    pub agent_name: String,
    pub context_usage: f64,
    pub total_cost: f64,
    pub turn_count: u64,
    pub version: u8,
    /// v3 only: directory containing session.json + messages.jsonl
    pub v3_dir: Option<PathBuf>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Best-effort ISO-8601 timestamp parse mirroring JS `Date.parse`. Returns 0
/// on failure like the TS server's `... ? Date.parse(...) : 0` pattern would
/// after a NaN (we treat NaN as 0 too, matching downstream arithmetic use).
fn parse_iso_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn load_cli_session_meta(file: &Path) -> Option<CliSessionMeta> {
    let contents = fs::read_to_string(file).ok()?;
    let data: Value = serde_json::from_str(&contents).ok()?;
    let ss = data.get("session_state").cloned().unwrap_or(Value::Null);
    let cm = ss
        .get("conversation_metadata")
        .cloned()
        .unwrap_or(Value::Null);
    let turns: Vec<Value> = cm
        .get("user_turn_metadatas")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut total_cost = 0.0;
    let mut last_ctx = 0.0;
    for t in &turns {
        if let Some(mu) = t.get("metering_usage").and_then(|v| v.as_array()) {
            for m in mu {
                total_cost += m.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
            }
        }
        if let Some(v) = t.get("context_usage_percentage").and_then(|v| v.as_f64()) {
            last_ctx = v;
        }
    }

    let created_at = data
        .get("created_at")
        .and_then(|v| v.as_str())
        .map(parse_iso_ms)
        .unwrap_or(0);
    let updated_at = data
        .get("updated_at")
        .and_then(|v| v.as_str())
        .map(parse_iso_ms)
        .unwrap_or(created_at);

    let context_usage = ss
        .get("rts_model_state")
        .and_then(|v| v.get("context_usage_percentage"))
        .and_then(|v| v.as_f64())
        .unwrap_or(last_ctx);

    Some(CliSessionMeta {
        session_id: data
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        title: data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        cwd: data.get("cwd").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        created_at,
        updated_at,
        model: ss
            .get("rts_model_state")
            .and_then(|v| v.get("model_info"))
            .and_then(|v| v.get("model_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("auto")
            .to_string(),
        agent_name: ss
            .get("agent_name")
            .and_then(|v| v.as_str())
            .unwrap_or("kiro_default")
            .to_string(),
        context_usage,
        total_cost,
        turn_count: turns.len() as u64,
        version: 2,
        v3_dir: None,
    })
}

/// Light scan of a v3 messages.jsonl for aggregate cost / turn count /
/// context usage, without building the full message history (used for the
/// workspace list + dashboard). Direct port of `scanCliV3Trace`.
fn scan_cli_v3_trace(messages_file: &Path) -> (f64, u64, f64) {
    let mut total_cost = 0.0;
    let mut turn_count: u64 = 0;
    let mut context_usage = 0.0;
    let raw = match fs::read_to_string(messages_file) {
        Ok(r) => r,
        Err(_) => return (total_cost, turn_count, context_usage),
    };
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let rec: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let p = rec.get("payload").cloned().unwrap_or(Value::Null);
        match p.get("type").and_then(|v| v.as_str()) {
            Some("turn_start") => turn_count += 1,
            Some("usage_summary") => {
                if let Some(arr) = p.get("promptTurnSummaries").and_then(|v| v.as_array()) {
                    for s in arr {
                        total_cost += s.get("usage").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    }
                }
            }
            Some("session_metadata") if p.get("key").and_then(|v| v.as_str()) == Some("contextUsage") => {
                if let Some(v) = p
                    .get("value")
                    .and_then(|v| v.get("usagePercentage"))
                    .and_then(|v| v.as_f64())
                {
                    context_usage = v;
                }
            }
            _ => {}
        }
    }
    (total_cost, turn_count, context_usage)
}

fn load_cli_v3_session_meta(session_dir: &Path) -> Option<CliSessionMeta> {
    let meta_file = session_dir.join("session.json");
    let contents = fs::read_to_string(&meta_file).ok()?;
    let data: Value = serde_json::from_str(&contents).ok()?;
    let id = data.get("id").and_then(|v| v.as_str())?;

    let cwd = data
        .get("workspacePaths")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let created_at = data
        .get("createdAt")
        .and_then(|v| v.as_str())
        .map(parse_iso_ms)
        .unwrap_or(0);
    let updated_at = data
        .get("lastModifiedAt")
        .and_then(|v| v.as_str())
        .map(parse_iso_ms)
        .unwrap_or(created_at);
    let (total_cost, turn_count, context_usage) =
        scan_cli_v3_trace(&session_dir.join("messages.jsonl"));

    let agent_name = if data.get("autopilot").and_then(|v| v.as_bool()).unwrap_or(false) {
        "Autopilot".to_string()
    } else {
        data.get("agentMode")
            .and_then(|v| v.as_str())
            .unwrap_or("Supervised")
            .to_string()
    };

    Some(CliSessionMeta {
        session_id: id.to_string(),
        title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        cwd,
        created_at,
        updated_at,
        model: data
            .get("modelId")
            .and_then(|v| v.as_str())
            .unwrap_or("auto")
            .to_string(),
        agent_name,
        context_usage,
        total_cost,
        turn_count,
        version: 3,
        v3_dir: Some(session_dir.to_path_buf()),
    })
}

fn load_all_cli_v3_session_meta(paths: &Paths) -> Vec<CliSessionMeta> {
    let mut out = Vec::new();
    let workspace_dirs = match fs::read_dir(&paths.cli_v3_sessions_dir) {
        Ok(d) => d,
        Err(_) => return out,
    };
    for wd in workspace_dirs.flatten() {
        let wd_path = wd.path();
        if !wd_path.is_dir() {
            continue;
        }
        let wd_name = wd.file_name().to_string_lossy().to_string();
        if wd_name == "cli" {
            continue; // v2 lives here — skip
        }
        let sess_entries = match fs::read_dir(&wd_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for se in sess_entries.flatten() {
            let se_path = se.path();
            let se_name = se.file_name().to_string_lossy().to_string();
            if !se_path.is_dir() || !se_name.starts_with("sess_") {
                continue;
            }
            if let Some(meta) = load_cli_v3_session_meta(&se_path) {
                out.push(meta);
            }
        }
    }
    out
}

const CLI_CACHE_TTL_MS: i64 = 30_000;

struct CliMetaCache {
    sessions: Vec<CliSessionMeta>,
    loaded_at: i64,
}

static CLI_META_CACHE: Lazy<Mutex<Option<CliMetaCache>>> = Lazy::new(|| Mutex::new(None));

pub fn load_all_cli_session_meta(paths: &Paths) -> Vec<CliSessionMeta> {
    // Held across the whole scan below (rather than released and
    // re-acquired around it) so that concurrent callers racing on a cold
    // cache — e.g. on startup, `list_workspaces` and `get_dashboard` both
    // fire near-simultaneously, plus the background cache-warmer in
    // `lib.rs` — block on this lock instead of each independently
    // performing a full filesystem walk + JSON/JSONL parse of every CLI
    // session file. The second+ caller through just gets the first
    // caller's freshly-populated cache.
    let mut cache = CLI_META_CACHE.lock().unwrap();
    if let Some(c) = cache.as_ref() {
        if now_ms() - c.loaded_at < CLI_CACHE_TTL_MS {
            return c.sessions.clone();
        }
    }

    let mut sessions = Vec::new();
    if let Ok(entries) = fs::read_dir(&paths.cli_sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Some(meta) = load_cli_session_meta(&path) {
                if !meta.session_id.is_empty() {
                    sessions.push(meta);
                }
            }
        }
    }
    for meta in load_all_cli_v3_session_meta(paths) {
        if !meta.session_id.is_empty() {
            sessions.push(meta);
        }
    }

    *cache = Some(CliMetaCache {
        sessions: sessions.clone(),
        loaded_at: now_ms(),
    });
    sessions
}

fn base64_url_encode(input: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    URL_SAFE_NO_PAD.encode(input.as_bytes())
}

/// CLI-family sessions live in two on-disk layouts:
/// - v2: a flat directory of {id}.json + {id}.jsonl files -> "cli" source.
/// - v3: the shared "unified" format (also written by the new IDE) -> "unified" source.
/// Grouped by (source, cwd) so v2 and v3 never merge, even when they share a cwd.
pub fn list_cli_workspaces(paths: &Paths) -> Vec<Workspace> {
    let sessions = load_all_cli_session_meta(paths);
    let mut by_source_cwd: HashMap<String, (Source, String, Vec<CliSessionMeta>)> = HashMap::new();

    for s in sessions {
        let source = Source::for_cli_version(s.version);
        let cwd = if s.cwd.is_empty() {
            "(unknown)".to_string()
        } else {
            s.cwd.clone()
        };
        let key = format!("{}|{}", source.as_str(), cwd);
        let entry = by_source_cwd
            .entry(key)
            .or_insert_with(|| (source, cwd.clone(), Vec::new()));
        entry.2.push(s);
    }

    let mut workspaces: Vec<Workspace> = by_source_cwd
        .into_values()
        .map(|(source, cwd, mut list)| {
            let name = cwd
                .split('/').rfind(|s| !s.is_empty())
                .unwrap_or(&cwd)
                .to_string();
            list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            let session_summaries: Vec<SessionSummary> = list
                .iter()
                .map(|s| SessionSummary {
                    id: s.session_id.clone(),
                    title: s.title.clone(),
                    date: if s.updated_at != 0 { s.updated_at } else { s.created_at },
                    source,
                })
                .collect();
            Workspace {
                id: format!("{}:{}", source.as_str(), base64_url_encode(&cwd)),
                source,
                path: cwd,
                name,
                session_count: session_summaries.len(),
                sessions: session_summaries,
            }
        })
        .collect();

    workspaces.sort_by(|a, b| b.session_count.cmp(&a.session_count));
    workspaces
}

/// Find a CLI session's metadata by id across both v2 and v3 sources.
fn find_cli_session_meta(paths: &Paths, session_id: &str) -> Option<CliSessionMeta> {
    load_all_cli_session_meta(paths)
        .into_iter()
        .find(|m| m.session_id == session_id)
}

pub fn get_cli_session(paths: &Paths, session_id: &str) -> Result<SessionDetail, String> {
    let meta = find_cli_session_meta(paths, session_id);
    match meta {
        Some(m) if m.version == 3 => get_cli_v3_session(&m),
        _ => get_cli_v2_session(paths, session_id),
    }
}

fn get_cli_v2_session(paths: &Paths, session_id: &str) -> Result<SessionDetail, String> {
    let meta_file = paths.cli_sessions_dir.join(format!("{}.json", session_id));
    let trace_file = paths.cli_sessions_dir.join(format!("{}.jsonl", session_id));

    let meta = load_cli_session_meta(&meta_file).ok_or_else(|| "not found".to_string())?;

    let mut history: Vec<HistoryMsg> = Vec::new();
    // (msgIndex, actionIndex) keyed by toolUseId
    let mut pending_tool_uses: HashMap<String, (usize, usize)> = HashMap::new();

    // Cost is per-turn (assistant's response). Map turns to assistant
    // messages in order.
    let turn_costs: Vec<f64> = {
        let raw_meta: Value = fs::read_to_string(&meta_file)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or(Value::Null);
        raw_meta
            .get("session_state")
            .and_then(|v| v.get("conversation_metadata"))
            .and_then(|v| v.get("user_turn_metadatas"))
            .and_then(|v| v.as_array())
            .map(|turns| {
                turns
                    .iter()
                    .map(|t| {
                        t.get("metering_usage")
                            .and_then(|v| v.as_array())
                            .map(|mu| {
                                mu.iter()
                                    .map(|m| m.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0))
                                    .sum()
                            })
                            .unwrap_or(0.0)
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut turn_idx = 0usize;

    if let Ok(raw) = fs::read_to_string(&trace_file) {
        for line in raw.lines() {
            if line.is_empty() {
                continue;
            }
            let record: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let kind = record.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let content: Vec<Value> = record
                .get("data")
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            match kind {
                "Prompt" => {
                    let text = content
                        .iter()
                        .filter(|c| c.get("kind").and_then(|v| v.as_str()) == Some("text"))
                        .filter_map(|c| c.get("data").and_then(|v| v.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n");
                    history.push(HistoryMsg {
                        role: "user".to_string(),
                        content: text,
                        ..Default::default()
                    });
                }
                "AssistantMessage" => {
                    let needs_new = match history.last() {
                        Some(last) if last.role == "assistant" => false,
                        _ => true,
                    };
                    if needs_new {
                        let cost = turn_costs.get(turn_idx).copied().unwrap_or(0.0);
                        turn_idx += 1;
                        history.push(HistoryMsg {
                            role: "assistant".to_string(),
                            cost,
                            ..Default::default()
                        });
                    }
                    let last_idx = history.len() - 1;
                    for c in &content {
                        let ck = c.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                        if ck == "text" {
                            if let Some(text) = c.get("data").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    history[last_idx].push_text(text);
                                }
                            }
                        } else if ck == "toolUse" {
                            let tu = c.get("data").cloned().unwrap_or(Value::Null);
                            let name = tu.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let input = tu.get("input").cloned().unwrap_or(json!({}));
                            let action_index = history[last_idx].push_action(Action {
                                action_type: normalize_cli_tool_type(name),
                                raw_tool_name: Some(name.to_string()),
                                action_state: Some("Pending".to_string()),
                                input: Some(input),
                                output: None,
                                sub_session_id: None,
                            });
                            if let Some(tool_use_id) = tu.get("toolUseId").and_then(|v| v.as_str()) {
                                pending_tool_uses
                                    .insert(tool_use_id.to_string(), (last_idx, action_index));
                            }
                        }
                    }
                }
                "ToolResults" => {
                    for c in &content {
                        if c.get("kind").and_then(|v| v.as_str()) != Some("toolResult") {
                            continue;
                        }
                        let tr = c.get("data").cloned().unwrap_or(Value::Null);
                        let tool_use_id = match tr.get("toolUseId").and_then(|v| v.as_str()) {
                            Some(id) => id.to_string(),
                            None => continue,
                        };
                        let (msg_idx, action_idx) = match pending_tool_uses.get(&tool_use_id) {
                            Some(&r) => r,
                            None => continue,
                        };
                        let action = match history
                            .get_mut(msg_idx)
                            .and_then(|m| m.actions.get_mut(action_idx))
                        {
                            Some(a) => a,
                            None => continue,
                        };
                        let status = tr.get("status").and_then(|v| v.as_str()).unwrap_or("");
                        action.action_state = Some(
                            match status {
                                "success" => "Success",
                                "error" => "Error",
                                other => other,
                            }
                            .to_string(),
                        );
                        // Flatten toolResult content into something compact for the UI.
                        let items: Vec<Value> = tr
                            .get("content")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let output_body = if items.len() == 1 {
                            let only = &items[0];
                            match only.get("kind").and_then(|v| v.as_str()) {
                                Some("json") => only.get("data").cloned(),
                                Some("text") => only.get("data").cloned(),
                                _ => Some(only.clone()),
                            }
                        } else if items.len() > 1 {
                            Some(Value::Array(
                                items
                                    .iter()
                                    .map(|it| {
                                        if it.get("kind").and_then(|v| v.as_str()) == Some("text") {
                                            it.get("data").cloned().unwrap_or(Value::Null)
                                        } else {
                                            it.clone()
                                        }
                                    })
                                    .collect(),
                            ))
                        } else {
                            None
                        };
                        action.output = output_body;
                        pending_tool_uses.remove(&tool_use_id);
                    }
                }
                _ => {}
            }
        }
    }

    for msg in history.iter_mut() {
        msg.finalize_blocks();
    }

    let message_count = history.len();
    Ok(SessionDetail {
        source: Source::Cli,
        session_id: meta.session_id,
        title: meta.title,
        model: meta.model,
        // CLI doesn't have Autopilot/Supervised; surface the agent instead.
        autonomy_mode: meta.agent_name,
        session_type: "cli".to_string(),
        context_usage: meta.context_usage,
        workspace_path: meta.cwd,
        message_count,
        total_cost: meta.total_cost,
        duration_ms: Some((meta.updated_at - meta.created_at).max(0)),
        cli_version: Some(2),
        history,
    })
}

/// Reads a JSONL file into its records, skipping blank/unparsable lines.
/// Both a top-level session's `messages.jsonl` and each sub-agent's own
/// `sub-executions/{subSessionId}.jsonl` use this format (identical record
/// envelope: `{"id", "timestamp", "payload": {"type": ..., ...}}`).
fn read_jsonl_records(path: &Path) -> Vec<Value> {
    let mut records = Vec::new();
    if let Ok(raw) = fs::read_to_string(path) {
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                records.push(v);
            }
        }
    }
    records
}

/// Builds the interleaved message thread from a v3 JSONL record stream.
/// Shared by `get_cli_v3_session` (the top-level session's `messages.jsonl`)
/// and `get_subagent_trace` (a sub-agent's own `sub-executions/*.jsonl`) —
/// same record shape, so the same parse applies to either.
fn parse_v3_records(records: &[Value]) -> Vec<HistoryMsg> {
    // Pass 1: cost per executionId from usage_summary records.
    let mut cost_by_exec: HashMap<String, f64> = HashMap::new();
    for rec in records {
        let p = rec.get("payload").cloned().unwrap_or(Value::Null);
        if p.get("type").and_then(|v| v.as_str()) == Some("usage_summary") {
            let mut c = 0.0;
            if let Some(arr) = p.get("promptTurnSummaries").and_then(|v| v.as_array()) {
                for s in arr {
                    c += s.get("usage").and_then(|v| v.as_f64()).unwrap_or(0.0);
                }
            }
            if let Some(eid) = p.get("executionId").and_then(|v| v.as_str()) {
                *cost_by_exec.entry(eid.to_string()).or_insert(0.0) += c;
            }
        }
    }

    // Pass 2: build the message thread.
    let mut history: Vec<HistoryMsg> = Vec::new();
    let mut tool_refs: HashMap<String, (usize, usize)> = HashMap::new();
    // subSessionId -> the "subagent" Action created by that sub-agent's
    // `sub_agent_start`, so the matching `sub_agent_complete` (which carries
    // the same subSessionId, not a toolCallId) can fill in its result.
    let mut sub_refs: HashMap<String, (usize, usize)> = HashMap::new();
    let mut cost_consumed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut cur_assistant_idx: Option<usize> = None;
    let mut cur_exec_id: Option<String> = None;

    // Direct port of `ensureAssistant` in server/index.ts: reuses the current
    // assistant message if it's still the last-pushed one and shares the
    // same executionId (both may be None), otherwise starts a new one and
    // attributes that execution's cost to it (once).
    fn ensure_assistant(
        history: &mut Vec<HistoryMsg>,
        cur_assistant_idx: &mut Option<usize>,
        cur_exec_id: &mut Option<String>,
        cost_by_exec: &HashMap<String, f64>,
        cost_consumed: &mut std::collections::HashSet<String>,
        exec_id: Option<String>,
    ) -> usize {
        if let Some(idx) = *cur_assistant_idx {
            if history.get(idx).map(|m| m.role.as_str()) == Some("assistant")
                && *cur_exec_id == exec_id
            {
                return idx;
            }
        }
        let mut cost = 0.0;
        if let Some(eid) = &exec_id {
            if !cost_consumed.contains(eid) {
                cost = cost_by_exec.get(eid).copied().unwrap_or(0.0);
                cost_consumed.insert(eid.clone());
            }
        }
        history.push(HistoryMsg {
            role: "assistant".to_string(),
            execution_id: exec_id.clone(),
            cost,
            ..Default::default()
        });
        let idx = history.len() - 1;
        *cur_assistant_idx = Some(idx);
        *cur_exec_id = exec_id;
        idx
    }

    for rec in records {
        let p = rec.get("payload").cloned().unwrap_or(Value::Null);
        let ptype = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let exec_id: Option<String> = p
            .get("executionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        match ptype {
            "user" => {
                let content = p.get("content").and_then(|v| v.as_str()).unwrap_or("");
                if content.trim().is_empty() {
                    continue;
                }
                history.push(HistoryMsg {
                    role: "user".to_string(),
                    content: content.to_string(),
                    ..Default::default()
                });
                cur_assistant_idx = None;
                cur_exec_id = None;
            }
            "assistant" => {
                let idx = ensure_assistant(
                    &mut history,
                    &mut cur_assistant_idx,
                    &mut cur_exec_id,
                    &cost_by_exec,
                    &mut cost_consumed,
                    exec_id.clone(),
                );
                if let Some(text) = p.get("content").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        history[idx].push_text(text);
                    }
                }
            }
            "tool_call" => {
                let idx = ensure_assistant(
                    &mut history,
                    &mut cur_assistant_idx,
                    &mut cur_exec_id,
                    &cost_by_exec,
                    &mut cost_consumed,
                    exec_id.clone(),
                );
                let name = p.get("toolName").and_then(|v| v.as_str()).unwrap_or("");
                let action_index = history[idx].push_action(Action {
                    action_type: normalize_cli_tool_type(name),
                    raw_tool_name: Some(name.to_string()),
                    action_state: Some("Pending".to_string()),
                    input: Some(p.get("args").cloned().unwrap_or(json!({}))),
                    output: None,
                    sub_session_id: None,
                });
                if let Some(tool_call_id) = p.get("toolCallId").and_then(|v| v.as_str()) {
                    tool_refs.insert(tool_call_id.to_string(), (idx, action_index));
                }
            }
            "tool_result" => {
                let tool_call_id = match p.get("toolCallId").and_then(|v| v.as_str()) {
                    Some(id) => id.to_string(),
                    None => continue,
                };
                let (msg_idx, action_idx) = match tool_refs.get(&tool_call_id) {
                    Some(&r) => r,
                    None => continue,
                };
                let action = match history
                    .get_mut(msg_idx)
                    .and_then(|m| m.actions.get_mut(action_idx))
                {
                    Some(a) => a,
                    None => continue,
                };
                let success = p.get("success").and_then(|v| v.as_bool());
                action.action_state = Some(if success == Some(false) { "Error" } else { "Success" }.to_string());
                let body = p.get("content").cloned().unwrap_or(Value::Null);
                let parsed_body = if let Value::String(s) = &body {
                    serde_json::from_str::<Value>(s).unwrap_or(body.clone())
                } else {
                    body
                };
                action.output = Some(parsed_body);
                tool_refs.remove(&tool_call_id);
            }
            "sub_agent_start" => {
                let parent_exec_id = p
                    .get("parentExecutionId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| exec_id.clone());
                let idx = ensure_assistant(
                    &mut history,
                    &mut cur_assistant_idx,
                    &mut cur_exec_id,
                    &cost_by_exec,
                    &mut cost_consumed,
                    parent_exec_id,
                );
                let sub_agent_name = p.get("subAgentName").and_then(|v| v.as_str()).unwrap_or("");
                let sub_session_id = p
                    .get("subSessionId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let action_index = history[idx].push_action(Action {
                    action_type: "subagent".to_string(),
                    raw_tool_name: Some(
                        if sub_agent_name.is_empty() {
                            "invoke_sub_agent".to_string()
                        } else {
                            sub_agent_name.to_string()
                        },
                    ),
                    // Filled in by the matching `sub_agent_complete` below;
                    // stays "Pending" if the sub-agent is still running or
                    // its completion record is missing (e.g. crash mid-run).
                    action_state: Some("Pending".to_string()),
                    input: Some(json!({
                        "subAgentName": p.get("subAgentName").cloned().unwrap_or(Value::Null),
                        "prompt": p.get("prompt").cloned().unwrap_or(Value::Null),
                    })),
                    output: None,
                    sub_session_id: sub_session_id.clone(),
                });
                if let Some(sid) = sub_session_id {
                    sub_refs.insert(sid, (idx, action_index));
                }
            }
            "sub_agent_complete" => {
                let sub_session_id = match p.get("subSessionId").and_then(|v| v.as_str()) {
                    Some(id) => id.to_string(),
                    None => continue,
                };
                let (msg_idx, action_idx) = match sub_refs.get(&sub_session_id) {
                    Some(&r) => r,
                    None => continue,
                };
                let action = match history
                    .get_mut(msg_idx)
                    .and_then(|m| m.actions.get_mut(action_idx))
                {
                    Some(a) => a,
                    None => continue,
                };
                let status = p.get("status").and_then(|v| v.as_str()).unwrap_or("success");
                action.action_state = Some(if status == "error" { "Error" } else { "Success" }.to_string());
                action.output = Some(json!({
                    "response": p.get("response").cloned().unwrap_or(Value::Null),
                    "errorMessage": p.get("errorMessage").cloned().unwrap_or(Value::Null),
                }));
                sub_refs.remove(&sub_session_id);
            }
            _ => {}
        }
    }

    for msg in history.iter_mut() {
        msg.finalize_blocks();
    }
    history
}

fn get_cli_v3_session(meta: &CliSessionMeta) -> Result<SessionDetail, String> {
    let messages_file = meta
        .v3_dir
        .as_ref()
        .map(|d| d.join("messages.jsonl"))
        .unwrap_or_default();
    let records = read_jsonl_records(&messages_file);
    let history = parse_v3_records(&records);
    let message_count = history.len();
    Ok(SessionDetail {
        source: Source::Unified,
        session_id: meta.session_id.clone(),
        title: meta.title.clone(),
        model: meta.model.clone(),
        autonomy_mode: meta.agent_name.clone(),
        session_type: "unified".to_string(),
        context_usage: meta.context_usage,
        workspace_path: meta.cwd.clone(),
        message_count,
        total_cost: meta.total_cost,
        duration_ms: Some((meta.updated_at - meta.created_at).max(0)),
        cli_version: None,
        history,
    })
}

/// Loads a sub-agent's own transcript — a self-contained mini-session
/// written to `{sessionDir}/sub-executions/{subSessionId}.jsonl` by the spec
/// agent (or any agent using `invoke_subagent`-style dispatch) whenever it
/// hands a task off to a named sub-agent (e.g. `spec-task-execution`). Not
/// nested inside the parent's own `messages.jsonl` — a fully separate file,
/// linked only by the `subSessionId` captured on the parent's "subagent"
/// `Action` (see `sub_agent_start` above).
pub fn get_subagent_trace(
    paths: &Paths,
    session_id: &str,
    sub_session_id: &str,
) -> Result<SessionDetail, String> {
    let meta = find_cli_session_meta(paths, session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;
    let v3_dir = meta
        .v3_dir
        .clone()
        .ok_or_else(|| "sub-agent traces only exist for Unified (v3) sessions".to_string())?;
    let trace_file = v3_dir.join("sub-executions").join(format!("{sub_session_id}.jsonl"));
    if !trace_file.exists() {
        return Err(format!("sub-agent trace not found: {}", trace_file.display()));
    }
    let records = read_jsonl_records(&trace_file);
    let history = parse_v3_records(&records);
    let total_cost: f64 = history.iter().map(|m| m.cost).sum();
    let message_count = history.len();
    Ok(SessionDetail {
        source: Source::Unified,
        session_id: sub_session_id.to_string(),
        title: format!("Sub-agent of {}", meta.title),
        model: meta.model.clone(),
        autonomy_mode: meta.agent_name.clone(),
        session_type: "unified".to_string(),
        context_usage: 0.0,
        workspace_path: meta.cwd.clone(),
        message_count,
        total_cost,
        duration_ms: None,
        cli_version: None,
        history,
    })
}
