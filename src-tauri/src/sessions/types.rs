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
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryMsg {
    pub role: String,
    pub content: String,
    #[serde(rename = "executionId", skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    pub actions: Vec<Action>,
    pub cost: f64,
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
