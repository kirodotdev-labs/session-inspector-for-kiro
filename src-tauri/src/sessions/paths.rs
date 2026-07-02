use std::path::PathBuf;

/// Base directory resolution, mirroring the constants at the top of
/// `server/index.ts`. macOS paths are used directly; Windows/Linux fall back
/// to reasonable per-OS equivalents (see TAURI_PLAN.md Task 1 — flagged as
/// unverified for Windows).
pub struct Paths {
    pub global_storage: PathBuf,
    pub sessions_dir: PathBuf,
    pub cli_sessions_dir: PathBuf,
    pub cli_v3_sessions_dir: PathBuf,
}

fn kiro_global_storage_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_default()
            .join("Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent")
    }
    #[cfg(target_os = "windows")]
    {
        // Unverified: Kiro IDE on Windows is expected to store globalStorage
        // under %APPDATA%\Kiro\User\globalStorage\kiro.kiroagent.
        dirs::config_dir()
            .unwrap_or_default()
            .join("Kiro/User/globalStorage/kiro.kiroagent")
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        // Linux: VS Code-family apps typically use ~/.config/Kiro/...
        dirs::config_dir()
            .unwrap_or_default()
            .join("Kiro/User/globalStorage/kiro.kiroagent")
    }
}

fn kiro_home_sessions_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".kiro/sessions")
}

pub fn resolve() -> Paths {
    let global_storage = kiro_global_storage_dir();
    let sessions_dir = global_storage.join("workspace-sessions");
    let cli_v3_sessions_dir = kiro_home_sessions_dir();
    let cli_sessions_dir = cli_v3_sessions_dir.join("cli");
    Paths {
        global_storage,
        sessions_dir,
        cli_sessions_dir,
        cli_v3_sessions_dir,
    }
}
