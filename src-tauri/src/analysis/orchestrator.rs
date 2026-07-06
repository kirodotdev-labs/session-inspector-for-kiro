//! Orchestrates a headless Kiro analysis run.
//!
//! Flow:
//! 1. Compute the optimized overview for the window (inline seed payload).
//! 2. Write a workspace-local agent config into a temp dir that registers this
//!    very binary (`<exe> mcp-server`) as the `sessions` MCP server over stdio.
//! 3. Spawn `kiro-cli chat --no-interactive` with that agent and a message
//!    combining the adapted analyst prompt + the seed stats.
//! 4. Return kiro-cli's stdout (the report) to the caller.

use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::analysis::{self, store, Window};
use crate::sessions::paths;

const AGENT_NAME: &str = "kiro-session-analyst";

/// The analyst prompt — adapted from a Claude Code session-insights prompt,
/// rewritten for Kiro and for our optimized (stats-only) data model.
fn analyst_prompt() -> String {
    r#"You are analyzing my Kiro session history to produce a usage insights report.

You do NOT have the raw transcripts. Instead you have MCP tools that return
privacy-preserving, aggregated signals about my sessions — tool success/failure
counts and coarse error categories — never raw tool inputs/outputs. Use them:

- get_overview(window): aggregate stats for the window (start here).
- list_sessions(window): lightweight per-session rows.
- get_session_stats(sessionId): full per-tool success/failure breakdown for one session.
- get_user_prompts(sessionId): my own prompt text for a session (so you can quote my directives verbatim).

A seed get_overview payload for the selected window is included below so you can
begin immediately. Call the tools to dig deeper whenever you detect a pattern
(e.g. a tool with a high failure rate, a recurring error category, or a
failure-heavy session): pull that session's stats, and read my prompts to ground
and quote claims. Prefer two supporting sessions per claim.

## ANALYSIS DIMENSIONS
1. project_areas — cluster sessions into 4-6 themes. For each: name, approximate
   session_count, and a 1-2 sentence description of what I did and how Kiro was used.
2. charts:
   - "What You Wanted": intent categories (Code Generation, Information Query,
     Codebase Exploration, File Conversion, Config, …) with counts (infer from my prompts).
   - "Tool Usage": top tools by invocation count, with their failure counts.
3. interaction_style — a 2-3 paragraph narrative characterizing me as a user
   (experience level, how I scope tasks, how I react when Kiro goes off track,
   what my tool usage reveals), plus a one-sentence key_pattern.
4. what_works — an intro + 3 impressive_workflows (title + description) drawn from my
   most successful sessions (low failure rate, high tool volume).
5. friction_analysis — an intro + 3 categories. Each: category name, description,
   and 2 concrete examples grounded in real sessions (cite session ids and error
   categories). Separate Kiro-side failures (wrong approach, over-engineering) from
   user-side (unclear ask, empty sessions) and infrastructure (auth, 403s, timeouts).

## RECOMMENDATIONS
6. suggestions.steering_additions — 3 items. Each: the exact text to add to a Kiro
   steering doc, why (tied to specific sessions/error categories), and which steering
   file/section it belongs in.
7. suggestions.features_to_try — 3 items (e.g. Custom Agents, Hooks, MCP Servers,
   Skills). Each: feature name, one_liner, why_for_you (tied to my patterns), and a
   runnable example.
8. suggestions.usage_patterns — 3 items. Each: title, suggestion, detail with real
   numbers from the stats, and a copyable_prompt.
9. on_the_horizon — intro + 3 opportunities. Each: title, whats_possible, how_to_try,
   and a copyable_prompt for an ambitious/autonomous Kiro workflow.

## SUMMARY & FLOURISH
10. at_a_glance — 4 fields: whats_working, whats_hindering, quick_wins,
    ambitious_workflows. Each references the relevant detailed section. Write it LAST.
11. fun_ending — a headline + detail: one memorable moment inferred from my sessions,
    written with light humor but factually accurate.

## OUTPUT FORMAT — write ONE self-contained HTML document to a file
Your deliverable is a file, NOT a chat message. Using the `fs_write` tool, write
ONE complete HTML document to the exact file path given in the task. The document
MUST start with `<!DOCTYPE html>` and end with `</html>`. Because it is large,
write it incrementally: `fs_write` with `create` for the first chunk, then
`append` for subsequent chunks until the document is complete. Do NOT print the
HTML into the chat — after the file is fully written, reply with just the word
`done`.

Requirements:
- Fully self-contained: all CSS in a single inline `<style>`, all JS in inline
  `<script>`. The only allowed network reference is a Google Fonts `<link>`
  (Inter). No other external resources or requests.
- Light theme, clean rounded cards, generous spacing, Inter font. Document
  `<title>` and page `<h1>`: "Kiro Session Insights".
- Subtitle line summarizing the stats: messages, sessions analyzed vs. total,
  and the window date range.
- An "At a Glance" highlight box near the top with four labeled lines
  (What's working, What's hindering, Quick wins, Ambitious workflows), each with
  an anchor link (→) to its detailed section. Write this box LAST but place it near the top.
- A nav table-of-contents (`<nav>`) linking to every section by anchor id.
- A stats row of big-number tiles: Messages, Tool Calls, Tool Failures,
  Active Days, Msgs/Day.
- Sections (each with an `id` matching the TOC):
  1. "What You Work On" — 4-6 project-area cards (name, ~session count, 1-2 sentence
     description of what you did and how Kiro was used).
  2. "How You Use Kiro" — a 2-3 paragraph narrative characterizing me as a user
     (experience, how I scope tasks, how I react when Kiro goes off track), plus a
     highlighted one-sentence key pattern.
  3. Two side-by-side bar charts built from plain `<div>`s (a label, a track, a
     proportional fill, a value — like `.bar-row/.bar-track/.bar-fill`): "What You
     Wanted" (intent categories inferred from my prompts) and "Top Tools Used"
     (top tools by invocation count; note failures).
  4. "Impressive Things You Did" — an intro + 3 standout workflows (title + description)
     from my most successful sessions (low failure rate, high tool volume).
  5. "Where Things Go Wrong" — an intro + 3 friction categories, color-coded and each
     with 2 concrete examples grounded in real sessions (cite session ids + error
     categories). Separate Kiro-side failures (wrong approach, over-engineering) from
     user-side (unclear ask, empty sessions) and infrastructure (auth, 403s, timeouts).
  6. "Features to Try" — 3 Kiro features (Custom Agents, Hooks, MCP Servers, Skills, …):
     name, one-liner, why it fits my patterns, and a runnable example.
  7. "New Usage Patterns" — 3 patterns: title, suggestion, detail with real numbers from
     the stats, and a copyable prompt (in a `<code>` block).
  8. "On the Horizon" — intro + 3 opportunities: title, what's possible, how to try, and
     a copyable prompt for an ambitious/autonomous Kiro workflow.
  9. A fun ending banner: a headline + detail describing one memorable moment inferred
     from my sessions, light humor but factually accurate.

## OUTPUT RULES
- Voice: {{VOICE}}
- Every behavioral claim needs support from at least one real session (cite the
  session id); prefer two. Quote my actual directives verbatim where illustrative
  (via get_user_prompts).
- Clearly attribute cause: "Kiro did X" vs. "you did X" vs. "infrastructure failed".
- HTML-escape all text derived from my prompts/session data (`&`, `<`, `>`, quotes).
- The At a Glance box must be consistent with the detailed sections.
- The finished HTML file is the only deliverable."#
        .to_string()
}

