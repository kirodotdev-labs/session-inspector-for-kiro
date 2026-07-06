mod analysis;
mod commands;
mod mcp;
mod sessions;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

/// Headless entry point: run the stdio MCP server (spawned by kiro-cli).
pub fn run_mcp_server() {
    mcp::serve();
}

/// Headless entry point: print the optimized overview JSON for a window.
pub fn print_stats(window: &str) {
    let win = analysis::Window::parse(window).unwrap_or(analysis::Window::Week);
    let paths = sessions::paths::resolve();
    let overview = analysis::compute_overview(&paths, win);
    println!("{}", serde_json::to_string_pretty(&overview).unwrap_or_default());
}

/// Headless entry point: run a full analysis (spawns kiro-cli), persist the
/// HTML report, and print its file path to stdout (or the error to stderr).
/// `cli_path` optionally overrides the resolved kiro-cli binary (defaults to
/// PATH resolution / the common `~/.local/bin/kiro-cli` install location).
pub fn run_analysis_cli(window: &str, cli_path: Option<&str>) {
    let win = analysis::Window::parse(window).unwrap_or(analysis::Window::Week);
    match analysis::orchestrator::run(win, None, cli_path) {
        Ok(record) => println!("{}", record.html_path),
        Err(e) => {
            eprintln!("analysis failed: {e}");
            std::process::exit(1);
        }
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

      TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("Kiro Sessions Inspector")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => {
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { button, .. } = event {
            if button == tauri::tray::MouseButton::Left {
              let app = tray.app_handle();
              if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                  let _ = window.hide();
                } else {
                  let _ = window.show();
                  let _ = window.set_focus();
                }
              }
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      // Clicking the close button hides the window instead of quitting, so
      // the app keeps running in the tray.
      if let WindowEvent::CloseRequested { api, .. } = event {
        window.hide().ok();
        api.prevent_close();
      }
    })
    .invoke_handler(tauri::generate_handler![
      commands::list_workspaces,
      commands::get_session_detail,
      commands::get_dashboard,
      commands::get_unified_dashboard,
      commands::get_workspace_dashboard,
      commands::run_analysis,
      commands::list_analyses,
      commands::open_analysis,
      commands::delete_analysis,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
