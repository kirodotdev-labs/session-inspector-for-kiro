use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use std::path::{Component, Path};

/// True when `s` is safe to use as a **single** filesystem path component when
/// joined onto a trusted base directory.
///
/// Externally-supplied identifiers (workspace ids, session ids, sub-session
/// ids) arrive over the Tauri IPC boundary and are interpolated into on-disk
/// paths by the session loaders. Without validation, a value like
/// `../../../../etc/hosts` or an absolute path would let a caller read files
/// outside the Kiro data directories (path traversal).
///
/// We defer to the OS path parser: `s` is accepted only if it parses to
/// exactly one [`Component::Normal`] and nothing else. This rejects empty
/// strings, `.`/`..`, path separators (`/` on Unix, `/` and `\` on Windows),
/// absolute paths, and Windows drive prefixes — on the same platform whose
/// separators would actually be honored by [`Path::join`]. Legitimate ids
/// (UUIDs, `sess_*`, base64url-encoded workspace dir names) are single normal
/// components and pass unchanged.
pub fn is_safe_path_component(s: &str) -> bool {
    if s.is_empty() || s.contains('\0') {
        return false;
    }
    let mut comps = Path::new(s).components();
    matches!(
        (comps.next(), comps.next()),
        (Some(Component::Normal(_)), None)
    )
}

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

#[cfg(test)]
mod tests {
    use super::is_safe_path_component;

    #[test]
    fn accepts_legitimate_ids() {
        // UUID-style, sess_-prefixed, and base64url workspace dir names.
        assert!(is_safe_path_component("a1b2c3d4-5e6f-7890-abcd-ef0123456789"));
        assert!(is_safe_path_component("sess_01HXYZ"));
        assert!(is_safe_path_component("L1VzZXJzL2FuZ21hcy9Qcm9qZWN0cw"));
        assert!(is_safe_path_component("plain"));
        // A literal `..` embedded in a name (not a parent ref) is a valid file.
        assert!(is_safe_path_component("foo..bar"));
    }

    #[test]
    fn rejects_traversal_and_separators() {
        assert!(!is_safe_path_component(""));
        assert!(!is_safe_path_component("."));
        assert!(!is_safe_path_component(".."));
        assert!(!is_safe_path_component("../etc/hosts"));
        assert!(!is_safe_path_component("../../../../etc/hosts"));
        assert!(!is_safe_path_component("foo/bar"));
        assert!(!is_safe_path_component("/etc/passwd"));
        assert!(!is_safe_path_component("a/../b"));
        assert!(!is_safe_path_component("with\0nul"));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_separators_and_prefixes() {
        assert!(!is_safe_path_component("..\\..\\secret"));
        assert!(!is_safe_path_component("C:\\Windows"));
        assert!(!is_safe_path_component("C:foo"));
    }
}
