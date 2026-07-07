//! FTS5 query building + result assembly for session search.

use rusqlite::Connection;

use super::{IndexStats, SearchFilters, SearchHit, SearchResults, Snippet};

/// Max snippets returned per session.
const SNIPPETS_PER_SESSION: usize = 3;

/// Upper bound on ranked messages scanned per search. Bounds worst-case cost
/// for broad queries (e.g. a common short word) while still surfacing far more
/// sessions than a single page shows. Sessions ranked beyond this window for a
/// very broad query aren't returned — acceptable, since the top-ranked matches
/// are what users act on.
const MESSAGE_SCAN_LIMIT: usize = 800;

/// Turn arbitrary user text into a safe FTS5 MATCH expression.
///
/// Each run of word characters becomes a prefix term (`"term"*`). Text enclosed
/// in double quotes is kept intact as a single phrase and is *not* split on
/// spaces — it becomes a prefix phrase (`"multi word"*`), so the quoted words
/// must appear adjacently while still matching as the user types. Terms are
/// ANDed together. This avoids FTS5 syntax errors from stray operators (`AND`,
/// `-`, `:`, `(`, `*`) in free text and keeps behavior predictable. Returns
/// None if there is no searchable content.
pub fn build_match(input: &str) -> Option<String> {
    let mut terms: Vec<String> = Vec::new();
    // Normalize "smart"/typographic double quotes (which macOS text fields
    // often substitute for straight quotes) so quoted phrases are recognized
    // regardless of the quote glyph the webview produced.
    let normalized: String = input
        .chars()
        .map(|c| match c {
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' | '\u{2033}' | '\u{00AB}'
            | '\u{00BB}' => '"',
            other => other,
        })
        .collect();
    let mut chars = normalized.chars().peekable();

    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        if c == '"' {
            // Quoted phrase: consume everything up to the closing quote (or end
            // of input) verbatim, without breaking on spaces.
            chars.next();
            let mut phrase = String::new();
            while let Some(&pc) = chars.peek() {
                if pc == '"' {
                    chars.next();
                    break;
                }
                phrase.push(pc);
                chars.next();
            }
            let phrase = phrase.trim();
            if !phrase.is_empty() {
                // Prefix phrase: the enclosed words must be adjacent, and the
                // final word matches as a prefix (type-ahead friendly).
                terms.push(format!("\"{}\"*", escape(phrase)));
            }
        } else {
            // Bareword: consume until whitespace or a quote.
            let mut word = String::new();
            while let Some(&wc) = chars.peek() {
                if wc.is_whitespace() || wc == '"' {
                    break;
                }
                word.push(wc);
                chars.next();
            }
            let word = word.trim();
            if !word.is_empty() {
                // Prefix query so partial words match as the user types.
                terms.push(format!("\"{}\"*", escape(word)));
            }
        }
    }

    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Escape a string for use inside an FTS5 double-quoted token (double the `"`).
fn escape(s: &str) -> String {
    s.replace('"', "\"\"")
}

/// Build the source/workspace filter SQL fragment + bound params.
fn filter_sql(filters: &SearchFilters) -> (String, Vec<String>) {
    let mut sql = String::new();
    let mut binds: Vec<String> = Vec::new();
    if let Some(src) = &filters.source {
        if !src.is_empty() {
            sql.push_str(" AND s.source = ?");
            binds.push(src.clone());
        }
    }
    if let Some(path) = &filters.workspace_path {
        if !path.is_empty() {
            sql.push_str(" AND s.workspace_path = ?");
            binds.push(path.clone());
        }
    }
    (sql, binds)
}

