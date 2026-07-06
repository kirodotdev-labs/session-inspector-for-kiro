//! Session analysis: turns raw sessions into *optimized* signals for the
//! headless Kiro analyst.
//!
//! Deliberately lossy by design. The analyst prompt must detect patterns
//! (which tools succeed/fail, how often, with what error class) without ever
//! seeing raw tool inputs/outputs. So everything here reduces a session to
//! counts and coarse error categories. The one exception is
//! [`user_prompts`], which returns the user's *own* prompt text (never tool
//! call/result data) so the analyst can quote directives verbatim — and only
//! when it deliberately drills into a specific session.

use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

pub mod orchestrator;
pub mod store;

use crate::sessions::cli::{get_cli_session, load_all_cli_session_meta};
use crate::sessions::ide::{get_ide_session, list_ide_workspaces};
use crate::sessions::paths::Paths;
use crate::sessions::types::{Action, SessionDetail};

/// Analysis time window, selectable in the UI.
#[derive(Debug, Clone, Copy)]
pub enum Window {
    Day,
    Week,
    Month,
}

impl Window {
    pub fn parse(s: &str) -> Option<Window> {
        match s.trim().to_lowercase().as_str() {
            "day" | "1d" | "today" => Some(Window::Day),
            "week" | "7d" => Some(Window::Week),
            "month" | "30d" => Some(Window::Month),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Window::Day => "day",
            Window::Week => "week",
            Window::Month => "month",
        }
    }

