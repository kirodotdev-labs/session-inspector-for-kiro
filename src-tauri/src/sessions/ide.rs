use once_cell::sync::Lazy;
use serde::de::IgnoredAny;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use super::paths::Paths;
use super::types::{Action, HistoryMsg, SessionDetail, SessionSummary, Source, Workspace};
use super::util::{decode_base64_url, is_safe_path_component, sha256_hex_prefix};

// ---------------------------------------------------------------------------
// IDE sessions (Application Support/Kiro/.../workspace-sessions)
// Port of the IDE section of `server/index.ts`.
// ---------------------------------------------------------------------------

// Execution files live at
// `{globalStorage}/{sha256(workspacePath)[..32]}/{subdir}/{sha256(executionId)[..32]}`.
// They hold every tool call's full input/output, so a workspace's executions
// can add up to hundreds of MB on disk (and several times that once parsed
// into `serde_json::Value`). They are therefore loaded per session, only for
// the executions that session references, and never cached in memory.

/// Workspace execution subdirectories with their mtimes. A directory's mtime
/// changes whenever a file is added, removed, or renamed in it, which is what
/// invalidates `EXEC_ID_INDEX`.
fn exec_subdirs(ws_dir: &Path) -> Vec<(PathBuf, i64)> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(ws_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match fs::metadata(&path) {
                Ok(m) if m.is_dir() => m,
                _ => continue,
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push((path, mtime));
        }
    }
    out.sort();
    out
}

/// Reads one execution file, accepting it only if it is an execution record
/// (has `executionId` + `actions`) for `exec_id`.
fn read_execution(path: &Path, exec_id: &str) -> Option<Value> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() < 100 {
        return None;
    }
    let contents = fs::read_to_string(path).ok()?;
    let data: Value = serde_json::from_str(&contents).ok()?;
    if data.get("executionId").and_then(|v| v.as_str()) == Some(exec_id)
        && data.get("actions").is_some()
    {
        Some(data)
    } else {
        None
    }
}

/// Just enough of an execution file to learn its id; serde skips the
/// (large) `actions` contents instead of building them.
#[derive(Deserialize)]
struct ExecIdOnly {
    #[serde(rename = "executionId")]
    execution_id: Option<String>,
    actions: Option<IgnoredAny>,
}

/// Fallback `executionId -> file` index for a workspace, used only when an
/// execution isn't at its expected hashed file name. Holds ids and paths
/// only, so it stays small even for very large workspaces.
struct ExecIdIndex {
    subdirs: Vec<(PathBuf, i64)>,
    ids: HashMap<String, PathBuf>,
}

static EXEC_ID_INDEX: Lazy<Mutex<HashMap<PathBuf, ExecIdIndex>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn build_exec_id_index(subdirs: &[(PathBuf, i64)]) -> HashMap<String, PathBuf> {
    let mut ids = HashMap::new();
    for (dir, _) in subdirs {
        let files = match fs::read_dir(dir) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for file in files.flatten() {
            let path = file.path();
            match fs::metadata(&path) {
                Ok(m) if m.is_file() && m.len() >= 100 => {}
                _ => continue,
            }
            let contents = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Ok(ExecIdOnly {
                execution_id: Some(id),
                actions: Some(_),
            }) = serde_json::from_str::<ExecIdOnly>(&contents)
            {
                ids.insert(id, path);
            }
        }
    }
    ids
}

