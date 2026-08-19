//! A dependency-free MCP server over stdio.
//!
//! MCP's stdio transport is newline-delimited JSON-RPC 2.0: each message is a
//! single line of JSON on stdin, each response a single line on stdout.
//! Diagnostics must go to stderr so they don't corrupt the protocol stream.
//! We implement just the surface kiro-cli's client needs: `initialize`,
//! `notifications/initialized`, `tools/list`, `tools/call`, and `ping`.
//!
//! Every tool is read-only and returns *optimized* session signals (see the
//! `analysis` module) — never raw tool calls/results. The lone exception is
//! `get_user_prompts`, which returns the user's own prompt text so the
//! analyst can quote directives verbatim.
//!
//! The one write capability, `write_report`, is deliberately narrow: it
//! takes only a `name` (sanitized to a bare filename) and `content`, never a
//! path, and it only ever writes inside a directory the orchestrator created
//! for this run and handed to this process via `KIRO_INSPECTOR_REPORT_DIR`.
//! This replaces the previous design of granting the analyst agent the
//! general-purpose `fs_write` tool, which could write to any path a
//! prompt-injected model chose.

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

use crate::analysis::{self, Window};
use crate::sessions::paths;

/// Env var the orchestrator sets (only when it spawns this process as the
/// `sessions` MCP server for an analysis run) naming the one directory
/// `write_report` is allowed to write into. Never settable by the model.
pub(crate) const REPORT_DIR_ENV: &str = "KIRO_INSPECTOR_REPORT_DIR";

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "kiro-sessions-analyst";

/// Blocking read/serve loop. Returns when stdin closes (kiro-cli exits).
pub fn serve() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                // Can't recover an id from an unparseable line; report a
                // generic parse error per JSON-RPC.
                write_message(
                    &mut stdout,
                    &error_response(Value::Null, -32700, &format!("Parse error: {e}")),
                );
                continue;
            }
        };

        // Notifications carry no `id` and expect no response.
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "initialize" => {
                write_message(&mut stdout, &result_response(id, initialize_result()));
            }
            "notifications/initialized" | "initialized" => {
                // Notification: no response.
            }
            "ping" => {
                write_message(&mut stdout, &result_response(id, json!({})));
            }
            "tools/list" => {
                write_message(&mut stdout, &result_response(id, json!({ "tools": tool_specs() })));
            }
            "tools/call" => match handle_tool_call(&params) {
                Ok(content) => {
                    write_message(
                        &mut stdout,
                        &result_response(id, json!({ "content": [text_content(&content)] })),
                    );
                }
                Err(msg) => {
                    // Tool errors are reported as a result with isError=true so
                    // the model can read them, per MCP convention.
                    write_message(
                        &mut stdout,
                        &result_response(
                            id,
                            json!({
                                "content": [text_content(&msg)],
                                "isError": true
                            }),
                        ),
                    );
                }
            },
            other if id.is_some() => {
                write_message(
                    &mut stdout,
                    &error_response(id.unwrap(), -32601, &format!("Method not found: {other}")),
                );
            }
            _ => {
                // Unknown notification: ignore.
            }
        }
    }
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": "Read-only Kiro session analytics. Tools return aggregated, privacy-preserving signals (tool success/failure counts and coarse error categories) — never raw tool inputs/outputs. Start with get_overview(window), then drill into notable sessions with get_session_stats and quote the user via get_user_prompts."
    })
}

