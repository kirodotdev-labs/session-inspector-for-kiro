use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

/// Session source. Kiro CLI v3 and the new IDE share the same session format
/// and storage, so those sessions are surfaced as "unified" rather than
/// "CLI v3" — a distinct source alongside the legacy `ide` and `cli` (v2)
/// sources. Mirrors `Source` in `server/index.ts` / `SessionSource` in the
/// macOS Swift app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Ide,
    Cli,
    Unified,
}

impl Source {
    /// Maps a CLI-family session's on-disk format version to its UI source.
    pub fn for_cli_version(version: u8) -> Source {
        if version == 3 {
            Source::Unified
        } else {
            Source::Cli
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Source::Ide => "ide",
            Source::Cli => "cli",
            Source::Unified => "unified",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub date: i64,
    pub source: Source,
}

#[derive(Debug, Clone, Serialize)]
pub struct Workspace {
    pub id: String,
    pub source: Source,
    pub path: String,
    pub name: String,
    #[serde(rename = "sessionCount")]
    pub session_count: usize,
    pub sessions: Vec<SessionSummary>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Action {
    #[serde(rename = "actionType")]
    pub action_type: String,
    #[serde(rename = "rawToolName", skip_serializing_if = "Option::is_none")]
    pub raw_tool_name: Option<String>,
    #[serde(rename = "actionState", skip_serializing_if = "Option::is_none")]
    pub action_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    /// Present only for `actionType: "subagent"` — the id of the sub-agent's
    /// own session, i.e. the `{subSessionId}` in
    /// `{parentSessionDir}/sub-executions/{subSessionId}.jsonl`. Lets the UI
    /// fetch and expand that sub-agent's own transcript on demand via
    /// `get_subagent_trace` instead of just showing it as an opaque step.
    #[serde(rename = "subSessionId", skip_serializing_if = "Option::is_none")]
    pub sub_session_id: Option<String>,
}

/// One ordered unit of an assistant turn, for interleaved rendering — a
/// text chunk or a tool call/reasoning step, in the order they were
/// actually emitted. This is the structure the UI renders from; `content`/
/// `actions` on `HistoryMsg` below remain the flattened, order-independent
/// view used by consumers that don't care about interleaving (search
/// indexing, tool-usage analytics, dashboard stats).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    Text {
        text: String,
    },
    Action {
        #[serde(flatten)]
        action: Action,
    },
}

/// Internal bookkeeping for the order text/tool-call blocks are encountered
/// in while parsing a turn — never serialized. `ActionIdx` is an index into
/// `HistoryMsg::actions` rather than a copy of the `Action`, since a
/// `tool_use`'s `Action` is typically mutated in place afterwards (e.g. once
/// its `tool_result` arrives); resolving through the index at
/// `finalize_blocks` time guarantees `blocks` always reflects the final
/// state of `actions`.
#[derive(Debug, Clone)]
pub enum BlockOrder {
    Text(String),
    ActionIdx(usize),
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct HistoryMsg {
    pub role: String,
    pub content: String,
    #[serde(rename = "executionId", skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    pub actions: Vec<Action>,
    pub cost: f64,
    /// Ordered view of this turn's text/tool-call blocks, interleaved in
    /// the order they actually happened — see `Block`. Populated by
    /// `finalize_blocks()`; empty for turns that never call it (e.g. plain
    /// user messages, or sources — like the IDE format — whose on-disk
    /// shape doesn't preserve interleaving to begin with).
    pub blocks: Vec<Block>,
    #[serde(skip)]
    pub block_order: Vec<BlockOrder>,
}

impl HistoryMsg {
    /// Appends text to both the flattened `content` string (joined with
    /// `\n`) and `block_order`, merging into the previous block if it was
    /// also plain text so a run of consecutive text chunks (e.g. several
    /// API response fragments) stays one block — a tool call in between
    /// starts a fresh text block instead of merging across it.
    pub fn push_text(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.content = if self.content.is_empty() {
            text.to_string()
        } else {
            format!("{}\n{}", self.content, text)
        };
        if let Some(BlockOrder::Text(s)) = self.block_order.last_mut() {
            s.push('\n');
            s.push_str(text);
        } else {
            self.block_order.push(BlockOrder::Text(text.to_string()));
        }
    }

