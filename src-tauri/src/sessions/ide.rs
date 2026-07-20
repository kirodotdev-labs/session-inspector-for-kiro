use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

use super::paths::Paths;
use super::types::{Action, HistoryMsg, SessionDetail, SessionSummary, Source, Workspace};
use super::util::{decode_base64_url, sha256_hex_prefix};

// ---------------------------------------------------------------------------
// IDE sessions (Application Support/Kiro/.../workspace-sessions)
// Port of the IDE section of `server/index.ts`.
// ---------------------------------------------------------------------------

/// Cache execution lookups per workspace path, mirroring `executionCache` in
/// the TS server (a plain in-memory Map, no TTL there either).
static EXECUTION_CACHE: Lazy<Mutex<HashMap<String, HashMap<String, Value>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn load_executions_for_workspace(paths: &Paths, workspace_path: &str) -> HashMap<String, Value> {
    {
        let cache = EXECUTION_CACHE.lock().unwrap();
        if let Some(map) = cache.get(workspace_path) {
            return map.clone();
        }
    }

    let mut map: HashMap<String, Value> = HashMap::new();
    let ws_hash = sha256_hex_prefix(workspace_path, 32);
    let ws_dir = paths.global_storage.join(&ws_hash);

    if let Ok(entries) = fs::read_dir(&ws_dir) {
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
                let contents = match fs::read_to_string(&file_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let data: Value = match serde_json::from_str(&contents) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let (Some(exec_id), Some(_)) = (
                    data.get("executionId").and_then(|v| v.as_str()),
                    data.get("actions"),
                ) {
                    map.insert(exec_id.to_string(), data);
                }
            }
        }
    }

    EXECUTION_CACHE
        .lock()
        .unwrap()
        .insert(workspace_path.to_string(), map.clone());
    map
}

fn extract_actions(execution_data: &Value) -> Vec<Action> {
    let actions = match execution_data.get("actions").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return vec![],
    };
    actions
        .iter()
        .filter(|a| {
            let t = a.get("actionType").and_then(|v| v.as_str());
            matches!(t, Some(t) if t != "intentClassification" && t != "model")
        })
        .map(|a| Action {
            action_type: a
                .get("actionType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            raw_tool_name: None,
            action_state: a
                .get("actionState")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            input: a.get("input").cloned(),
            output: a.get("output").cloned(),
            sub_session_id: None,
        })
        .collect()
}

fn extract_cost_ide(execution_data: &Value) -> f64 {
    let summary = match execution_data.get("usageSummary").and_then(|v| v.as_array()) {
        Some(s) => s,
        None => return 0.0,
    };
    summary
        .iter()
        .map(|s| s.get("usage").and_then(|v| v.as_f64()).unwrap_or(0.0))
        .sum()
}

/// Active time for one IDE turn: from the execution start (≈ when the user
/// submitted) to the agent's last emitted action (its final response). Using
/// `emittedAt` — not `endTime` — avoids counting abort gaps and long-running
/// background processes whose end timestamps land hours/days later.
pub fn ide_active_ms(exec: &Value) -> i64 {
    let st = match exec.get("startTime").and_then(|v| v.as_i64()) {
        Some(s) => s,
        None => return 0,
    };
    let mut last_emit = st;
    if let Some(actions) = exec.get("actions").and_then(|v| v.as_array()) {
        for a in actions {
            if let Some(e) = a.get("emittedAt").and_then(|v| v.as_i64()) {
                if e > last_emit {
                    last_emit = e;
                }
            }
        }
    }
    if last_emit > st {
        last_emit - st
    } else {
        0
    }
}