/// Loads the execution records for `exec_ids` (and only those) from a
/// workspace's execution directory.
fn load_executions(
    paths: &Paths,
    workspace_path: &str,
    exec_ids: &HashSet<&str>,
) -> HashMap<String, Value> {
    let mut map: HashMap<String, Value> = HashMap::new();
    if exec_ids.is_empty() {
        return map;
    }
    let ws_dir = paths.global_storage.join(sha256_hex_prefix(workspace_path, 32));
    let subdirs = exec_subdirs(&ws_dir);

    let mut missing: Vec<&str> = Vec::new();
    for &id in exec_ids {
        let file_name = sha256_hex_prefix(id, 32);
        match subdirs
            .iter()
            .find_map(|(dir, _)| read_execution(&dir.join(&file_name), id))
        {
            Some(data) => {
                map.insert(id.to_string(), data);
            }
            None => missing.push(id),
        }
    }
    if missing.is_empty() {
        return map;
    }

    // Some executions weren't at their hashed file name (or don't exist at
    // all). Find them through the light id index, rebuilt only when the
    // directory listing changed since it was last built.
    let found: Vec<(&str, PathBuf)> = {
        let mut cache = EXEC_ID_INDEX.lock().unwrap();
        let stale = cache.get(&ws_dir).map_or(true, |idx| idx.subdirs != subdirs);
        if stale {
            let ids = build_exec_id_index(&subdirs);
            cache.insert(ws_dir.clone(), ExecIdIndex { subdirs, ids });
        }
        let ids = &cache[&ws_dir].ids;
        missing
            .iter()
            .filter_map(|&id| ids.get(id).map(|p| (id, p.clone())))
            .collect()
    };
    for (id, path) in found {
        if let Some(data) = read_execution(&path, id) {
            map.insert(id.to_string(), data);
        }
    }
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
                workflow_id: None,
            })
            .collect();
        out.push(Workspace {
            id: format!("ide:{}", dir_name),
            source: Source::Ide,
            path: decoded_path,
            name: project_name,
            session_count: session_summaries.len(),
            sessions: session_summaries,
            workflows: Vec::new(),
        });
    }
    out
}

fn read_ide_session_file(
    paths: &Paths,
    workspace_id: &str,
    session_id: &str,
) -> Result<Value, String> {
    // `workspace_id` (a workspace directory name) and `session_id` are supplied
    // by the caller over IPC and interpolated into the path below; reject any
    // value that isn't a single benign path component to prevent traversal
    // outside the Kiro sessions directory (T-006).
    if !is_safe_path_component(workspace_id) {
        return Err(format!("invalid workspace id: {workspace_id}"));
    }
    if !is_safe_path_component(session_id) {
        return Err(format!("invalid session id: {session_id}"));
    }
    let session_file = paths
        .sessions_dir
        .join(workspace_id)
        .join(format!("{}.json", session_id));
    let contents = fs::read_to_string(&session_file).map_err(|e| e.to_string())?;
    serde_json::from_str(&contents).map_err(|e| e.to_string())
}