    /// Pushes a tool-call/reasoning `Action` and records its position in
    /// `block_order`. Returns its index in `actions`, for callers that need
    /// to look it up again later (e.g. to fill in a `tool_result`).
    pub fn push_action(&mut self, action: Action) -> usize {
        let idx = self.actions.len();
        self.actions.push(action);
        self.block_order.push(BlockOrder::ActionIdx(idx));
        idx
    }

    /// Materializes `blocks` from `block_order` and the current `actions`.
    /// Call once all of this turn's `tool_result`s have been folded into
    /// `actions` in place, so `blocks` reflects their final state.
    pub fn finalize_blocks(&mut self) {
        self.blocks = self
            .block_order
            .iter()
            .filter_map(|o| match o {
                BlockOrder::Text(s) => Some(Block::Text { text: s.clone() }),
                BlockOrder::ActionIdx(i) => {
                    self.actions.get(*i).cloned().map(|action| Block::Action { action })
                }
            })
            .collect();
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDetail {
    pub source: Source,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub title: String,
    pub model: String,
    #[serde(rename = "autonomyMode")]
    pub autonomy_mode: String,
    #[serde(rename = "sessionType")]
    pub session_type: String,
    #[serde(rename = "contextUsage")]
    pub context_usage: f64,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "messageCount")]
    pub message_count: usize,
    #[serde(rename = "totalCost")]
    pub total_cost: f64,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(rename = "cliVersion", skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<u8>,
    pub history: Vec<HistoryMsg>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DailyStats {
    pub date: String,
    pub sessions: u64,
    pub cost: f64,
    pub executions: u64,
    #[serde(rename = "ideSessions")]
    pub ide_sessions: u64,
    #[serde(rename = "cliSessions")]
    pub cli_sessions: u64,
    #[serde(rename = "ideCost")]
    pub ide_cost: f64,
    #[serde(rename = "cliCost")]
    pub cli_cost: f64,
    #[serde(rename = "ideExecutions")]
    pub ide_executions: u64,
    #[serde(rename = "cliExecutions")]
    pub cli_executions: u64,
    #[serde(rename = "unifiedSessions")]
    pub unified_sessions: u64,
    #[serde(rename = "unifiedCost")]
    pub unified_cost: f64,
    #[serde(rename = "unifiedExecutions")]
    pub unified_executions: u64,
    pub actions: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceStat {
    pub name: String,
    pub cost: f64,
    pub sessions: u64,
    pub executions: u64,
    pub duration: i64,
    pub source: Source,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SourceStat {
    pub sessions: u64,
    pub executions: u64,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardData {
    #[serde(rename = "totalCost")]
    pub total_cost: f64,
    #[serde(rename = "totalSessions")]
    pub total_sessions: u64,
    #[serde(rename = "totalExecutions")]
    pub total_executions: u64,
    #[serde(rename = "totalDuration")]
    pub total_duration: i64,
    pub daily: Vec<DailyStats>,
    #[serde(rename = "modelUsage")]
    pub model_usage: HashMap<String, f64>,
    #[serde(rename = "modelSessions")]
    pub model_sessions: HashMap<String, u64>,
    #[serde(rename = "sessionTypes")]
    pub session_types: HashMap<String, u64>,
    #[serde(rename = "autonomyModes")]
    pub autonomy_modes: HashMap<String, u64>,
    pub workspaces: Vec<WorkspaceStat>,
    #[serde(rename = "sourceStats")]
    pub source_stats: HashMap<Source, SourceStat>,
}