pub fn list_ide_workspaces(paths: &Paths) -> Vec<Workspace> {
    let mut out = Vec::new();
    let dirs = match fs::read_dir(&paths.sessions_dir) {
        Ok(d) => d,
        Err(_) => return out,
    };
    for entry in dirs.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let sessions_file = path.join("sessions.json");
        let sessions: Vec<Value> = fs::read_to_string(&sessions_file)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();
        if sessions.is_empty() {
            continue;
        }
        let decoded_path = decode_base64_url(&dir_name);
        let project_name = decoded_path
            .split('/').rfind(|s| !s.is_empty())
            .unwrap_or(&dir_name)
            .to_string();
        let session_summaries: Vec<SessionSummary> = sessions
            .iter()
            .map(|s| SessionSummary {
                id: s
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                title: s
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                date: s
                    .get("dateCreated")
                    .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()))
                    .or_else(|| s.get("dateCreated").and_then(|v| v.as_i64()))
                    .unwrap_or(0),
                source: Source::Ide,
            })
            .collect();
        out.push(Workspace {
            id: format!("ide:{}", dir_name),
            source: Source::Ide,
            path: decoded_path,
            name: project_name,
            session_count: session_summaries.len(),
            sessions: session_summaries,
        });
    }
    out
}

pub fn get_ide_session(
    paths: &Paths,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionDetail, String> {
    let session_file = paths
        .sessions_dir
        .join(workspace_id)
        .join(format!("{}.json", session_id));
    let contents = fs::read_to_string(&session_file).map_err(|e| e.to_string())?;
    let data: Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    let workspace_path = data
        .get("workspaceDirectory")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let exec_map = load_executions_for_workspace(paths, &workspace_path);

    let mut history: Vec<HistoryMsg> = Vec::new();
    if let Some(hist) = data.get("history").and_then(|v| v.as_array()) {
        for h in hist {
            let msg = h.get("message").cloned().unwrap_or(Value::Null);
            let content = match msg.get("content") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Array(arr)) => arr
                    .iter()
                    .filter_map(|c| {
                        if c.get("type").and_then(|v| v.as_str()) == Some("text") {
                            c.get("text").and_then(|v| v.as_str())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            };

            let execution_id = h
                .get("executionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut actions = Vec::new();
            let mut cost = 0.0;
            if let Some(eid) = &execution_id {
                if let Some(exec_data) = exec_map.get(eid) {
                    actions = extract_actions(exec_data);
                    cost = extract_cost_ide(exec_data);
                }
            }

            let mut hist_msg = HistoryMsg {
                role: msg
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                execution_id,
                cost,
                ..Default::default()
            };
            // The IDE's own storage format doesn't preserve step-level
            // interleaving between this text and `actions` (they come from
            // two separate stores — `message.content` vs. a per-execution
            // actions log keyed only by `executionId`, with no shared
            // ordering field) — text-then-actions here just mirrors the
            // long-standing display order for this source.
            if !content.is_empty() {
                hist_msg.push_text(&content);
            }
            for action in actions {
                hist_msg.push_action(action);
            }
            hist_msg.finalize_blocks();
            history.push(hist_msg);
        }
    }

    // Active time: sum each turn's agent work (start → last emitted action),
    // which excludes idle gaps where the user steps away between turns.
    let mut seen_exec: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut duration_ms: i64 = 0;
    for h in &history {
        if let Some(eid) = &h.execution_id {
            if seen_exec.contains(eid) {
                continue;
            }
            seen_exec.insert(eid.clone());
            if let Some(exec_data) = exec_map.get(eid) {
                duration_ms += ide_active_ms(exec_data);
            }
        }
    }

    let total_cost: f64 = history.iter().map(|h| h.cost).sum();
    let message_count = history.len();

    Ok(SessionDetail {
        source: Source::Ide,
        session_id: data
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        title: data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        model: data
            .get("selectedModel")
            .and_then(|v| v.as_str())
            .or_else(|| data.get("defaultModelTitle").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        autonomy_mode: data
            .get("autonomyMode")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        session_type: data
            .get("sessionType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        context_usage: data
            .get("contextUsagePercentage")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        workspace_path,
        message_count,
        total_cost,
        duration_ms: Some(duration_ms),
        cli_version: None,
        history,
    })
}
