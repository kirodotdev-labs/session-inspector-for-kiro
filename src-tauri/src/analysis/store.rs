//! On-disk store for generated analyses.
//!
//! Each analysis is persisted under the per-OS application-support directory:
//!   macOS:   ~/Library/Application Support/dev.kiro.sessions-inspector/analyses
//!   Linux:   ~/.local/share/dev.kiro.sessions-inspector/analyses
//!   Windows: %APPDATA%\dev.kiro.sessions-inspector\analyses
//! as two files per analysis:
//!   <id>.html  — the report itself (opened in the user's browser)
//!   <id>.json  — metadata (id, window, voice, timestamp, size)
//! so reports survive restarts and can be listed, reopened, and deleted.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const APP_IDENTIFIER: &str = "dev.kiro.sessions-inspector";

/// Metadata for one stored analysis. The HTML report lives alongside it as
/// `<id>.html`; `html_path` is the absolute path to that file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisRecord {
    pub id: String,
    pub window: String,
    pub voice: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "htmlPath")]
    pub html_path: String,
    #[serde(rename = "reportBytes")]
    pub report_bytes: usize,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Resolve (and create) the analyses directory for this OS.
pub fn analyses_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or("cannot resolve application-support directory")?
        .join(APP_IDENTIFIER)
        .join("analyses");
    fs::create_dir_all(&base).map_err(|e| format!("cannot create {}: {e}", base.display()))?;
    Ok(base)
}

/// Sanitize an id for safe use as a filename (defense against traversal).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn meta_path(id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err(format!("invalid analysis id: {id}"));
    }
    Ok(analyses_dir()?.join(format!("{id}.json")))
}

/// Absolute path to a stored report's HTML file.
pub fn html_path(id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err(format!("invalid analysis id: {id}"));
    }
    Ok(analyses_dir()?.join(format!("{id}.html")))
}

/// Strip ANSI/CSI escape sequences (kiro-cli's tool-call trace) from stdout.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
            }
            // Consume until the final byte of the sequence (a letter).
            while let Some(&nc) = chars.peek() {
                chars.next();
                if nc.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Pull the `<!doctype html>…</html>` document out of kiro-cli's stdout. If the
/// model didn't emit a full document, wrap the cleaned text in a minimal one so
/// there is always something openable in a browser.
fn extract_html(raw: &str) -> String {
    let clean = strip_ansi(raw);
    let lower = clean.to_lowercase();
    let start = lower
        .find("<!doctype html")
        .or_else(|| lower.find("<html"));
    let end = lower.rfind("</html>");
    if let (Some(s), Some(e)) = (start, end) {
        if e > s {
            return clean[s..e + "</html>".len()].to_string();
        }
    }
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Kiro Session Insights</title></head><body><pre style=\"white-space:pre-wrap;font-family:ui-monospace,monospace;padding:24px\">{}</pre></body></html>",
        escape_html(clean.trim())
    )
}

/// Persist a new analysis (writes `<id>.html` + `<id>.json`) and return its
/// metadata record.
pub fn save(window: &str, voice: &str, raw_report: &str) -> Result<AnalysisRecord, String> {
    let dir = analyses_dir()?;
    let created_at = now_ms();
    // millis + high-res nanos keeps ids unique even for back-to-back saves.
    let nanos = chrono::Utc::now().timestamp_subsec_nanos();
    let id = format!("analysis-{created_at}-{nanos:09}");

    let html = extract_html(raw_report);
    let html_file = dir.join(format!("{id}.html"));
    fs::write(&html_file, &html).map_err(|e| format!("cannot write {}: {e}", html_file.display()))?;

    let record = AnalysisRecord {
        id: id.clone(),
        window: window.to_string(),
        voice: voice.to_string(),
        created_at,
        html_path: html_file.to_string_lossy().to_string(),
        report_bytes: html.len(),
    };
    let mp = dir.join(format!("{id}.json"));
    fs::write(&mp, serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?)
        .map_err(|e| format!("cannot write {}: {e}", mp.display()))?;
    Ok(record)
}

/// List all stored analyses, newest first.
pub fn list() -> Vec<AnalysisRecord> {
    let dir = match analyses_dir() {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<AnalysisRecord> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(contents) = fs::read_to_string(&path) {
                if let Ok(rec) = serde_json::from_str::<AnalysisRecord>(&contents) {
                    out.push(rec);
                }
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// Delete a stored analysis (both files). Missing files are treated as success.
pub fn delete(id: &str) -> Result<(), String> {
    let rm = |p: PathBuf| match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete {}: {e}", p.display())),
    };
    rm(meta_path(id)?)?;
    rm(html_path(id)?)?;
    Ok(())
}

/// Open a stored analysis's HTML report in the user's default browser.
pub fn open(id: &str) -> Result<(), String> {
    let path = html_path(id)?;
    if !path.exists() {
        return Err(format!("report file not found for {id}"));
    }
    open_in_browser(&path)
}

/// Launch the OS default handler for a file path (the browser, for `.html`).
fn open_in_browser(path: &Path) -> Result<(), String> {
    let p = path.as_os_str();
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(p).spawn()
    } else if cfg!(target_os = "windows") {
        // `start` is a cmd builtin; the empty "" is the (required) window title.
        Command::new("cmd").args(["/C", "start", ""]).arg(p).spawn()
    } else {
        Command::new("xdg-open").arg(p).spawn()
    };
    result
        .map(|_| ())
        .map_err(|e| format!("failed to open report in browser: {e}"))
}
