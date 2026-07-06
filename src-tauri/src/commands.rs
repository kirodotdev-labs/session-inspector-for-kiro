use crate::sessions::cli::{get_cli_session, list_cli_workspaces};
use crate::sessions::dashboard::compute_dashboard;
use crate::sessions::ide::{get_ide_session, list_ide_workspaces};
use crate::sessions::paths;
use crate::sessions::types::{DashboardData, SessionDetail, Source, Workspace};

use crate::analysis::orchestrator;
use crate::analysis::store::{self, AnalysisRecord};
use crate::analysis::Window;

fn parse_source(s: &str) -> Option<Source> {
    match s {
        "ide" => Some(Source::Ide),
        "cli" => Some(Source::Cli),
        "unified" => Some(Source::Unified),
        _ => None,
    }
}

#[tauri::command]
pub fn list_workspaces() -> Vec<Workspace> {
    let paths = paths::resolve();
    let mut ide = list_ide_workspaces(&paths);
    let cli = list_cli_workspaces(&paths);
    ide.extend(cli);
    ide
}

#[tauri::command]
pub fn get_session_detail(
    workspace_id: String,
    session_id: String,
) -> Result<SessionDetail, String> {
    let paths = paths::resolve();
    // Both legacy CLI (v2) and Unified (v3) sessions are parsed by the
    // CLI-family loader, which locates the session by id across formats.
    if workspace_id.starts_with("cli:") || workspace_id.starts_with("unified:") {
        get_cli_session(&paths, &session_id)
    } else {
        let raw_id = workspace_id.strip_prefix("ide:").unwrap_or(&workspace_id);
        get_ide_session(&paths, raw_id, &session_id)
    }
}

#[tauri::command]
pub fn get_dashboard() -> DashboardData {
    let paths = paths::resolve();
    compute_dashboard(&paths, None, None)
}

/// Dashboard scoped to Unified (shared IDE+CLI format) sessions only.
#[tauri::command]
pub fn get_unified_dashboard() -> DashboardData {
    let paths = paths::resolve();
    compute_dashboard(&paths, None, Some(Source::Unified))
}

/// Per-workspace dashboard, scoped to a single workspace path (covers IDE and
/// CLI-family sessions for that path). Pass `source: "unified"` to further
/// restrict it to Unified sessions only.
#[tauri::command]
pub fn get_workspace_dashboard(path: String, source: Option<String>) -> DashboardData {
    let paths = paths::resolve();
    let source_filter = source.as_deref().and_then(parse_source);
    compute_dashboard(&paths, Some(path.as_str()), source_filter)
}

/// Run a headless Kiro analysis of the user's session history over `window`
/// ("day" | "week" | "month"). Spawns kiro-cli with a generated agent that
/// exposes this binary as a read-only stats MCP server, persists the resulting
/// HTML report, and returns its stored record. Blocks until kiro-cli finishes,
/// so callers should treat it as a long-running command.
#[tauri::command]
pub async fn run_analysis(
    window: String,
    voice: Option<String>,
    cli_path: Option<String>,
) -> Result<AnalysisRecord, String> {
    let win = Window::parse(&window)
        .ok_or_else(|| format!("invalid window: {window} (use day|week|month)"))?;
    // kiro-cli can take a while; run it off the async runtime's worker so we
    // don't block Tauri's main thread.
    tauri::async_runtime::spawn_blocking(move || {
        orchestrator::run(win, voice.as_deref(), cli_path.as_deref())
    })
    .await
    .map_err(|e| format!("analysis task failed: {e}"))?
}

/// List all stored analyses (newest first).
#[tauri::command]
pub fn list_analyses() -> Vec<AnalysisRecord> {
    store::list()
}

/// Open a stored analysis's HTML report in the default browser.
#[tauri::command]
pub fn open_analysis(id: String) -> Result<(), String> {
    store::open(&id)
}

/// Delete a stored analysis (HTML + metadata) by id.
#[tauri::command]
pub fn delete_analysis(id: String) -> Result<(), String> {
    store::delete(&id)
}
