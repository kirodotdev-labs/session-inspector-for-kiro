//! Persistent cache of per-execution-file dashboard summaries (cost,
//! timestamps, active time, model, per-action-type counts), keyed by
//! absolute file path + mtime + size.
//!
//! `compute_dashboard`'s IDE branch needs a handful of scalar fields out of
//! every execution file to compute aggregate stats — but without this cache
//! it would fully read and JSON-parse *every* execution file on *every*
//! dashboard load to get them. For a real install with a lot of history that
//! can be gigabytes of tool-call input/output data (which the dashboard
//! never looks at) on every single app launch. Caching the derived summary
//! here — keyed by (path, mtime, size) so a changed/rewritten file is
//! detected and re-parsed — means only genuinely new or modified execution
//! files pay that cost; everything else is a cheap in-memory lookup. Lives
//! in the same on-disk SQLite database as the search index, so the benefit
//! persists across app restarts, not just within a session.

use rusqlite::{params, Connection};
use std::collections::HashMap;

use crate::search::db;

#[derive(Debug, Clone, Default)]
pub struct ExecSummary {
    pub cost: f64,
    pub start_time: i64,
    pub active_ms: i64,
    pub model: String,
    /// actionType -> count (already excludes "intentClassification"/"model",
    /// which the dashboard doesn't chart).
    pub action_counts: HashMap<String, u64>,
}

pub(crate) struct CachedEntry {
    mtime_ms: i64,
    file_size: i64,
    summary: ExecSummary,
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ide_exec_cache (
            file_path    TEXT PRIMARY KEY,
            mtime_ms     INTEGER NOT NULL,
            file_size    INTEGER NOT NULL,
            cost         REAL NOT NULL DEFAULT 0,
            start_time   INTEGER NOT NULL DEFAULT 0,
            active_ms    INTEGER NOT NULL DEFAULT 0,
            model        TEXT NOT NULL DEFAULT '',
            actions_json TEXT NOT NULL DEFAULT '{}'
        );
        "#,
    )
    .map_err(|e| format!("migrate ide_exec_cache: {e}"))
}

/// A connection with `ide_exec_cache` guaranteed to exist. Cheap: opens the
/// same SQLite file the search index already lives in.
fn open() -> Result<Connection, String> {
    let conn = db::open()?;
    migrate(&conn)?;
    Ok(conn)
}

/// Loads the whole cache in one query, keyed by absolute file path, so the
/// dashboard's per-execution-file loop only needs cheap in-memory lookups
/// instead of a round trip per file. Returns an empty map (rather than
/// erroring) on any DB problem — worst case, everything just gets re-parsed
/// as if the cache were cold.
pub fn load_all() -> HashMap<String, CachedEntry> {
    let mut out = HashMap::new();
    let conn = match open() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("exec_cache: failed to open: {e}");
            return out;
        }
    };
    let mut stmt = match conn.prepare(
        "SELECT file_path, mtime_ms, file_size, cost, start_time, active_ms, model, actions_json
         FROM ide_exec_cache",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("exec_cache: failed to prepare load: {e}");
            return out;
        }
    };
    let rows = stmt.query_map([], |row| {
        let file_path: String = row.get(0)?;
        let mtime_ms: i64 = row.get(1)?;
        let file_size: i64 = row.get(2)?;
        let cost: f64 = row.get(3)?;
        let start_time: i64 = row.get(4)?;
        let active_ms: i64 = row.get(5)?;
        let model: String = row.get(6)?;
        let actions_json: String = row.get(7)?;
        Ok((file_path, mtime_ms, file_size, cost, start_time, active_ms, model, actions_json))
    });
    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            log::warn!("exec_cache: failed to query load: {e}");
            return out;
        }
    };
    for row in rows.flatten() {
        let (file_path, mtime_ms, file_size, cost, start_time, active_ms, model, actions_json) =
            row;
        let action_counts = serde_json::from_str(&actions_json).unwrap_or_default();
        out.insert(
            file_path,
            CachedEntry {
                mtime_ms,
                file_size,
                summary: ExecSummary {
                    cost,
                    start_time,
                    active_ms,
                    model,
                    action_counts,
                },
            },
        );
    }
    out
}

/// Returns the cached summary for `file_path` if present and still fresh
/// (mtime + size unchanged since it was cached).
pub fn get_fresh<'a>(
    cache: &'a HashMap<String, CachedEntry>,
    file_path: &str,
    mtime_ms: i64,
    file_size: i64,
) -> Option<&'a ExecSummary> {
    cache.get(file_path).and_then(|e| {
        if e.mtime_ms == mtime_ms && e.file_size == file_size {
            Some(&e.summary)
        } else {
            None
        }
    })
}

/// Batch-upserts new/changed entries in a single transaction. Called once
/// per `compute_dashboard` pass with everything that was freshly parsed
/// (i.e. wasn't already a fresh cache hit), rather than once per file.
pub fn save_all(entries: &[(String, i64, i64, ExecSummary)]) {
    if entries.is_empty() {
        return;
    }
    let mut conn = match open() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("exec_cache: failed to open for save: {e}");
            return;
        }
    };
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            log::warn!("exec_cache: failed to start transaction: {e}");
            return;
        }
    };
    {
        let mut stmt = match tx.prepare(
            "INSERT INTO ide_exec_cache
                (file_path, mtime_ms, file_size, cost, start_time, active_ms, model, actions_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(file_path) DO UPDATE SET
                mtime_ms = excluded.mtime_ms,
                file_size = excluded.file_size,
                cost = excluded.cost,
                start_time = excluded.start_time,
                active_ms = excluded.active_ms,
                model = excluded.model,
                actions_json = excluded.actions_json",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("exec_cache: failed to prepare save: {e}");
                return;
            }
        };
        for (file_path, mtime_ms, file_size, summary) in entries {
            let actions_json = serde_json::to_string(&summary.action_counts).unwrap_or_default();
            if let Err(e) = stmt.execute(params![
                file_path,
                mtime_ms,
                file_size,
                summary.cost,
                summary.start_time,
                summary.active_ms,
                summary.model,
                actions_json,
            ]) {
                log::warn!("exec_cache: failed to upsert {file_path}: {e}");
            }
        }
    }
    if let Err(e) = tx.commit() {
        log::warn!("exec_cache: failed to commit: {e}");
    }
}
