//! SQLite connection + schema for the free-text session search index.
//!
//! The index is a self-contained SQLite database (with an FTS5 virtual table)
//! stored under the per-OS application-support directory, alongside the
//! analyses store:
//!   macOS:   ~/Library/Application Support/dev.kiro.sessions-inspector/search/index.sqlite
//!   Linux:   ~/.local/share/dev.kiro.sessions-inspector/search/index.sqlite
//!   Windows: %APPDATA%\dev.kiro.sessions-inspector\search\index.sqlite
//!
//! Because sessions may be deleted from disk *after* they have been indexed,
//! the index stores the message text itself (a content-full FTS5 table, not a
//! `content=''` external-content table). That keeps previously-indexed
//! sessions searchable even once their source files are gone.

use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

const APP_IDENTIFIER: &str = "dev.kiro.sessions-inspector";

/// Resolve (and create) the directory that holds the search index DB.
pub fn search_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or("cannot resolve application-support directory")?
        .join(APP_IDENTIFIER)
        .join("search");
    fs::create_dir_all(&base).map_err(|e| format!("cannot create {}: {e}", base.display()))?;
    Ok(base)
}

/// Absolute path to the search index SQLite file.
pub fn index_db_path() -> Result<PathBuf, String> {
    Ok(search_dir()?.join("index.sqlite"))
}

/// Open a connection to the index DB, applying pragmas + migrations. Every
/// caller (search queries, the indexer thread) opens its own connection;
/// SQLite in WAL mode allows concurrent readers alongside a single writer,
/// and connections are cheap. Writers are serialized in-process by the
/// indexer (see `super::index_incremental`).
pub fn open() -> Result<Connection, String> {
    let path = index_db_path()?;
    let conn = Connection::open(&path).map_err(|e| format!("cannot open index db: {e}"))?;
    // WAL: concurrent reads during indexing. busy_timeout: wait out a
    // concurrent writer rather than failing with SQLITE_BUSY.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("pragma journal_mode: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("pragma synchronous: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

/// Open an in-memory index DB (used by tests).
#[cfg(test)]
pub fn open_in_memory() -> Result<Connection, String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

/// Create tables if they don't exist. Idempotent; safe to run on every open.
fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        -- Per-session metadata: the source of truth for listing/filtering
        -- results. `on_disk` flips to 0 once a session's files disappear, but
        -- the row (and its FTS content) is retained so it stays searchable.
        CREATE TABLE IF NOT EXISTS sessions (
            session_id     TEXT PRIMARY KEY,
            source         TEXT NOT NULL,
            workspace_id   TEXT,
            workspace_path TEXT,
            title          TEXT,
            model          TEXT,
            date           INTEGER,
            updated_at     INTEGER,
            message_count  INTEGER NOT NULL DEFAULT 0,
            total_cost     REAL NOT NULL DEFAULT 0,
            on_disk        INTEGER NOT NULL DEFAULT 1,
            indexed_at     INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
        CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path);

        -- Incremental bookkeeping per session's primary file. For JSONL-backed
        -- CLI sources, `byte_offset` tracks how many bytes of complete lines
        -- we've consumed so appended content can be read without re-parsing
        -- the whole file (append-only fast path). For IDE, `fingerprint`
        -- (size+mtime) detects change and we re-extract fully.
        CREATE TABLE IF NOT EXISTS index_state (
            session_id  TEXT PRIMARY KEY,
            file_path   TEXT,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            file_size   INTEGER NOT NULL DEFAULT 0,
            mtime_ms    INTEGER NOT NULL DEFAULT 0,
            msg_count   INTEGER NOT NULL DEFAULT 0,
            fingerprint TEXT
        );

        -- Full-text index at message granularity. Content-full (stores the
        -- text) so deleted sessions remain searchable.
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            session_id UNINDEXED,
            role       UNINDEXED,
            msg_index  UNINDEXED,
            content,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        "#,
    )
    .map_err(|e| format!("migrate index db: {e}"))
}
