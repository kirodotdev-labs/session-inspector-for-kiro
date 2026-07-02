use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};

/// Direct port of `decodeBase64Url` in `server/index.ts`. Node's
/// `Buffer.from(str, "base64")` silently skips characters outside the base64
/// alphabet rather than erroring, so we filter to the valid alphabet before
/// decoding to match that leniency.
fn try_decode(s: &str) -> Option<String> {
    let mut b: String = s
        .chars()
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    let pad = (4 - (b.len() % 4)) % 4;
    b.push_str(&"=".repeat(pad));
    let filtered: String = b
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/' || *c == '=')
        .collect();
    let decoded_bytes = STANDARD.decode(filtered.as_bytes()).ok()?;
    let decoded = String::from_utf8_lossy(&decoded_bytes);
    let mut clean = String::new();
    for ch in decoded.chars() {
        let code = ch as u32;
        if (0x20..=0x7e).contains(&code) && ch != '?' {
            clean.push(ch);
        } else {
            break;
        }
    }
    Some(clean)
}

pub fn decode_base64_url(s: &str) -> String {
    try_decode(s)
        .or_else(|| {
            if s.is_empty() {
                None
            } else {
                try_decode(&s[..s.len() - 1])
            }
        })
        .unwrap_or_else(|| s.to_string())
}

/// sha256(input) hex digest truncated to `len` chars. Used for workspace hash
/// directory names (IDE execution dirs use 32 chars; CLI v3 workspace dirs
/// use whatever the writer chose — we only ever read these, never compute the
/// v3 side, so no truncation length is assumed there).
pub fn sha256_hex_prefix(input: &str, len: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let hex = digest.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    hex.chars().take(len).collect()
}

/// Map CLI tool name to a normalized action type shared with the IDE view.
/// Handles both v2 (snake_case) and v3 (camelCase + snake_case) tool
/// vocabularies. Direct port of `normalizeCliToolType`.
pub fn normalize_cli_tool_type(name: &str) -> String {
    if name.is_empty() {
        return "tool".to_string();
    }
    let k: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let mapped = match k.as_str() {
        "shell" => Some("runCommand"),
        "executebash" => Some("runCommand"),
        "runcommand" => Some("runCommand"),
        "commandexecution" => Some("runCommand"),
        "read" => Some("readFiles"),
        "fsread" => Some("readFiles"),
        "readfile" => Some("readFiles"),
        "readfiles" => Some("readFiles"),
        "readmultiplefiles" => Some("readFiles"),
        "write" => Some("write"),
        "fswrite" => Some("write"),
        "writefile" => Some("write"),
        "replace" => Some("replace"),
        "strreplace" => Some("replace"),
        "create" => Some("create"),
        "knowledge" => Some("knowledge"),
        "listdirectory" => Some("search"),
        "filesearch" => Some("search"),
        "grepsearch" => Some("search"),
        "grep" => Some("search"),
        "invokesubagent" => Some("subagent"),
        _ => None,
    };
    if let Some(m) = mapped {
        return m.to_string();
    }
    if k.contains("search") {
        return "search".to_string();
    }
    name.to_string()
}
