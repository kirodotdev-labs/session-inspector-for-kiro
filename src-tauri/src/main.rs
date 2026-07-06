// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Headless subcommands share the same binary so the MCP server we hand to
  // kiro-cli is literally this app. They must run *before* Tauri boots.
  let mut args = std::env::args().skip(1);
  match args.next().as_deref() {
    // Stdio MCP server spawned by kiro-cli during an analysis run.
    Some("mcp-server") => {
      app_lib::run_mcp_server();
      return;
    }
    // Print the optimized overview JSON for a window (debug/inspection aid).
    Some("stats") => {
      let window = args.next(); // e.g. "--window" then value, or just the value
      let win = if window.as_deref() == Some("--window") {
        args.next()
      } else {
        window
      };
      app_lib::print_stats(win.as_deref().unwrap_or("week"));
      return;
    }
    // Run a full headless analysis (spawns kiro-cli) and print the report.
    // Accepts an optional window (positional or `--window <value>`) and an
    // optional `--kiro-cli-path <path>` override for the kiro-cli binary.
    Some("analyze") => {
      let mut win: Option<String> = None;
      let mut cli_path: Option<String> = None;
      let mut rest: Vec<String> = args.collect();
      let mut i = 0;
      while i < rest.len() {
        match rest[i].as_str() {
          "--window" if i + 1 < rest.len() => {
            win = Some(rest.remove(i + 1));
            rest.remove(i);
          }
          "--kiro-cli-path" if i + 1 < rest.len() => {
            cli_path = Some(rest.remove(i + 1));
            rest.remove(i);
          }
          _ => i += 1,
        }
      }
      if win.is_none() {
        win = rest.into_iter().next();
      }
      app_lib::run_analysis_cli(win.as_deref().unwrap_or("week"), cli_path.as_deref());
      return;
    }
    _ => {}
  }

  app_lib::run();
}