fn voice_line(voice: Option<&str>) -> &str {
    match voice.map(|v| v.to_lowercase()) {
        Some(ref v) if v == "blunt" => "blunt and critical; no praise, no hedging.",
        Some(ref v) if v == "neutral" => "neutral and analytical; just the facts.",
        _ => "direct, specific, second-person (\"you\"); encouraging but honest about failures.",
    }
}

/// Resolve the path to the current executable so the agent config can spawn it
/// again in `mcp-server` mode.
fn self_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("cannot resolve current exe: {e}"))
}

/// Locate the kiro-cli binary. If `override_path` is set (non-empty, from the
/// user's settings), it takes precedence. Otherwise falls back to the common
/// install location, then PATH resolution by name.
fn kiro_cli_bin(override_path: Option<&str>) -> String {
    if let Some(p) = override_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    // Common install location seen on this platform, then PATH.
    let home = dirs::home_dir().unwrap_or_default();
    let candidate = home.join(".local/bin/kiro-cli");
    if candidate.exists() {
        return candidate.to_string_lossy().to_string();
    }
    "kiro-cli".to_string()
}

/// Build a PATH that includes the common CLI install locations. When the app
/// is launched from the macOS GUI (Finder/Dock), it inherits a minimal PATH
/// that omits `~/.local/bin`, Homebrew, etc. — so a child `kiro-cli` (and any
/// helper it spawns, like `node`/`uvx`) can fail with "No such file or
/// directory". Prepending the usual locations to the inherited PATH fixes it.
fn augmented_path() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let mut parts: Vec<String> = vec![
        home.join(".local/bin").to_string_lossy().to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    if let Ok(existing) = std::env::var("PATH") {
        for p in existing.split(':') {
            if !p.is_empty() && !parts.iter().any(|x| x == p) {
                parts.push(p.to_string());
            }
        }
    }
    parts.join(":")
}

