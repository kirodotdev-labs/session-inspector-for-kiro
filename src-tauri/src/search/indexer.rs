//! Builds and incrementally maintains the search index from on-disk sessions.
//!
//! Enumeration reuses the existing session loaders. Text extraction is
//! deliberately lightweight (role + searchable text only) rather than the full
//! `SessionDetail` parse: for CLI JSONL sources this lets us read only the
//! bytes appended since the last pass (append-only fast path). IDE sessions,
//! whose turns live across separate execution files, are re-extracted in full
//! via `get_ide_session` whenever their `session.json` fingerprint changes.

use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use crate::sessions::cli::load_all_cli_session_meta;
use crate::sessions::ide::{get_ide_session, list_ide_workspaces};
use crate::sessions::paths::Paths;

/// Cap on indexed text per message, so a single huge tool output can't bloat
/// the index unboundedly. Matches are still found; only the tail is dropped.
const MAX_MSG_CHARS: usize = 100_000;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    CliV2,
    CliV3,
    Ide,
}

/// A session discovered on disk, ready to be (incrementally) indexed.
struct Descriptor {
    session_id: String,
    source: &'static str,
    workspace_id: String,
    workspace_path: String,
    title: String,
    model: String,
    date: i64,
    updated_at: i64,
    total_cost: f64,
    /// The file whose (size, mtime) drives change detection. For CLI this is
    /// the append-only JSONL trace; for IDE it's the session json.
    primary_file: PathBuf,
    kind: Kind,
    /// IDE only: the workspace directory name (used to re-extract).
    ide_dir: Option<String>,
}

struct MsgRow {
    role: String,
    text: String,
}

fn base64_url_encode(input: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    URL_SAFE_NO_PAD.encode(input.as_bytes())
}

/// Wipe the entire index (used by full reindex).
pub fn clear(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM messages_fts; DELETE FROM index_state; DELETE FROM sessions;",
    )
    .map_err(|e| format!("clear index: {e}"))
}

/// Incrementally (or, when `force`, fully) index all on-disk sessions and mark
/// vanished sessions as archived.
pub fn run(conn: &Connection, paths: &Paths, force: bool) -> Result<(), String> {
    let descriptors = enumerate(paths);
    let mut seen: HashSet<String> = HashSet::new();

    for d in &descriptors {
        seen.insert(d.session_id.clone());
        if let Err(e) = index_one(conn, paths, d, force) {
            // Don't let one malformed session abort the whole pass.
            log::warn!("index session {} failed: {e}", d.session_id);
        }
    }

    mark_archived(conn, &seen)?;
    Ok(())
}

/// Enumerate all sessions across CLI (v2 + v3/unified) and IDE sources.
fn enumerate(paths: &Paths) -> Vec<Descriptor> {
    let mut out: Vec<Descriptor> = Vec::new();

    // CLI v2 + v3/unified.
    for m in load_all_cli_session_meta(paths) {
        if m.session_id.is_empty() {
            continue;
        }
        let date = if m.updated_at != 0 { m.updated_at } else { m.created_at };
        if m.version == 3 {
            let dir = match &m.v3_dir {
                Some(d) => d.clone(),
                None => continue,
            };
            out.push(Descriptor {
                session_id: m.session_id.clone(),
                source: "unified",
                workspace_id: format!("unified:{}", base64_url_encode(&m.cwd)),
                workspace_path: m.cwd.clone(),
                title: m.title.clone(),
                model: m.model.clone(),
                date,
                updated_at: m.updated_at,
                total_cost: m.total_cost,
                primary_file: dir.join("messages.jsonl"),
                kind: Kind::CliV3,
                ide_dir: None,
            });
        } else {
            out.push(Descriptor {
                session_id: m.session_id.clone(),
                source: "cli",
                workspace_id: format!("cli:{}", base64_url_encode(&m.cwd)),
                workspace_path: m.cwd.clone(),
                title: m.title.clone(),
                model: m.model.clone(),
                date,
                updated_at: m.updated_at,
                total_cost: m.total_cost,
                primary_file: paths
                    .cli_sessions_dir
                    .join(format!("{}.jsonl", m.session_id)),
                kind: Kind::CliV2,
                ide_dir: None,
            });
        }
    }

    // IDE.
    for ws in list_ide_workspaces(paths) {
        let dir_name = ws.id.strip_prefix("ide:").unwrap_or(&ws.id).to_string();
        for s in &ws.sessions {
            if s.id.is_empty() {
                continue;
            }
            out.push(Descriptor {
                session_id: s.id.clone(),
                source: "ide",
                workspace_id: ws.id.clone(),
                workspace_path: ws.path.clone(),
                title: s.title.clone(),
                model: String::new(), // filled in from the extracted detail
                date: s.date,
                updated_at: s.date,
                total_cost: 0.0,
                primary_file: paths.sessions_dir.join(&dir_name).join(format!("{}.json", s.id)),
                kind: Kind::Ide,
                ide_dir: Some(dir_name.clone()),
            });
        }
    }

    out
}