fn session_model(data: &Value) -> String {
    data.get("selectedModel")
        .and_then(|v| v.as_str())
        .or_else(|| data.get("defaultModelTitle").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

/// (role, text content) of one `history` entry.
fn history_entry_text(h: &Value) -> (String, String) {
    let msg = h.get("message");
    let content = match msg.and_then(|m| m.get("content")) {
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
    let role = msg
        .and_then(|m| m.get("role"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    (role, content)
}

/// The model and the (role, text) of each message of an IDE session, read
/// from the session file alone — without loading any execution files. For
/// callers (like the search indexer) that need only the conversation text,
/// not tool calls, costs, or timings.
pub fn get_ide_session_text(
    paths: &Paths,
    workspace_id: &str,
    session_id: &str,
) -> Result<(String, Vec<(String, String)>), String> {
    let data = read_ide_session_file(paths, workspace_id, session_id)?;
    let messages = data
        .get("history")
        .and_then(|v| v.as_array())
        .map(|hist| hist.iter().map(history_entry_text).collect())
        .unwrap_or_default();
    Ok((session_model(&data), messages))
}

pub fn get_ide_session(
    paths: &Paths,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionDetail, String> {
    let data = read_ide_session_file(paths, workspace_id, session_id)?;

    let workspace_path = data
        .get("workspaceDirectory")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let empty = Vec::new();
    let hist = data
        .get("history")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let exec_ids: HashSet<&str> = hist
        .iter()
        .filter_map(|h| h.get("executionId").and_then(|v| v.as_str()))
        .collect();
    let exec_map = load_executions(paths, &workspace_path, &exec_ids);

    let mut history: Vec<HistoryMsg> = Vec::new();
    for h in hist {
        let (role, content) = history_entry_text(h);

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
            role,
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

    // Active time: sum each turn's agent work (start → last emitted action),
    // which excludes idle gaps where the user steps away between turns.
    let mut seen_exec: HashSet<String> = HashSet::new();
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
        model: session_model(&data),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    const WS_PATH: &str = "/tmp/project";
    const WS_DIR_NAME: &str = "ws";

    fn temp_paths() -> Paths {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("kiro-ide-test-{}-{}", std::process::id(), n));
        let global_storage = root.join("globalStorage");
        Paths {
            sessions_dir: global_storage.join("workspace-sessions"),
            global_storage,
            cli_sessions_dir: root.join("cli"),
            cli_v3_sessions_dir: root.join("v3"),
        }
    }

    fn write_session(paths: &Paths, exec_ids: &[&str]) {
        let dir = paths.sessions_dir.join(WS_DIR_NAME);
        fs::create_dir_all(&dir).unwrap();
        let mut history = vec![json!({"message": {"role": "user", "content": "hello there"}})];
        for id in exec_ids {
            history.push(json!({
                "message": {"role": "assistant", "content": [{"type": "text", "text": format!("reply {id}")}]},
                "executionId": id,
            }));
        }
        let session = json!({
            "sessionId": "s1",
            "title": "Test",
            "selectedModel": "claude",
            "workspaceDirectory": WS_PATH,
            "history": history,
        });
        fs::write(dir.join("s1.json"), session.to_string()).unwrap();
    }

    fn write_execution(paths: &Paths, file_name: &str, exec_id: &str, cost: f64) {
        let dir = paths
            .global_storage
            .join(sha256_hex_prefix(WS_PATH, 32))
            .join("agent");
        fs::create_dir_all(&dir).unwrap();
        let exec = json!({
            "executionId": exec_id,
            "startTime": 1000,
            "usageSummary": [{"usage": cost}],
            "actions": [{"actionType": "readFiles", "actionState": "Success", "emittedAt": 1500,
                         "input": {"path": "src/main.rs"}, "output": {"padding": "x".repeat(100)}}],
        });
        fs::write(dir.join(file_name), exec.to_string()).unwrap();
    }

    #[test]
    fn loads_executions_by_hashed_file_name() {
        let paths = temp_paths();
        write_session(&paths, &["e1", "e2"]);
        write_execution(&paths, &sha256_hex_prefix("e1", 32), "e1", 1.5);
        write_execution(&paths, &sha256_hex_prefix("e2", 32), "e2", 2.0);
        // An unrelated execution in the same workspace must not be loaded.
        write_execution(&paths, &sha256_hex_prefix("other", 32), "other", 9.0);

        let d = get_ide_session(&paths, WS_DIR_NAME, "s1").unwrap();
        assert_eq!(d.history.len(), 3);
        assert_eq!(d.total_cost, 3.5);
        assert_eq!(d.history[1].actions.len(), 1);
        assert_eq!(d.history[1].actions[0].action_type, "readFiles");
        assert_eq!(d.duration_ms, Some(1000));
    }

    #[test]
    fn falls_back_to_id_scan_when_file_name_does_not_match() {
        let paths = temp_paths();
        write_session(&paths, &["e1", "missing"]);
        write_execution(&paths, "not-the-hashed-name", "e1", 1.25);

        let d = get_ide_session(&paths, WS_DIR_NAME, "s1").unwrap();
        assert_eq!(d.total_cost, 1.25);
        assert_eq!(d.history[1].actions.len(), 1);
        assert!(d.history[2].actions.is_empty(), "missing execution yields no actions");
    }

    #[test]
    fn session_text_matches_full_loader_without_executions() {
        let paths = temp_paths();
        write_session(&paths, &["e1"]);
        write_execution(&paths, &sha256_hex_prefix("e1", 32), "e1", 1.0);

        let (model, messages) = get_ide_session_text(&paths, WS_DIR_NAME, "s1").unwrap();
        let detail = get_ide_session(&paths, WS_DIR_NAME, "s1").unwrap();
        assert_eq!(model, detail.model);
        let full: Vec<(String, String)> = detail
            .history
            .iter()
            .map(|h| (h.role.clone(), h.content.clone()))
            .collect();
        assert_eq!(messages, full);
    }

    #[test]
    fn session_text_rejects_traversal() {
        let paths = temp_paths();
        assert!(get_ide_session_text(&paths, "..", "s1").is_err());
        assert!(get_ide_session_text(&paths, WS_DIR_NAME, "../s1").is_err());
    }
}