fn tool_specs() -> Value {
    let window_prop = json!({
        "type": "string",
        "enum": ["day", "week", "month"],
        "description": "Time window to analyze: last day, week (7d) or month (30d)."
    });
    json!([
        {
            "name": "get_overview",
            "description": "Aggregate optimized stats for the window: session/message/turn counts, active days, cost, per-tool success/failure counts, error-category frequencies, models, autonomy modes, and the most failure-heavy sessions. No raw tool inputs/outputs.",
            "inputSchema": {
                "type": "object",
                "properties": { "window": window_prop },
                "required": ["window"]
            }
        },
        {
            "name": "list_sessions",
            "description": "Lightweight per-session rows for the window (id, title, workspace, date, turns, cost, tool calls/failures, failure rate, top tools, error categories). No raw content.",
            "inputSchema": {
                "type": "object",
                "properties": { "window": window_prop },
                "required": ["window"]
            }
        },
        {
            "name": "get_session_stats",
            "description": "Full per-tool success/failure breakdown and error categories for a single session id. Use to dig into a pattern surfaced by get_overview. No raw content.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string", "description": "Session id from get_overview/list_sessions." }
                },
                "required": ["sessionId"]
            }
        },
        {
            "name": "get_user_prompts",
            "description": "The user's own prompt text for one session (never tool call/result data), so you can quote directives verbatim. Each prompt is truncated to maxChars.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sessionId": { "type": "string" },
                    "maxChars": { "type": "integer", "description": "Max characters per prompt (default 500, capped 2000)." }
                },
                "required": ["sessionId"]
            }
        },
        {
            "name": "write_report",
            "description": "Append content to the analysis report for this run. Takes ONLY a report `name` and a `content` chunk — there is no path/destination argument. `name` is sanitized to a bare filename (any path structure is stripped, unsafe characters are dropped) and a `.html` extension is applied automatically. Call this repeatedly with the SAME `name` to build up a large document across multiple calls (each call appends); the first call creates the file. Writes exclusively inside a fixed directory this app created for this run — it is not possible to write anywhere else on disk.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Report name, e.g. \"report\". Used only to derive the output filename (sanitized; `.html` added automatically) — not a path."
                    },
                    "content": {
                        "type": "string",
                        "description": "HTML content to append to the report file."
                    }
                },
                "required": ["name", "content"]
            }
        }
    ])
}

fn handle_tool_call(params: &Value) -> Result<String, String> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("missing tool name")?;
    let args = params.get("arguments").cloned().unwrap_or(json!({}));
    let paths = paths::resolve();

    let value: Value = match name {
        "get_overview" => {
            let w = parse_window(&args)?;
            serde_json::to_value(analysis::compute_overview(&paths, w)).map_err(|e| e.to_string())?
        }
        "list_sessions" => {
            let w = parse_window(&args)?;
            serde_json::to_value(analysis::list_session_rows(&paths, w)).map_err(|e| e.to_string())?
        }
        "get_session_stats" => {
            let id = args
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or("missing sessionId")?;
            match analysis::session_stats(&paths, id) {
                Some(s) => serde_json::to_value(s).map_err(|e| e.to_string())?,
                None => return Err(format!("session not found: {id}")),
            }
        }
        "get_user_prompts" => {
            let id = args
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or("missing sessionId")?;
            let max = args
                .get("maxChars")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            match analysis::user_prompts(&paths, id, max) {
                Some(p) => serde_json::to_value(p).map_err(|e| e.to_string())?,
                None => return Err(format!("session not found: {id}")),
            }
        }
        "write_report" => {
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or("missing name")?;
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or("missing content")?;
            let (path, bytes) = write_report(name, content)?;
            json!({
                "fileName": path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                "bytesWritten": bytes
            })
        }
        other => return Err(format!("unknown tool: {other}")),
    };

    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

/// Resolve the one app-owned directory `write_report` may write into. Set by
/// the orchestrator (never by the model) via [`REPORT_DIR_ENV`] when it spawns
/// this process in `mcp-server` mode for an analysis run; if it is unset (e.g.
/// this binary is used as a generic read-only MCP server elsewhere) the write
/// tool has no reachable destination at all.
fn report_dir() -> Result<PathBuf, String> {
    let dir = std::env::var(REPORT_DIR_ENV)
        .map_err(|_| "write_report is not available in this context (no report directory configured)".to_string())?;
    let path = PathBuf::from(dir);
    if !path.is_dir() {
        return Err("configured report directory does not exist".to_string());
    }
    Ok(path)
}

/// Sanitize a caller-supplied report name into a bare filename component.
/// Only the final path segment is considered (so `../../etc/passwd` collapses
/// to `passwd`), only ASCII alphanumerics/`-`/`_` are kept, everything else
/// (including `.`, spaces, separators) becomes a single `-`, and the result is
/// capped in length. Never returns anything containing a path separator or an
/// extension supplied by the caller — the `.html` extension is always applied
/// by [`write_report`] itself.
fn sanitize_report_name(raw: &str) -> String {
    let base = std::path::Path::new(raw)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut out = String::with_capacity(base.len());
    for c in base.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    let truncated: String = trimmed.chars().take(120).collect();
    if truncated.is_empty() {
        "report".to_string()
    } else {
        truncated
    }
}