/// (size, mtime_ms) of a file, or None if it can't be stat'd.
fn stat(path: &PathBuf) -> Option<(i64, i64)> {
    let md = fs::metadata(path).ok()?;
    let size = md.len() as i64;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some((size, mtime))
}

/// Previously-recorded index state for a session, if any.
struct State {
    byte_offset: i64,
    file_size: i64,
    mtime_ms: i64,
    msg_count: i64,
    fingerprint: Option<String>,
}

fn load_state(conn: &Connection, session_id: &str) -> Option<State> {
    conn.query_row(
        "SELECT byte_offset, file_size, mtime_ms, msg_count, fingerprint
         FROM index_state WHERE session_id = ?1",
        params![session_id],
        |r| {
            Ok(State {
                byte_offset: r.get(0)?,
                file_size: r.get(1)?,
                mtime_ms: r.get(2)?,
                msg_count: r.get(3)?,
                fingerprint: r.get(4)?,
            })
        },
    )
    .ok()
}

fn index_one(
    conn: &Connection,
    paths: &Paths,
    d: &Descriptor,
    force: bool,
) -> Result<(), String> {
    let (size, mtime) = match stat(&d.primary_file) {
        Some(s) => s,
        // File missing (e.g. IDE session listed but body gone): skip; it'll be
        // handled as archived if it was previously indexed.
        None => return Ok(()),
    };
    let state = if force { None } else { load_state(conn, &d.session_id) };

    match d.kind {
        Kind::Ide => {
            let fingerprint = format!("{size}:{mtime}");
            if let Some(st) = &state {
                if st.fingerprint.as_deref() == Some(fingerprint.as_str()) {
                    return Ok(()); // unchanged
                }
            }
            // Changed (or new): re-extract fully.
            let (model, msgs) = extract_ide(paths, d)?;
            replace_messages(conn, &d.session_id, &msgs)?;
            let mut meta = d.clone_meta();
            if !model.is_empty() {
                meta.model = model;
            }
            upsert_session(conn, &meta, msgs.len() as i64)?;
            upsert_state(conn, &d.session_id, &d.primary_file, size, size, mtime, msgs.len() as i64, Some(&fingerprint))?;
        }
        Kind::CliV2 | Kind::CliV3 => {
            if let Some(st) = &state {
                if st.file_size == size && st.mtime_ms == mtime {
                    return Ok(()); // unchanged
                }
            }
            let prev_offset = state.as_ref().map(|s| s.byte_offset).unwrap_or(0);
            let prev_count = state.as_ref().map(|s| s.msg_count).unwrap_or(0);
            // Truncation / rewrite: offset points past EOF -> reindex from 0.
            let (start_offset, start_count, replacing) = if prev_offset > size {
                (0i64, 0i64, true)
            } else {
                (prev_offset, prev_count, false)
            };

            let raw = fs::read(&d.primary_file).map_err(|e| e.to_string())?;
            let (msgs, consumed) = extract_jsonl(&raw, start_offset as usize, d.kind);
            let new_offset = start_offset + consumed as i64;

            if replacing {
                delete_messages(conn, &d.session_id)?;
            }
            let inserted = append_messages(conn, &d.session_id, start_count, &msgs)?;
            let total_count = start_count + inserted;

            upsert_session(conn, d, total_count)?;
            upsert_state(
                conn,
                &d.session_id,
                &d.primary_file,
                new_offset,
                size,
                mtime,
                total_count,
                None,
            )?;
        }
    }
    Ok(())
}

