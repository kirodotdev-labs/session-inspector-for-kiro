//! Free-text search over Kiro sessions, backed by a persistent SQLite FTS5
//! index.
//!
//! Design notes:
//! - Sessions are effectively append-only logs. JSONL-backed CLI sources are
//!   indexed incrementally: we remember the byte offset of the last complete
//!   line consumed and only parse newly appended lines on subsequent passes.
//!   IDE sessions (whose content is spread across separate execution files)
//!   use a size+mtime fingerprint and are re-extracted fully when changed.
//! - Unchanged sessions cost a single `stat` per pass.
//! - Because sessions can be deleted from disk after indexing, indexed content
//!   is retained: when a session's files vanish, its row is marked
//!   `on_disk = 0` but stays searchable (snippets remain available).

pub mod db;
pub mod indexer;
pub mod query;

use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;

use crate::sessions::paths::Paths;

/// Serializes index writers within this process. Search reads don't take it
/// (WAL allows concurrent readers), but concurrent indexing passes / reindex
/// would otherwise race on the same rows.
static INDEX_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// One search result, grouped per session with its best matching snippets.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub source: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub title: String,
    pub model: String,
    pub date: i64,
    #[serde(rename = "onDisk")]
    pub on_disk: bool,
    /// BM25 score (lower is a better match in SQLite's bm25()).
    pub score: f64,
    #[serde(rename = "matchCount")]
    pub match_count: u32,
    /// Highlighted snippets (HTML `<mark>` markers) from top matching messages.
    pub snippets: Vec<Snippet>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snippet {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    /// Total distinct sessions matching the query (for pagination).
    pub total: u32,
    /// Echoes the effective query actually used (after sanitization), for UI
    /// debugging / empty-result messaging.
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct IndexStats {
    #[serde(rename = "sessionCount")]
    pub session_count: u64,
    #[serde(rename = "messageCount")]
    pub message_count: u64,
    #[serde(rename = "onDiskCount")]
    pub on_disk_count: u64,
    #[serde(rename = "archivedCount")]
    pub archived_count: u64,
    #[serde(rename = "lastIndexedAt")]
    pub last_indexed_at: Option<i64>,
}

/// Filters applied to a search.
#[derive(Debug, Clone, Default)]
pub struct SearchFilters {
    pub source: Option<String>,
    pub workspace_path: Option<String>,
}

/// Incrementally bring the index up to date with what's on disk. New/changed
/// sessions are indexed; sessions whose files disappeared are marked archived
/// (retained). Cheap for unchanged sessions. Serialized by `INDEX_LOCK`.
pub fn index_incremental(paths: &Paths) -> Result<IndexStats, String> {
    let _guard = INDEX_LOCK.lock().map_err(|_| "index lock poisoned")?;
    let conn = db::open()?;
    indexer::run(&conn, paths, false)?;
    query::index_stats(&conn)
}

/// Drop and rebuild the entire index from scratch. Serialized by `INDEX_LOCK`.
pub fn reindex_all(paths: &Paths) -> Result<IndexStats, String> {
    let _guard = INDEX_LOCK.lock().map_err(|_| "index lock poisoned")?;
    let conn = db::open()?;
    indexer::clear(&conn)?;
    indexer::run(&conn, paths, true)?;
    query::index_stats(&conn)
}

/// Run a free-text search. Does not require the lock (WAL concurrent read).
pub fn search(
    query_text: &str,
    filters: &SearchFilters,
    limit: u32,
    offset: u32,
) -> Result<SearchResults, String> {
    let conn = db::open()?;
    query::search(&conn, query_text, filters, limit, offset)
}

/// Current index statistics.
pub fn index_stats() -> Result<IndexStats, String> {
    let conn = db::open()?;
    query::index_stats(&conn)
}
