import Foundation

// MARK: - App settings

/// Centralized keys for `@AppStorage`-backed user preferences.
enum AppSettings {
    /// When false, IDE and legacy CLI (v2) sessions are hidden from the
    /// browsing surfaces, leaving only Unified (shared format) sessions.
    static let showNonUnifiedKey = "showNonUnifiedSessions"
}

// MARK: - Source (IDE / CLI / Unified)

/// Where a session came from.
/// - `ide`:     legacy Kiro IDE sessions (workspace-sessions storage).
/// - `cli`:     legacy Kiro CLI v2 sessions (flat `~/.kiro/sessions/cli` files).
/// - `unified`: the shared format used by both the new IDE and CLI (formerly
///              "CLI v3"). Going forward IDE and CLI write this same format.
enum SessionSource: String, Codable, Hashable, CaseIterable {
    case ide
    case cli
    case unified
}

extension SessionSource {
    /// Short label used for filters, counters, and legends.
    var label: String {
        switch self {
        case .ide: return "IDE"
        case .cli: return "CLI"
        case .unified: return "Unified"
        }
    }

    /// SF Symbol representing the source.
    var iconName: String {
        switch self {
        case .ide: return "display"
        case .cli: return "terminal"
        case .unified: return "arrow.triangle.merge"
        }
    }

    /// Full display name used in headers and cards.
    var displayName: String {
        switch self {
        case .ide: return "KIRO IDE"
        case .cli: return "KIRO CLI"
        case .unified: return "KIRO UNIFIED"
        }
    }

    /// True for the shared/unified format (new IDE + CLI).
    var isUnified: Bool { self == .unified }
}

/// Format a millisecond duration as a compact human string (e.g. "2h 14m", "45m 12s", "1d 3h").
func formatDuration(_ ms: Double) -> String {
    guard ms > 0 else { return "0m" }
    let totalSec = Int(ms / 1000)
    let days = totalSec / 86400
    let hours = (totalSec % 86400) / 3600
    let minutes = (totalSec % 3600) / 60
    let seconds = totalSec % 60
    if days > 0 { return "\(days)d \(hours)h" }
    if hours > 0 { return "\(hours)h \(minutes)m" }
    if minutes > 0 { return "\(minutes)m \(seconds)s" }
    return "\(seconds)s"
}

// MARK: - View models exposed to the UI

struct Workspace: Identifiable, Hashable {
    let id: String            // e.g. "ide:<base64url>" or "cli:<base64url>"
    let source: SessionSource
    let path: String          // decoded absolute workspace path
    let name: String          // last path component
    var sessions: [SessionSummary]

    var sessionCount: Int { sessions.count }
}

struct SessionSummary: Identifiable, Hashable {
    let id: String            // sessionId
    let title: String
    let date: Double          // unix ms
    let source: SessionSource
}

struct SessionDetail: Identifiable {
    let id: String
    let source: SessionSource
    let title: String
    let model: String
    let autonomyMode: String
    let sessionType: String
    let contextUsage: Double
    let workspacePath: String
    let messageCount: Int
    let totalCost: Double
    /// Wall-clock duration from session start to last activity, in ms.
    var durationMs: Double = 0
    /// CLI session format version (2 or 3); nil for IDE sessions.
    var cliVersion: Int? = nil
    let history: [HistoryMessage]
}

struct HistoryMessage: Identifiable {
    let id = UUID()
    let role: String
    let content: String
    let executionId: String?
    let actions: [AgentAction]
    let cost: Double
}

struct AgentAction: Identifiable {
    let id = UUID()
    let actionType: String
    let rawToolName: String?
    let actionState: String?
    let input: JSONValue?
    let output: JSONValue?
}

// MARK: - Dashboard aggregate models

struct DashboardData {
    var totalCost: Double
    var totalSessions: Int
    var totalExecutions: Int
    var totalDuration: Double
    var daily: [DailyStats]
    var modelSessions: [String: Int]
    var sessionTypes: [String: Int]
    var autonomyModes: [String: Int]
    var workspaces: [WorkspaceStats]
    var sourceStats: [SessionSource: SourceStats]
}

struct SourceStats {
    var sessions: Int
    var executions: Int
    var cost: Double
}

struct DailyStats: Identifiable {
    var id: String { date }
    let date: String          // yyyy-MM-dd
    var sessions: Int
    var cost: Double
    var executions: Int
    var ideSessions: Int
    var cliSessions: Int
    var ideCost: Double
    var cliCost: Double
    var ideExecutions: Int
    var cliExecutions: Int
    // Unified (shared IDE+CLI format). Defaulted so existing initializers still compile.
    var unifiedSessions: Int = 0
    var unifiedCost: Double = 0
    var unifiedExecutions: Int = 0

    /// Per-source credit spend for this day.
    func cost(for source: SessionSource) -> Double {
        switch source {
        case .ide: return ideCost
        case .cli: return cliCost
        case .unified: return unifiedCost
        }
    }

    /// Per-source execution count for this day.
    func executions(for source: SessionSource) -> Int {
        switch source {
        case .ide: return ideExecutions
        case .cli: return cliExecutions
        case .unified: return unifiedExecutions
        }
    }
}

struct WorkspaceStats: Identifiable {
    var id: String { "\(source.rawValue):\(name)" }
    let name: String
    let source: SessionSource
    let cost: Double
    let sessions: Int
    let executions: Int
    var duration: Double = 0
}

// MARK: - JSONValue: loosely-typed JSON for heterogeneous payloads

indirect enum JSONValue: Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let arr = try? c.decode([JSONValue].self) { self = .array(arr); return }
        if let obj = try? c.decode([String: JSONValue].self) { self = .object(obj); return }
        self = .null
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    // MARK: - Accessors

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    subscript(index: Int) -> JSONValue? {
        if case .array(let a) = self, a.indices.contains(index) { return a[index] }
        return nil
    }

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var doubleValue: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)
        default: return nil
        }
    }

    var boolValue: Bool? {
        switch self {
        case .bool(let b): return b
        case .number(let n): return n != 0
        case .string(let s):
            if s == "true" { return true }
            if s == "false" { return false }
            return nil
        default: return nil
        }
    }

    var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    /// Pretty-printed JSON representation (stable key ordering).
    func prettyString() -> String {
        let data = try? JSONSerialization.data(
            withJSONObject: toAny(),
            options: [.prettyPrinted, .sortedKeys]
        )
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }

    private func toAny() -> Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n): return n
        case .string(let s): return s
        case .array(let a): return a.map { $0.toAny() }
        case .object(let o): return o.mapValues { $0.toAny() }
        }
    }
}