impl Descriptor {
    /// Clone for mutation of derived metadata (IDE model backfill).
    fn clone_meta(&self) -> Descriptor {
        Descriptor {
            session_id: self.session_id.clone(),
            source: self.source,
            workspace_id: self.workspace_id.clone(),
            workspace_path: self.workspace_path.clone(),
            title: self.title.clone(),
            model: self.model.clone(),
            date: self.date,
            updated_at: self.updated_at,
            total_cost: self.total_cost,
            primary_file: self.primary_file.clone(),
            kind: self.kind,
            ide_dir: self.ide_dir.clone(),
        }
    }
}

/// Extract (model, messages) for an IDE session via the full loader.
fn extract_ide(paths: &Paths, d: &Descriptor) -> Result<(String, Vec<MsgRow>), String> {
    let dir = d.ide_dir.as_deref().unwrap_or("");
    let detail = get_ide_session(paths, dir, &d.session_id)?;
    let mut msgs = Vec::new();
    for h in &detail.history {
        push_history_msg(&mut msgs, &h.role, &h.content, &h.actions);
    }
    Ok((detail.model, msgs))
}

/// Flatten a normalized history message into searchable rows. Tool calls and
/// tool results are intentionally excluded from the index — only the user's
/// prompts and the assistant's replies are searchable.
fn push_history_msg(
    out: &mut Vec<MsgRow>,
    role: &str,
    content: &str,
    _actions: &[crate::sessions::types::Action],
) {
    if !content.trim().is_empty() {
        out.push(MsgRow { role: role.to_string(), text: cap(content) });
    }
}

/// Parse JSONL from `start` byte offset, returning extracted messages and the
/// number of bytes of *complete* (newline-terminated) lines consumed. A
/// partial trailing line (still being written) is left for the next pass.
fn extract_jsonl(raw: &[u8], start: usize, kind: Kind) -> (Vec<MsgRow>, usize) {
    if start >= raw.len() {
        return (Vec::new(), 0);
    }
    let slice = &raw[start..];
    // Only consume through the last newline; leave any trailing partial line.
    let last_nl = match slice.iter().rposition(|&b| b == b'\n') {
        Some(i) => i,
        None => return (Vec::new(), 0),
    };
    let complete = &slice[..=last_nl];
    let consumed = complete.len();
    let text = String::from_utf8_lossy(complete);

    let mut msgs = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let rec: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match kind {
            Kind::CliV3 => extract_v3_line(&rec, &mut msgs),
            Kind::CliV2 => extract_v2_line(&rec, &mut msgs),
            Kind::Ide => {}
        }
    }
    (msgs, consumed)
}

fn extract_v3_line(rec: &Value, out: &mut Vec<MsgRow>) {
    let p = rec.get("payload").cloned().unwrap_or(Value::Null);
    // Only user prompts and assistant replies are indexed; tool_call and
    // tool_result payloads are intentionally skipped.
    match p.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "user" => {
            if let Some(c) = p.get("content").and_then(|v| v.as_str()) {
                if !c.trim().is_empty() {
                    out.push(MsgRow { role: "user".into(), text: cap(c) });
                }
            }
        }
        "assistant" => {
            if let Some(c) = p.get("content").and_then(|v| v.as_str()) {
                if !c.trim().is_empty() {
                    out.push(MsgRow { role: "assistant".into(), text: cap(c) });
                }
            }
        }
        _ => {}
    }
}

