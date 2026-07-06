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

use serde_json::{json, Value};
use std::io::{BufRead, Write};

use crate::analysis::{self, Window};
use crate::sessions::paths;

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
        other => return Err(format!("unknown tool: {other}")),
    };

    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
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