/// Append `content` to the sanitized, app-owned report file named by `name`,
/// creating it on the first call. Returns the resolved path and the number of
/// bytes written by this call. There is no argument, anywhere in this path,
/// that lets the caller choose a directory — only [`report_dir`] (app-set)
/// and the sanitized filename (derived, never a path) are ever used.
fn write_report(name: &str, content: &str) -> Result<(PathBuf, usize), String> {
    let dir = report_dir()?;
    let safe_name = sanitize_report_name(name);
    let path = dir.join(format!("{safe_name}.html"));

    // Defense in depth: sanitize_report_name should already make this
    // impossible, but double-check the resolved path never leaves `dir`.
    if path.parent() != Some(dir.as_path()) {
        return Err("resolved report path escaped the report directory".to_string());
    }

    use std::fs::OpenOptions;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    let bytes = content.len();
    Ok((path, bytes))
}

fn parse_window(args: &Value) -> Result<Window, String> {
    let s = args
        .get("window")
        .and_then(|v| v.as_str())
        .ok_or("missing window (day|week|month)")?;
    Window::parse(s).ok_or_else(|| format!("invalid window: {s} (use day|week|month)"))
}

// ---- JSON-RPC helpers ----

fn text_content(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

fn result_response(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn write_message<W: Write>(out: &mut W, msg: &Value) {
    if let Ok(s) = serde_json::to_string(msg) {
        let _ = out.write_all(s.as_bytes());
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_report_name_strips_traversal() {
        assert_eq!(sanitize_report_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_report_name("/etc/passwd"), "passwd");
        assert_eq!(sanitize_report_name("a/b/../../c"), "c");
    }

    #[test]
    fn sanitize_report_name_drops_unsafe_chars_and_extensions() {
        assert_eq!(sanitize_report_name("report.html"), "report-html");
        assert_eq!(sanitize_report_name("my report!!"), "my-report");
        // `/` in the raw name is treated as a path separator (only the final
        // segment survives `Path::file_name`), so an injected `</script>`
        // closing tag truncates everything before the last `/`.
        assert_eq!(sanitize_report_name("<script>alert(1)</script>"), "script");
        assert_eq!(sanitize_report_name("weird<>name"), "weird-name");
    }

    #[test]
    fn sanitize_report_name_falls_back_when_empty() {
        assert_eq!(sanitize_report_name(""), "report");
        assert_eq!(sanitize_report_name("../"), "report");
        assert_eq!(sanitize_report_name("***"), "report");
    }

    #[test]
    fn sanitize_report_name_preserves_safe_names() {
        assert_eq!(sanitize_report_name("report"), "report");
        assert_eq!(sanitize_report_name("kiro-insights_v2"), "kiro-insights_v2");
    }

    // `write_report` is gated by a process-wide env var, so these two cases
    // share one test (rather than risk cargo's parallel test threads racing
    // on `std::env::set_var`/`remove_var`).
    #[test]
    fn write_report_is_gated_by_configured_dir_and_appends_within_it() {
        std::env::remove_var(REPORT_DIR_ENV);
        let err = write_report("report", "<html></html>").unwrap_err();
        assert!(err.contains("not available") || err.contains("directory"));

        let dir = std::env::temp_dir().join(format!("mcp-write-report-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var(REPORT_DIR_ENV, &dir);

        let (path, n1) = write_report("../../evil", "<!DOCTYPE html>").unwrap();
        assert_eq!(path, dir.join("evil.html"));
        assert_eq!(n1, "<!DOCTYPE html>".len());

        let (path2, n2) = write_report("../../evil", "<html></html>").unwrap();
        assert_eq!(path2, path);
        assert_eq!(n2, "<html></html>".len());

        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "<!DOCTYPE html><html></html>");

        std::env::remove_var(REPORT_DIR_ENV);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