fn extract_v2_line(rec: &Value, out: &mut Vec<MsgRow>) {
    let kind = rec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let content: Vec<Value> = rec
        .get("data")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    // Only user prompts and assistant text are indexed; tool uses (`toolUse`)
    // and `ToolResults` records are intentionally skipped.
    match kind {
        "Prompt" => {
            let text = content
                .iter()
                .filter(|c| c.get("kind").and_then(|v| v.as_str()) == Some("text"))
                .filter_map(|c| c.get("data").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.trim().is_empty() {
                out.push(MsgRow { role: "user".into(), text: cap(&text) });
            }
        }
        "AssistantMessage" => {
            let assistant_text = content
                .iter()
                .filter(|c| c.get("kind").and_then(|v| v.as_str()) == Some("text"))
                .filter_map(|c| c.get("data").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            if !assistant_text.trim().is_empty() {
                out.push(MsgRow { role: "assistant".into(), text: cap(&assistant_text) });
            }
        }
        _ => {}
    }
}

fn cap(s: &str) -> String {
    if s.len() <= MAX_MSG_CHARS {
        s.to_string()
    } else {
        // Cap on a char boundary at/below the byte limit.
        let mut end = MAX_MSG_CHARS;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        s[..end].to_string()
    }
}

// --- DB writes -------------------------------------------------------------

fn upsert_session(conn: &Connection, d: &Descriptor, message_count: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sessions
            (session_id, source, workspace_id, workspace_path, title, model,
             date, updated_at, message_count, total_cost, on_disk, indexed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11)
         ON CONFLICT(session_id) DO UPDATE SET
            source=excluded.source,
            workspace_id=excluded.workspace_id,
            workspace_path=excluded.workspace_path,
            title=excluded.title,
            model=CASE WHEN excluded.model != '' THEN excluded.model ELSE sessions.model END,
            date=excluded.date,
            updated_at=excluded.updated_at,
            message_count=excluded.message_count,
            total_cost=excluded.total_cost,
            on_disk=1,
            indexed_at=excluded.indexed_at",
        params![
            d.session_id,
            d.source,
            d.workspace_id,
            d.workspace_path,
            d.title,
            d.model,
            d.date,
            d.updated_at,
            message_count,
            d.total_cost,
            now_ms(),
        ],
    )
    .map_err(|e| format!("upsert session: {e}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn upsert_state(
    conn: &Connection,
    session_id: &str,
    file_path: &std::path::Path,
    byte_offset: i64,
    file_size: i64,
    mtime_ms: i64,
    msg_count: i64,
    fingerprint: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO index_state
            (session_id, file_path, byte_offset, file_size, mtime_ms, msg_count, fingerprint)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(session_id) DO UPDATE SET
            file_path=excluded.file_path,
            byte_offset=excluded.byte_offset,
            file_size=excluded.file_size,
            mtime_ms=excluded.mtime_ms,
            msg_count=excluded.msg_count,
            fingerprint=excluded.fingerprint",
        params![
            session_id,
            file_path.to_string_lossy(),
            byte_offset,
            file_size,
            mtime_ms,
            msg_count,
            fingerprint,
        ],
    )
    .map_err(|e| format!("upsert state: {e}"))?;
    Ok(())
}

fn delete_messages(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM messages_fts WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| format!("delete messages: {e}"))?;
    Ok(())
}

/// Replace all messages for a session (IDE full re-extract).
fn replace_messages(conn: &Connection, session_id: &str, msgs: &[MsgRow]) -> Result<(), String> {
    delete_messages(conn, session_id)?;
    append_messages(conn, session_id, 0, msgs)?;
    Ok(())
}

/// Insert messages starting at `start_index`; returns how many were inserted.
fn append_messages(
    conn: &Connection,
    session_id: &str,
    start_index: i64,
    msgs: &[MsgRow],
) -> Result<i64, String> {
    if msgs.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn
        .prepare_cached(
            "INSERT INTO messages_fts (session_id, role, msg_index, content)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .map_err(|e| format!("prepare insert: {e}"))?;
    for (idx, m) in (start_index..).zip(msgs.iter()) {
        stmt.execute(params![session_id, m.role, idx, m.text])
            .map_err(|e| format!("insert message: {e}"))?;
    }
    Ok(msgs.len() as i64)
}

/// Mark indexed sessions whose files are no longer on disk as archived (kept
/// searchable). Sessions still present are (re)set on_disk=1 by upsert.
fn mark_archived(conn: &Connection, seen: &HashSet<String>) -> Result<(), String> {
    // Gather currently on-disk session ids in the index.
    let mut stmt = conn
        .prepare("SELECT session_id FROM sessions WHERE on_disk = 1")
        .map_err(|e| format!("select on_disk: {e}"))?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| format!("query on_disk: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    for id in ids {
        if !seen.contains(&id) {
            conn.execute(
                "UPDATE sessions SET on_disk = 0 WHERE session_id = ?1",
                params![id],
            )
            .map_err(|e| format!("mark archived: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::db;
    use crate::search::query;
    use crate::search::SearchFilters;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn tmp_path(ext: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let name = format!("kiro-search-test-{}-{}.{}", std::process::id(), n, ext);
        std::env::temp_dir().join(name)
    }

    fn v3_desc(session_id: &str, file: PathBuf) -> Descriptor {
        Descriptor {
            session_id: session_id.to_string(),
            source: "unified",
            workspace_id: "unified:test".to_string(),
            workspace_path: "/tmp/ws".to_string(),
            title: "Test session".to_string(),
            model: "auto".to_string(),
            date: 1000,
            updated_at: 1000,
            total_cost: 0.0,
            primary_file: file,
            kind: Kind::CliV3,
            ide_dir: None,
        }
    }

    #[test]
    fn tool_calls_and_results_are_not_indexed() {
        let raw = concat!(
            "{\"payload\":{\"type\":\"user\",\"content\":\"run the build\"}}\n",
            "{\"payload\":{\"type\":\"tool_call\",\"toolName\":\"execute_bash\",\"args\":{\"command\":\"cargo build\"}}}\n",
            "{\"payload\":{\"type\":\"tool_result\",\"toolCallId\":\"t1\",\"content\":\"compiled ok\"}}\n",
            "{\"payload\":{\"type\":\"assistant\",\"content\":\"the build passed\"}}\n",
        );
        let (msgs, _) = extract_jsonl(raw.as_bytes(), 0, Kind::CliV3);
        // Only the user + assistant messages, no tool rows.
        assert_eq!(msgs.len(), 2);
        assert!(msgs.iter().all(|m| m.role == "user" || m.role == "assistant"));
        assert!(msgs.iter().all(|m| !m.text.contains("cargo build")));
        assert!(msgs.iter().all(|m| !m.text.contains("compiled ok")));
    }

    #[test]
    fn v2_tool_use_and_results_are_not_indexed() {
        let raw = concat!(
            "{\"kind\":\"Prompt\",\"data\":{\"content\":[{\"kind\":\"text\",\"data\":\"list files\"}]}}\n",
            "{\"kind\":\"AssistantMessage\",\"data\":{\"content\":[{\"kind\":\"text\",\"data\":\"sure\"},{\"kind\":\"toolUse\",\"data\":{\"name\":\"fs_read\",\"input\":{\"path\":\"/etc\"}}}]}}\n",
            "{\"kind\":\"ToolResults\",\"data\":{\"content\":[{\"kind\":\"toolResult\",\"data\":{\"content\":[{\"kind\":\"text\",\"data\":\"secret.txt\"}]}}]}}\n",
        );
        let (msgs, _) = extract_jsonl(raw.as_bytes(), 0, Kind::CliV2);
        assert_eq!(msgs.len(), 2, "only user prompt + assistant text");
        assert!(msgs.iter().all(|m| !m.text.contains("fs_read")));
        assert!(msgs.iter().all(|m| !m.text.contains("/etc")));
        assert!(msgs.iter().all(|m| !m.text.contains("secret.txt")));
    }

    #[test]
    fn extract_jsonl_only_consumes_complete_lines() {
        let l1 = "{\"payload\":{\"type\":\"user\",\"content\":\"hello there\"}}\n";
        let l2 = "{\"payload\":{\"type\":\"assistant\",\"content\":\"general kenobi\"}}";
        let raw = format!("{l1}{l2}"); // l2 has no trailing newline
        let (msgs, consumed) = extract_jsonl(raw.as_bytes(), 0, Kind::CliV3);
        // Only the newline-terminated first line is consumed.
        assert_eq!(consumed, l1.len());
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
        assert!(msgs[0].text.contains("hello"));
    }

    #[test]
    fn incremental_append_indexes_only_new_lines() {
        let file = tmp_path("jsonl");
        std::fs::write(
            &file,
            "{\"payload\":{\"type\":\"user\",\"content\":\"hello there\"}}\n",
        )
        .unwrap();

        let conn = db::open_in_memory().unwrap();
        let paths = crate::sessions::paths::resolve();
        let desc = v3_desc("sess-1", file.clone());

        index_one(&conn, &paths, &desc, false).unwrap();
        let st = load_state(&conn, "sess-1").unwrap();
        assert_eq!(st.msg_count, 1);
        let first_offset = st.byte_offset;
        assert!(first_offset > 0);

        // Append a new assistant line.
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&file).unwrap();
            f.write_all(b"{\"payload\":{\"type\":\"assistant\",\"content\":\"world domination\"}}\n")
                .unwrap();
        }
        index_one(&conn, &paths, &desc, false).unwrap();
        let st2 = load_state(&conn, "sess-1").unwrap();
        assert_eq!(st2.msg_count, 2, "should have appended exactly one message");
        assert!(st2.byte_offset > first_offset);

        // Both old and new content are searchable.
        let r1 = query::search(&conn, "hello", &SearchFilters::default(), 10, 0).unwrap();
        assert_eq!(r1.hits.len(), 1);
        assert!(r1.hits[0].on_disk);
        let r2 = query::search(&conn, "domination", &SearchFilters::default(), 10, 0).unwrap();
        assert_eq!(r2.hits.len(), 1);
        assert_eq!(r2.hits[0].match_count, 1);
        assert!(!r2.hits[0].snippets.is_empty());

        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn unchanged_file_is_skipped() {
        let file = tmp_path("jsonl");
        std::fs::write(
            &file,
            "{\"payload\":{\"type\":\"user\",\"content\":\"cached content\"}}\n",
        )
        .unwrap();
        let conn = db::open_in_memory().unwrap();
        let paths = crate::sessions::paths::resolve();
        let desc = v3_desc("sess-skip", file.clone());

        index_one(&conn, &paths, &desc, false).unwrap();
        let before = load_state(&conn, "sess-skip").unwrap();
        // Re-run without touching the file: state must be identical.
        index_one(&conn, &paths, &desc, false).unwrap();
        let after = load_state(&conn, "sess-skip").unwrap();
        assert_eq!(before.byte_offset, after.byte_offset);
        assert_eq!(before.msg_count, after.msg_count);

        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn deleted_session_is_archived_but_searchable() {
        let file = tmp_path("jsonl");
        std::fs::write(
            &file,
            "{\"payload\":{\"type\":\"user\",\"content\":\"persistent memory\"}}\n",
        )
        .unwrap();
        let conn = db::open_in_memory().unwrap();
        let paths = crate::sessions::paths::resolve();
        let desc = v3_desc("sess-del", file.clone());
        index_one(&conn, &paths, &desc, false).unwrap();

        // Simulate a full pass where this session is no longer on disk.
        let seen: HashSet<String> = HashSet::new();
        mark_archived(&conn, &seen).unwrap();

        let r = query::search(&conn, "persistent", &SearchFilters::default(), 10, 0).unwrap();
        assert_eq!(r.hits.len(), 1, "archived session stays searchable");
        assert!(!r.hits[0].on_disk, "should be flagged as not on disk");

        let stats = query::index_stats(&conn).unwrap();
        assert_eq!(stats.archived_count, 1);
        assert_eq!(stats.on_disk_count, 0);

        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn truncation_triggers_full_reindex() {
        let file = tmp_path("jsonl");
        std::fs::write(
            &file,
            "{\"payload\":{\"type\":\"user\",\"content\":\"alpha\"}}\n{\"payload\":{\"type\":\"assistant\",\"content\":\"beta\"}}\n",
        )
        .unwrap();
        let conn = db::open_in_memory().unwrap();
        let paths = crate::sessions::paths::resolve();
        let desc = v3_desc("sess-trunc", file.clone());
        index_one(&conn, &paths, &desc, false).unwrap();
        assert_eq!(load_state(&conn, "sess-trunc").unwrap().msg_count, 2);

        // Rewrite the file smaller (offset now past EOF) -> reindex from 0.
        std::fs::write(
            &file,
            "{\"payload\":{\"type\":\"user\",\"content\":\"gamma\"}}\n",
        )
        .unwrap();
        index_one(&conn, &paths, &desc, false).unwrap();
        let st = load_state(&conn, "sess-trunc").unwrap();
        assert_eq!(st.msg_count, 1, "rewritten file reindexed from scratch");

        // Old content gone, new content present.
        assert_eq!(
            query::search(&conn, "alpha", &SearchFilters::default(), 10, 0)
                .unwrap()
                .hits
                .len(),
            0
        );
        assert_eq!(
            query::search(&conn, "gamma", &SearchFilters::default(), 10, 0)
                .unwrap()
                .hits
                .len(),
            1
        );

        std::fs::remove_file(&file).ok();
    }
}
