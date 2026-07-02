use crate::sessions::cli::{get_cli_session, list_cli_workspaces};
use crate::sessions::dashboard::compute_dashboard;
use crate::sessions::ide::{get_ide_session, list_ide_workspaces};
use crate::sessions::paths;
use crate::sessions::types::{DashboardData, SessionDetail, Source, Workspace};

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