    fn days(&self) -> i64 {
        match self {
            Window::Day => 1,
            Window::Week => 7,
            Window::Month => 30,
        }
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn iso(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

fn day_key(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Session location / loading across sources
// ---------------------------------------------------------------------------

/// A session that falls inside the analysis window, with just enough metadata
/// to load its full detail on demand.
struct Located {
    session_id: String,
    workspace_id: Option<String>, // IDE dir name; None for CLI-family
    date: i64,
}

/// All sessions (any source) whose activity date falls within `window`.
fn located_in_window(paths: &Paths, window: Window) -> Vec<Located> {
    let cutoff = now_ms() - window.days() * 86_400_000;
    let mut out: Vec<Located> = Vec::new();

    // CLI-family (v2 "cli" + v3 "unified")
    for m in load_all_cli_session_meta(paths) {
        let date = if m.updated_at != 0 { m.updated_at } else { m.created_at };
        if date >= cutoff {
            out.push(Located {
                session_id: m.session_id,
                workspace_id: None,
                date,
            });
        }
    }

    // IDE
    for ws in list_ide_workspaces(paths) {
        let dir_name = ws.id.strip_prefix("ide:").unwrap_or(&ws.id).to_string();
        for s in ws.sessions {
            if s.date >= cutoff {
                out.push(Located {
                    session_id: s.id,
                    workspace_id: Some(dir_name.clone()),
                    date: s.date,
                });
            }
        }
    }

    out
}

fn load_detail(paths: &Paths, located: &Located) -> Option<SessionDetail> {
    match &located.workspace_id {
        Some(dir) => get_ide_session(paths, dir, &located.session_id).ok(),
        None => get_cli_session(paths, &located.session_id).ok(),
    }
}

/// Load a session by id alone (used by MCP tools that only receive a session
/// id). Tries the CLI-family loader first, then scans IDE workspaces.
fn load_detail_by_id(paths: &Paths, session_id: &str) -> Option<SessionDetail> {
    if let Ok(d) = get_cli_session(paths, session_id) {
        return Some(d);
    }
    for ws in list_ide_workspaces(paths) {
        if ws.sessions.iter().any(|s| s.id == session_id) {
            let dir = ws.id.strip_prefix("ide:").unwrap_or(&ws.id);
            if let Ok(d) = get_ide_session(paths, dir, session_id) {
                return Some(d);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Tool-state classification + error categorization (the core optimization)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum ToolState {
    Success,
    Error,
    Pending,
    Unknown,
}

/// Normalize the many `actionState` spellings across IDE/CLI/Unified into a
/// coarse outcome. IDE emits its own vocabulary; CLI-family uses
/// Success/Error/Pending. Match case-insensitively on substrings.
fn classify_state(state: Option<&str>) -> ToolState {
    let s = match state {
        Some(s) => s.to_lowercase(),
        None => return ToolState::Unknown,
    };
    if s.contains("error") || s.contains("fail") || s.contains("denied") || s.contains("reject") {
        ToolState::Error
    } else if s.contains("success") || s.contains("complete") || s.contains("done") || s.contains("ok")
    {
        ToolState::Success
    } else if s.contains("pending") || s.contains("running") || s.contains("progress") {
        ToolState::Pending
    } else {
        ToolState::Unknown
    }
}

/// Reduce a failed tool's output to a coarse error *category* — never the raw
/// text. The stringified output is inspected in-process for known signatures
/// and then discarded; only the label escapes.
fn categorize_error(action: &Action) -> String {
    // Structured non-zero exit code (shell tools) takes precedence.
    if let Some(out) = &action.output {
        for key in ["exit_status", "exitStatus", "exitCode", "exit_code"] {
            if let Some(code) = out.get(key) {
                let nonzero = match code {
                    Value::Number(n) => n.as_i64().map(|v| v != 0).unwrap_or(false),
                    Value::String(s) => s != "0" && !s.is_empty(),
                    _ => false,
                };
                if nonzero {
                    return "nonzero_exit".to_string();
                }
            }
        }
    }

    let hay = action
        .output
        .as_ref()
        .map(|o| o.to_string())
        .unwrap_or_default()
        .to_lowercase();

    // Order matters: most specific first.
    let checks: &[(&str, &[&str])] = &[
        ("http_forbidden", &["403", "forbidden"]),
        ("http_unauthorized", &["401", "unauthorized", "credential"]),
        ("rate_limited", &["429", "rate limit", "too many requests"]),
        ("http_not_found", &["404"]),
        ("permission_denied", &["permission denied", "eacces", "operation not permitted"]),
        ("not_found", &["no such file", "enoent", "not found", "does not exist"]),
        ("timeout", &["timed out", "timeout", "deadline exceeded"]),
        ("connection_error", &["connection refused", "connection reset", "econnrefused"]),
        ("syntax_error", &["syntax error", "parse error", "unexpected token"]),
        ("already_exists", &["already exists", "eexist"]),
        ("no_match", &["no matches found", "no results", "pattern not found"]),
    ];
    for (label, needles) in checks {
        if needles.iter().any(|n| hay.contains(n)) {
            return label.to_string();
        }
    }
    "other_error".to_string()
}

// ---------------------------------------------------------------------------
// Aggregation structures (serialized straight to the analyst)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Serialize)]
struct ToolStat {
    calls: u64,
    success: u64,
    error: u64,
    pending: u64,
    unknown: u64,
}

#[derive(Debug, Default, Serialize)]
struct SourceCount {
    sessions: u64,
    turns: u64,
    cost: f64,
}

#[derive(Debug, Serialize)]
pub struct Overview {
    window: String,
    from: String,
    to: String,
    #[serde(rename = "totalSessions")]
    total_sessions: u64,
    #[serde(rename = "analyzedSessions")]
    analyzed_sessions: u64,
    #[serde(rename = "totalMessages")]
    total_messages: u64,
    #[serde(rename = "activeDays")]
    active_days: u64,
    #[serde(rename = "avgMessagesPerActiveDay")]
    avg_messages_per_active_day: f64,
    #[serde(rename = "totalTurns")]
    total_turns: u64,
    #[serde(rename = "totalCost")]
    total_cost: f64,
    #[serde(rename = "totalDurationMs")]
    total_duration_ms: i64,
    #[serde(rename = "toolCalls")]
    tool_calls: u64,
    #[serde(rename = "toolFailures")]
    tool_failures: u64,
    #[serde(rename = "overallFailureRate")]
    overall_failure_rate: f64,
    #[serde(rename = "bySource")]
    by_source: BTreeMap<String, SourceCount>,
    models: BTreeMap<String, u64>,
    #[serde(rename = "autonomyModes")]
    autonomy_modes: BTreeMap<String, u64>,
    #[serde(rename = "toolUsage")]
    tool_usage: BTreeMap<String, ToolStat>,
    #[serde(rename = "errorCategories")]
    error_categories: BTreeMap<String, u64>,
    #[serde(rename = "contextUsageAvg")]
    context_usage_avg: f64,
    #[serde(rename = "contextUsageMax")]
    context_usage_max: f64,
    /// Sessions with the most tool failures — candidates for the analyst to
    /// drill into via `get_session_stats` / `get_user_prompts`.
    #[serde(rename = "notableSessions")]
    notable_sessions: Vec<SessionRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionRow {
    id: String,
    title: String,
    source: String,
    workspace: String,
    date: String,
    turns: u64,
    messages: u64,
    #[serde(rename = "userMessages")]
    user_messages: u64,
    cost: f64,
    #[serde(rename = "durationMs")]
    duration_ms: i64,
    #[serde(rename = "contextUsage")]
    context_usage: f64,
    model: String,
    #[serde(rename = "toolCalls")]
    tool_calls: u64,
    #[serde(rename = "toolFailures")]
    tool_failures: u64,
    #[serde(rename = "failureRate")]
    failure_rate: f64,
    #[serde(rename = "topTools")]
    top_tools: Vec<ToolCount>,
    #[serde(rename = "errorCategories")]
    error_categories: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize)]
struct ToolCount {
    name: String,
    calls: u64,
    failures: u64,
}

/// Per-session tool signals extracted from a parsed detail. Raw content dropped.
struct SessionSignals {
    row: SessionRow,
    tool_usage: BTreeMap<String, ToolStat>,
    error_categories: BTreeMap<String, u64>,
    context_usage: f64,
}

fn extract_signals(detail: &SessionDetail, date_ms: i64) -> SessionSignals {
    let mut tool_usage: BTreeMap<String, ToolStat> = BTreeMap::new();
    let mut error_categories: BTreeMap<String, u64> = BTreeMap::new();
    let mut tool_calls: u64 = 0;
    let mut tool_failures: u64 = 0;
    let mut user_messages: u64 = 0;

    for msg in &detail.history {
        if msg.role == "user" {
            user_messages += 1;
        }
        for action in &msg.actions {
            let name = if action.action_type.is_empty() {
                "tool".to_string()
            } else {
                action.action_type.clone()
            };
            let stat = tool_usage.entry(name).or_default();
            stat.calls += 1;
            tool_calls += 1;
            match classify_state(action.action_state.as_deref()) {
                ToolState::Success => stat.success += 1,
                ToolState::Error => {
                    stat.error += 1;
                    tool_failures += 1;
                    *error_categories.entry(categorize_error(action)).or_insert(0) += 1;
                }
                ToolState::Pending => stat.pending += 1,
                ToolState::Unknown => stat.unknown += 1,
            }
        }
    }

    // turns ≈ assistant messages that carry work.
    let turns = detail
        .history
        .iter()
        .filter(|m| m.role == "assistant")
        .count() as u64;

    let mut top_tools: Vec<ToolCount> = tool_usage
        .iter()
        .map(|(name, s)| ToolCount {
            name: name.clone(),
            calls: s.calls,
            failures: s.error,
        })
        .collect();
    top_tools.sort_by(|a, b| b.calls.cmp(&a.calls));
    top_tools.truncate(5);

    let workspace = detail
        .workspace_path
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(&detail.workspace_path)
        .to_string();

    let failure_rate = if tool_calls > 0 {
        tool_failures as f64 / tool_calls as f64
    } else {
        0.0
    };

    let row = SessionRow {
        id: detail.session_id.clone(),
        title: detail.title.clone(),
        source: detail.source.as_str().to_string(),
        workspace,
        date: iso(date_ms),
        turns,
        messages: detail.message_count as u64,
        user_messages,
        cost: detail.total_cost,
        duration_ms: detail.duration_ms.unwrap_or(0),
        context_usage: detail.context_usage,
        model: detail.model.clone(),
        tool_calls,
        tool_failures,
        failure_rate,
        top_tools,
        error_categories: error_categories.clone(),
    };

    SessionSignals {
        row,
        tool_usage,
        error_categories,
        context_usage: detail.context_usage,
    }
}

fn merge_tool_usage(dst: &mut BTreeMap<String, ToolStat>, src: &BTreeMap<String, ToolStat>) {
    for (name, s) in src {
        let d = dst.entry(name.clone()).or_default();
        d.calls += s.calls;
        d.success += s.success;
        d.error += s.error;
        d.pending += s.pending;
        d.unknown += s.unknown;
    }
}

// ---------------------------------------------------------------------------
// Public analysis entry points (used by both MCP tools and inline payload)
// ---------------------------------------------------------------------------

/// Aggregate optimized stats for the window. This is the payload passed
/// inline to the analyst *and* the `get_overview` MCP tool result.
pub fn compute_overview(paths: &Paths, window: Window) -> Overview {
    let cutoff = now_ms() - window.days() * 86_400_000;
    let located = located_in_window(paths, window);
    let total_sessions = located.len() as u64;

    let mut tool_usage: BTreeMap<String, ToolStat> = BTreeMap::new();
    let mut error_categories: BTreeMap<String, u64> = BTreeMap::new();
    let mut by_source: BTreeMap<String, SourceCount> = BTreeMap::new();
    let mut models: BTreeMap<String, u64> = BTreeMap::new();
    let mut autonomy_modes: BTreeMap<String, u64> = BTreeMap::new();
    let mut active_days: HashSet<String> = HashSet::new();

    let mut analyzed: u64 = 0;
    let mut total_messages: u64 = 0;
    let mut total_turns: u64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut total_duration_ms: i64 = 0;
    let mut tool_calls: u64 = 0;
    let mut tool_failures: u64 = 0;
    let mut ctx_sum: f64 = 0.0;
    let mut ctx_max: f64 = 0.0;

    let mut rows: Vec<SessionRow> = Vec::new();

    for loc in &located {
        let detail = match load_detail(paths, loc) {
            Some(d) => d,
            None => continue,
        };
        analyzed += 1;
        active_days.insert(day_key(loc.date));

        let signals = extract_signals(&detail, loc.date);
        let row = &signals.row;

        total_messages += row.messages;
        total_turns += row.turns;
        total_cost += row.cost;
        total_duration_ms += row.duration_ms;
        tool_calls += row.tool_calls;
        tool_failures += row.tool_failures;
        ctx_sum += signals.context_usage;
        if signals.context_usage > ctx_max {
            ctx_max = signals.context_usage;
        }

        let sc = by_source.entry(row.source.clone()).or_default();
        sc.sessions += 1;
        sc.turns += row.turns;
        sc.cost += row.cost;

        if !detail.model.is_empty() {
            *models.entry(detail.model.clone()).or_insert(0) += 1;
        }
        if !detail.autonomy_mode.is_empty() {
            *autonomy_modes.entry(detail.autonomy_mode.clone()).or_insert(0) += 1;
        }

        merge_tool_usage(&mut tool_usage, &signals.tool_usage);
        for (cat, n) in &signals.error_categories {
            *error_categories.entry(cat.clone()).or_insert(0) += n;
        }

        rows.push(signals.row);
    }

    // Notable = most tool failures, then highest failure rate.
    rows.sort_by(|a, b| {
        b.tool_failures
            .cmp(&a.tool_failures)
            .then(b.failure_rate.partial_cmp(&a.failure_rate).unwrap_or(std::cmp::Ordering::Equal))
    });
    let notable_sessions: Vec<SessionRow> =
        rows.iter().filter(|r| r.tool_failures > 0).take(10).cloned().collect();

    let active = active_days.len() as u64;
    let overall_failure_rate = if tool_calls > 0 {
        tool_failures as f64 / tool_calls as f64
    } else {
        0.0
    };

    Overview {
        window: window.as_str().to_string(),
        from: iso(cutoff),
        to: iso(now_ms()),
        total_sessions,
        analyzed_sessions: analyzed,
        total_messages,
        active_days: active,
        avg_messages_per_active_day: if active > 0 {
            total_messages as f64 / active as f64
        } else {
            0.0
        },
        total_turns,
        total_cost,
        total_duration_ms,
        tool_calls,
        tool_failures,
        overall_failure_rate,
        by_source,
        models,
        autonomy_modes,
        tool_usage,
        error_categories,
        context_usage_avg: if analyzed > 0 { ctx_sum / analyzed as f64 } else { 0.0 },
        context_usage_max: ctx_max,
        notable_sessions,
    }
}

/// Lightweight per-session rows for the window (no raw content).
pub fn list_session_rows(paths: &Paths, window: Window) -> Vec<SessionRow> {
    let located = located_in_window(paths, window);
    let mut rows: Vec<SessionRow> = Vec::new();
    for loc in &located {
        if let Some(detail) = load_detail(paths, loc) {
            rows.push(extract_signals(&detail, loc.date).row);
        }
    }
    rows.sort_by(|a, b| b.date.cmp(&a.date));
    rows
}

#[derive(Debug, Serialize)]
pub struct SessionStats {
    #[serde(flatten)]
    row: SessionRow,
    #[serde(rename = "toolUsage")]
    tool_usage: BTreeMap<String, ToolStat>,
}

/// Full tool breakdown for a single session (no raw content).
pub fn session_stats(paths: &Paths, session_id: &str) -> Option<SessionStats> {
    let detail = load_detail_by_id(paths, session_id)?;
    let signals = extract_signals(&detail, now_ms());
    Some(SessionStats {
        row: signals.row,
        tool_usage: signals.tool_usage,
    })
}

#[derive(Debug, Serialize)]
pub struct UserPrompts {
    id: String,
    title: String,
    #[serde(rename = "promptCount")]
    prompt_count: usize,
    prompts: Vec<String>,
}

/// The user's own prompt text (never tool call/result). Truncated per prompt
/// and capped in count so the analyst can quote directives without ingesting
/// whole transcripts.
pub fn user_prompts(paths: &Paths, session_id: &str, max_chars: usize) -> Option<UserPrompts> {
    let detail = load_detail_by_id(paths, session_id)?;
    let cap = if max_chars == 0 { 500 } else { max_chars.min(2000) };
    let prompts: Vec<String> = detail
        .history
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| {
            let t = m.content.trim();
            if t.chars().count() > cap {
                let truncated: String = t.chars().take(cap).collect();
                format!("{}…", truncated)
            } else {
                t.to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect();
    Some(UserPrompts {
        id: detail.session_id,
        title: detail.title,
        prompt_count: prompts.len(),
        prompts,
    })
}