/// Build a temp working directory containing `.kiro/agents/<AGENT_NAME>.json`
/// so kiro-cli discovers the agent as a workspace-local agent.
fn write_agent(work_dir: &PathBuf, prompt: &str) -> Result<(), String> {
    let exe = self_exe()?;
    let agents_dir = work_dir.join(".kiro/agents");
    fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    let config = json!({
        "name": AGENT_NAME,
        "description": "Read-only analyst over local Kiro session stats.",
        "prompt": prompt,
        "mcpServers": {
            "sessions": {
                "command": exe.to_string_lossy(),
                "args": ["mcp-server"],
                "timeout": 120000,
                "disabled": false
            }
        },
        "tools": ["@sessions", "thinking", "fs_write"],
        "allowedTools": ["@sessions", "thinking", "fs_write"],
        "toolAliases": {},
        "resources": [],
        "hooks": {},
        "toolsSettings": {},
        "useLegacyMcpJson": false
    });

    let path = agents_dir.join(format!("{AGENT_NAME}.json"));
    fs::write(&path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Run a headless analysis for `window`, persist the resulting HTML report,
/// and return its stored record (which carries the on-disk `htmlPath`).
/// `cli_path` optionally overrides the resolved kiro-cli binary path (see
/// [`kiro_cli_bin`]); pass `None` to use the default lookup.
pub fn run(
    window: Window,
    voice: Option<&str>,
    cli_path: Option<&str>,
) -> Result<store::AnalysisRecord, String> {
    let paths = paths::resolve();

    // 1. Seed payload — the optimized overview.
    let overview = analysis::compute_overview(&paths, window);
    let seed = serde_json::to_string_pretty(&overview).map_err(|e| e.to_string())?;

    // 2. Temp workspace-local agent that registers this binary as the MCP server.
    let work_dir = std::env::temp_dir().join(format!("kiro-analyst-{}", std::process::id()));
    let prompt = analyst_prompt().replace("{{VOICE}}", voice_line(voice));
    write_agent(&work_dir, &prompt)?;

    // Kiro writes the HTML report here (via fs_write) — writing to a file
    // sidesteps the output-token cap that truncates a large final chat message.
    let output_path = work_dir.join("report.html");

    // 3. Compose the user message: instructions + seed stats + output path.
    let message = format!(
        "Analyze my Kiro usage for the last {win}.\n\nHere is the seed get_overview payload for this window (call the tools to dig deeper):\n\n```json\n{seed}\n```\n\nWrite the complete HTML report to this exact file path using the fs_write tool (use `create` then `append` for large content):\n{out}\n\nAfter the file is fully written, reply with just `done`.",
        win = window.as_str(),
        seed = seed,
        out = output_path.display(),
    );

    // 4. Spawn kiro-cli headless. The agent's `tools` list restricts it to our
    //    read-only MCP tools + `thinking` + `fs_write`, so `--trust-all-tools`
    //    is safe here and reliably auto-approves the namespaced MCP tool calls
    //    (the `--trust-tools=@sessions` shorthand does not always match them).
    let cli_bin = kiro_cli_bin(cli_path);
    let output = Command::new(&cli_bin)
        .current_dir(&work_dir)
        .env("PATH", augmented_path())
        .arg("chat")
        .arg("--no-interactive")
        .arg("--agent")
        .arg(AGENT_NAME)
        .arg("--trust-all-tools")
        .arg(&message)
        .output()
        .map_err(|e| format!("failed to spawn kiro-cli (\"{cli_bin}\"): {e}"))?;

    // Read the report file Kiro wrote (before cleaning up the temp dir).
    let file_html = fs::read_to_string(&output_path).ok();
    let _ = fs::remove_dir_all(&work_dir);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // Prefer the file Kiro wrote when it's a complete document; this is the
    // normal, truncation-proof path.
    let complete = file_html
        .as_deref()
        .filter(|s| s.to_lowercase().contains("</html>"));
    if let Some(html) = complete {
        return store::save(window.as_str(), voice.unwrap_or("default"), html);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Surface both streams: kiro-cli prints the real failure to stderr, but
        // partial/interleaved report content lands on stdout. Also note the
        // resolved binary path, since a misconfigured custom path is a common
        // cause of a spawn/exec failure here.
        let tail = |s: &str| {
            let t = s.trim();
            if t.chars().count() > 1200 {
                let start = t.char_indices().rev().nth(1200).map(|(i, _)| i).unwrap_or(0);
                format!("…{}", &t[start..])
            } else {
                t.to_string()
            }
        };
        return Err(format!(
            "kiro-cli exited with {}.\nstderr: {}\nstdout: {}",
            output.status,
            tail(&stderr),
            tail(&stdout)
        ));
    }

    // Fallback: the model printed HTML to the chat instead of writing the file.
    // store::save extracts the document (or wraps raw text) as needed.
    store::save(window.as_str(), voice.unwrap_or("default"), &stdout)
}