pub fn search(
    conn: &Connection,
    query_text: &str,
    filters: &SearchFilters,
    limit: u32,
    offset: u32,
) -> Result<SearchResults, String> {
    let match_expr = match build_match(query_text) {
        Some(m) => m,
        None => {
            return Ok(SearchResults {
                hits: Vec::new(),
                total: 0,
                query: String::new(),
            })
        }
    };

    let (filter_frag, filter_binds) = filter_sql(filters);

    // Rank the top matching *messages* in a single FTS query (the inner
    // subquery uses FTS5's `ORDER BY bm25(...) LIMIT n` top-N optimization,
    // so we never materialize or sort every match — the previous approach's
    // slowness). The `LIMIT` also forces materialization, so joining for
    // metadata afterwards keeps `bm25()`/`snippet()` in a valid context.
    // Results are grouped into sessions in Rust below.
    let scan_limit = MESSAGE_SCAN_LIMIT as i64;
    let sql = format!(
        "SELECT t.session_id, t.role, t.score, t.snip,
                s.source, s.workspace_id, s.workspace_path, s.title, s.model,
                s.date, s.on_disk
         FROM (SELECT session_id, role,
                      bm25(messages_fts) AS score,
                      snippet(messages_fts, 3, '<mark>', '</mark>', '…', 12) AS snip
               FROM messages_fts
               WHERE messages_fts MATCH ?
               ORDER BY bm25(messages_fts)
               LIMIT ?) t
         JOIN sessions s ON s.session_id = t.session_id
         WHERE 1=1{filter_frag}
         ORDER BY t.score ASC"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut binds: Vec<&dyn rusqlite::ToSql> = vec![&match_expr, &scan_limit];
    for b in &filter_binds {
        binds.push(b);
    }

    struct MsgRow {
        session_id: String,
        role: String,
        score: f64,
        snip: String,
        source: String,
        workspace_id: String,
        workspace_path: String,
        title: String,
        model: String,
        date: i64,
        on_disk: bool,
    }

    let msg_rows: Vec<MsgRow> = stmt
        .query_map(binds.as_slice(), |r| {
            Ok(MsgRow {
                session_id: r.get(0)?,
                role: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                score: r.get(2)?,
                snip: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                source: r.get(4)?,
                workspace_id: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                workspace_path: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                title: r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                model: r.get::<_, Option<String>>(8)?.unwrap_or_default(),
                date: r.get::<_, Option<i64>>(9)?.unwrap_or(0),
                on_disk: r.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    // Group ranked messages into sessions, preserving best-first order. The
    // first row seen for a session is its best match (rows arrive sorted by
    // score), so it seeds the hit; later rows add snippets + match counts.
    let mut order: Vec<String> = Vec::new();
    let mut by_session: std::collections::HashMap<String, SearchHit> =
        std::collections::HashMap::new();
    for m in msg_rows {
        let entry = by_session.entry(m.session_id.clone()).or_insert_with(|| {
            order.push(m.session_id.clone());
            SearchHit {
                session_id: m.session_id.clone(),
                workspace_id: m.workspace_id,
                source: m.source,
                workspace_path: m.workspace_path,
                title: m.title,
                model: m.model,
                date: m.date,
                on_disk: m.on_disk,
                score: m.score,
                match_count: 0,
                snippets: Vec::new(),
            }
        });
        entry.match_count += 1;
        if entry.snippets.len() < SNIPPETS_PER_SESSION {
            entry.snippets.push(Snippet {
                role: m.role,
                text: m.snip,
            });
        }
    }

    let total = order.len() as u32;
    let hits: Vec<SearchHit> = order
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .filter_map(|id| by_session.remove(&id))
        .collect();

    Ok(SearchResults {
        hits,
        total,
        query: match_expr,
    })
}

pub fn index_stats(conn: &Connection) -> Result<IndexStats, String> {
    conn.query_row(
        "SELECT
            COUNT(*),
            COALESCE(SUM(message_count), 0),
            COALESCE(SUM(on_disk), 0),
            MAX(indexed_at)
         FROM sessions",
        [],
        |r| {
            let session_count: i64 = r.get(0)?;
            let message_count: i64 = r.get(1)?;
            let on_disk_count: i64 = r.get(2)?;
            let last_indexed_at: Option<i64> = r.get(3)?;
            Ok(IndexStats {
                session_count: session_count as u64,
                message_count: message_count as u64,
                on_disk_count: on_disk_count as u64,
                archived_count: (session_count - on_disk_count).max(0) as u64,
                last_indexed_at,
            })
        },
    )
    .map_err(|e| format!("index stats: {e}"))
}

#[cfg(test)]
mod tests {
    use super::build_match;
    use super::search;
    use crate::search::db;
    use crate::search::SearchFilters;
    use rusqlite::params;

    /// End-to-end against the *bundled* SQLite: index two messages and confirm
    /// a quoted phrase matches adjacency (and doesn't match reversed words).
    #[test]
    fn quoted_phrase_search_end_to_end() {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO sessions (session_id, source, on_disk, message_count) VALUES ('s1','unified',1,2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages_fts (session_id, role, msg_index, content) VALUES ('s1','user',0,?1)",
            params!["please help with the login error handling"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages_fts (session_id, role, msg_index, content) VALUES ('s1','assistant',1,?1)",
            params!["the error at login was noisy"],
        )
        .unwrap();

        // Adjacent phrase matches.
        let r = search(&conn, "\"login error\"", &SearchFilters::default(), 10, 0).unwrap();
        assert_eq!(r.hits.len(), 1, "quoted adjacent phrase should match");

        // Prefix phrase (still typing) matches.
        let r2 = search(&conn, "\"login err\"", &SearchFilters::default(), 10, 0).unwrap();
        assert_eq!(r2.hits.len(), 1, "quoted prefix phrase should match");

        // Reversed words as a phrase should NOT match (proves it's a phrase,
        // not space-split AND terms).
        let r3 = search(&conn, "\"error login\"", &SearchFilters::default(), 10, 0).unwrap();
        assert_eq!(r3.hits.len(), 0, "reversed quoted phrase must not match");
    }

    #[test]
    fn build_match_terms_are_prefix_and_anded() {
        assert_eq!(build_match("hello world").unwrap(), "\"hello\"* \"world\"*");
    }

    #[test]
    fn build_match_preserves_quoted_phrases() {
        // A quoted span is kept whole (not split on spaces) as a prefix phrase,
        // ANDed with any other bareword terms.
        assert_eq!(
            build_match("\"exact phrase\" foo").unwrap(),
            "\"exact phrase\"* \"foo\"*"
        );
    }

    #[test]
    fn build_match_quoted_multiword_is_single_phrase() {
        // The whole quoted term is one phrase — no space-splitting into ANDed
        // terms.
        let m = build_match("\"database connection pool\"").unwrap();
        assert_eq!(m, "\"database connection pool\"*");
    }

    #[test]
    fn build_match_normalizes_smart_quotes() {
        // macOS webviews substitute straight quotes with curly ones; they must
        // still be treated as phrase delimiters.
        assert_eq!(
            build_match("\u{201C}login error\u{201D}").unwrap(),
            "\"login error\"*"
        );
    }

    #[test]
    fn build_match_empty_or_punctuation_is_none() {
        assert!(build_match("").is_none());
        assert!(build_match("   ").is_none());
        // Punctuation-only still becomes a (harmless) prefix token, not an
        // FTS operator, so it never errors. Whitespace-only yields None.
        assert!(build_match("and").is_some());
    }

    #[test]
    fn build_match_never_produces_unbalanced_quotes() {
        // A stray double quote is treated as a phrase delimiter, so the output
        // must always have balanced quotes and never break FTS5 parsing.
        for input in ["foo\"bar", "a\"b\"c", "\"unclosed phrase", "he said \"hi\""] {
            let m = build_match(input).unwrap();
            let quotes = m.chars().filter(|&c| c == '"').count();
            assert_eq!(quotes % 2, 0, "unbalanced quotes for {input:?}: {m}");
        }
    }
}
