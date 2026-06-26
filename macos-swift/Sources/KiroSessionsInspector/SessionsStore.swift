import Foundation
import CryptoKit

/// Reads Kiro session data directly from the local filesystem.
/// - IDE sessions: `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/...`
/// - CLI sessions: `~/.kiro/sessions/cli/{sessionId}.json` + `{sessionId}.jsonl`
@MainActor
final class SessionsStore: ObservableObject {
    @Published var workspaces: [Workspace] = []
    @Published var dashboard: DashboardData?
    @Published var isLoadingWorkspaces = false
    @Published var isLoadingDashboard = false

    private let fm = FileManager.default

    private var globalStorage: URL {
        fm.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent")
    }

    private var sessionsDir: URL {
        globalStorage.appendingPathComponent("workspace-sessions")
    }

    private var cliSessionsDir: URL {
        fm.homeDirectoryForCurrentUser.appendingPathComponent(".kiro/sessions/cli")
    }

    /// Per-workspace cache of executionId -> full execution JSON (IDE only).
    private var executionCache: [String: [String: JSONValue]] = [:]

    // MARK: - Workspaces list

    func loadWorkspaces() async {
        isLoadingWorkspaces = true
        defer { isLoadingWorkspaces = false }

        let ideDir = sessionsDir
        let cliDir = cliSessionsDir
        let result = await Task.detached(priority: .userInitiated) { [ideDir, cliDir] in
            let ide = SessionsStore.scanIdeWorkspaces(at: ideDir)
            let cli = SessionsStore.scanCliWorkspaces(at: cliDir)
            return ide + cli
        }.value

        self.workspaces = result
    }

    // MARK: - IDE workspace scanning

    private static nonisolated func scanIdeWorkspaces(at sessionsDir: URL) -> [Workspace] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: sessionsDir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var results: [Workspace] = []
        for url in entries {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else { continue }

            let dirName = url.lastPathComponent
            let sessionsFile = url.appendingPathComponent("sessions.json")
            guard let data = try? Data(contentsOf: sessionsFile),
                  let sessions = try? JSONDecoder().decode([RawSessionSummary].self, from: data),
                  !sessions.isEmpty else {
                continue
            }

            let decodedPath = decodeBase64URL(dirName)
            let projectName = decodedPath
                .split(separator: "/")
                .last
                .map(String.init) ?? dirName

            let summaries = sessions.map {
                SessionSummary(
                    id: $0.sessionId,
                    title: $0.title ?? "Untitled",
                    date: Double($0.dateCreated) ?? 0,
                    source: .ide
                )
            }

            results.append(Workspace(
                id: "ide:\(dirName)",
                source: .ide,
                path: decodedPath,
                name: projectName,
                sessions: summaries
            ))
        }

        results.sort { $0.sessionCount > $1.sessionCount }
        return results
    }

    // MARK: - CLI workspace scanning

    /// CLI sessions are a flat directory of `{id}.json` + `{id}.jsonl` files.
    /// We group them by `cwd` to form pseudo-workspaces.
    private static nonisolated func scanCliWorkspaces(at cliDir: URL) -> [Workspace] {
        let metas = loadAllCliSessionMeta(at: cliDir)

        var byCwd: [String: [CliSessionMeta]] = [:]
        for m in metas {
            let key = m.cwd.isEmpty ? "(unknown)" : m.cwd
            byCwd[key, default: []].append(m)
        }

        var results: [Workspace] = []
        for (cwd, list) in byCwd {
            let projectName = cwd.split(separator: "/").last.map(String.init) ?? cwd
            let encoded = Data(cwd.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")

            let summaries = list
                .sorted(by: { $0.updatedAt > $1.updatedAt })
                .map {
                    SessionSummary(
                        id: $0.sessionId,
                        title: $0.title.isEmpty ? "Untitled" : $0.title,
                        date: $0.updatedAt > 0 ? $0.updatedAt : $0.createdAt,
                        source: .cli
                    )
                }

            results.append(Workspace(
                id: "cli:\(encoded)",
                source: .cli,
                path: cwd,
                name: projectName,
                sessions: summaries
            ))
        }

        results.sort { $0.sessionCount > $1.sessionCount }
        return results
    }

    // MARK: - Session detail (dispatches to IDE vs CLI)

    func loadSessionDetail(workspaceId: String, sessionId: String) async -> SessionDetail? {
        if workspaceId.hasPrefix("cli:") {
            return await loadCliSessionDetail(sessionId: sessionId)
        }
        return await loadIdeSessionDetail(
            workspaceId: workspaceId.hasPrefix("ide:")
                ? String(workspaceId.dropFirst(4))
                : workspaceId,
            sessionId: sessionId
        )
    }

    // MARK: - IDE session detail

    private func loadIdeSessionDetail(workspaceId: String, sessionId: String) async -> SessionDetail? {
        let sessionFile = sessionsDir
            .appendingPathComponent(workspaceId)
            .appendingPathComponent("\(sessionId).json")

        let storage = globalStorage
        let cached = executionCache

        struct Output { let detail: SessionDetail?; let cacheKey: String?; let execMap: [String: JSONValue]? }

        let result = await Task.detached(priority: .userInitiated) { [sessionFile, storage, cached] in
            guard let data = try? Data(contentsOf: sessionFile) else {
                return Output(detail: nil, cacheKey: nil, execMap: nil)
            }
            guard let json = try? JSONDecoder().decode(JSONValue.self, from: data) else {
                return Output(detail: nil, cacheKey: nil, execMap: nil)
            }

            let workspacePath = json["workspaceDirectory"]?.stringValue ?? ""
            let execMap: [String: JSONValue]
            let cacheKey: String?
            if let existing = cached[workspacePath] {
                execMap = existing
                cacheKey = nil
            } else {
                execMap = SessionsStore.loadExecutions(workspacePath: workspacePath, globalStorage: storage)
                cacheKey = workspacePath
            }

            let detail = SessionsStore.buildIdeSessionDetail(json: json, execMap: execMap)
            return Output(detail: detail, cacheKey: cacheKey, execMap: execMap)
        }.value

        if let key = result.cacheKey, let map = result.execMap {
            executionCache[key] = map
        }
        return result.detail
    }

    private static nonisolated func buildIdeSessionDetail(json: JSONValue, execMap: [String: JSONValue]) -> SessionDetail {
        let historyRaw = json["history"]?.arrayValue ?? []

        let messages: [HistoryMessage] = historyRaw.map { entry in
            let msg = entry["message"]
            let role = msg?["role"]?.stringValue ?? "unknown"

            var content = ""
            if let s = msg?["content"]?.stringValue {
                content = s
            } else if let arr = msg?["content"]?.arrayValue {
                content = arr.compactMap { part -> String? in
                    if part["type"]?.stringValue == "text" { return part["text"]?.stringValue }
                    return nil
                }.joined(separator: "\n")
            }

            let executionId = entry["executionId"]?.stringValue
            var actions: [AgentAction] = []
            var cost: Double = 0

            if let eid = executionId, let execData = execMap[eid] {
                actions = extractIdeActions(from: execData)
                cost = extractCost(from: execData)
            }

            return HistoryMessage(
                role: role,
                content: content,
                executionId: executionId,
                actions: actions,
                cost: cost
            )
        }

        let totalCost = messages.reduce(0) { $0 + $1.cost }

        return SessionDetail(
            id: json["sessionId"]?.stringValue ?? "",
            source: .ide,
            title: json["title"]?.stringValue ?? "Untitled",
            model: json["selectedModel"]?.stringValue
                ?? json["defaultModelTitle"]?.stringValue
                ?? "unknown",
            autonomyMode: json["autonomyMode"]?.stringValue ?? "unknown",
            sessionType: json["sessionType"]?.stringValue ?? "unknown",
            contextUsage: json["contextUsagePercentage"]?.doubleValue ?? 0,
            workspacePath: json["workspaceDirectory"]?.stringValue ?? "",
            messageCount: messages.count,
            totalCost: totalCost,
            history: messages
        )
    }

    private static nonisolated func extractIdeActions(from exec: JSONValue) -> [AgentAction] {
        guard let arr = exec["actions"]?.arrayValue else { return [] }
        return arr.compactMap { a -> AgentAction? in
            guard let type = a["actionType"]?.stringValue,
                  type != "intentClassification",
                  type != "model" else { return nil }
            return AgentAction(
                actionType: type,
                rawToolName: nil,
                actionState: a["actionState"]?.stringValue,
                input: a["input"],
                output: a["output"]
            )
        }
    }

    private static nonisolated func extractCost(from exec: JSONValue) -> Double {
        guard let summary = exec["usageSummary"]?.arrayValue else { return 0 }
        return summary.reduce(0.0) { $0 + ($1["usage"]?.doubleValue ?? 0) }
    }

    // MARK: - Execution file loading (IDE)

    private static nonisolated func loadExecutions(workspacePath: String, globalStorage: URL) -> [String: JSONValue] {
        guard !workspacePath.isEmpty else { return [:] }
        let hash = sha256Hex(workspacePath).prefix(32)
        let wsDir = globalStorage.appendingPathComponent(String(hash))
        let fm = FileManager.default
        guard fm.fileExists(atPath: wsDir.path) else { return [:] }

        var map: [String: JSONValue] = [:]
        guard let subEntries = try? fm.contentsOfDirectory(
            at: wsDir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return map }

        for sub in subEntries {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: sub.path, isDirectory: &isDir), isDir.boolValue else { continue }
            guard let files = try? fm.contentsOfDirectory(
                at: sub,
                includingPropertiesForKeys: [.fileSizeKey],
                options: [.skipsHiddenFiles]
            ) else { continue }

            for file in files {
                guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                      size >= 100,
                      let data = try? Data(contentsOf: file),
                      let json = try? JSONDecoder().decode(JSONValue.self, from: data),
                      let execId = json["executionId"]?.stringValue,
                      json["actions"]?.arrayValue != nil else {
                    continue
                }
                map[execId] = json
            }
        }
        return map
    }

    // MARK: - CLI session detail

    private func loadCliSessionDetail(sessionId: String) async -> SessionDetail? {
        let cliDir = cliSessionsDir
        return await Task.detached(priority: .userInitiated) { [cliDir, sessionId] in
            // Locate the session across both v2 and v3 sources.
            let metas = loadAllCliSessionMeta(at: cliDir)
            guard let meta = metas.first(where: { $0.sessionId == sessionId }) else {
                return nil
            }
            if meta.version == 3, let dir = meta.v3Dir {
                return SessionsStore.buildCliV3SessionDetail(meta: meta, sessionDir: dir)
            }
            let metaFile = cliDir.appendingPathComponent("\(sessionId).json")
            let traceFile = cliDir.appendingPathComponent("\(sessionId).jsonl")
            return SessionsStore.buildCliSessionDetail(metaFile: metaFile, traceFile: traceFile)
        }.value
    }

    private static nonisolated func buildCliSessionDetail(metaFile: URL, traceFile: URL) -> SessionDetail? {
        guard let meta = loadCliSessionMeta(at: metaFile) else { return nil }

        // Parse jsonl into user/assistant messages.
        var history: [HistoryMessage] = []
        var pendingToolUses: [String: (msgIndex: Int, actionIndex: Int)] = [:]

        // Cost per assistant turn, taken from metering_usage in the meta file.
        let turns = meta.turnCosts
        var turnIdx = 0

        let fm = FileManager.default
        if fm.fileExists(atPath: traceFile.path),
           let raw = try? String(contentsOf: traceFile, encoding: .utf8) {
            for line in raw.split(separator: "\n") where !line.isEmpty {
                guard let data = line.data(using: .utf8),
                      let record = try? JSONDecoder().decode(JSONValue.self, from: data) else { continue }

                let kind = record["kind"]?.stringValue ?? ""
                let content = record["data"]?["content"]?.arrayValue ?? []

                switch kind {
                case "Prompt":
                    let text = content.compactMap { c -> String? in
                        guard c["kind"]?.stringValue == "text" else { return nil }
                        return c["data"]?.stringValue
                    }.joined(separator: "\n")
                    history.append(HistoryMessage(
                        role: "user", content: text, executionId: nil,
                        actions: [], cost: 0
                    ))

                case "AssistantMessage":
                    // Collect this assistant turn (may span several records until the next Prompt).
                    let needNew = history.last?.role != "assistant"
                    if needNew {
                        let cost = turnIdx < turns.count ? turns[turnIdx] : 0
                        turnIdx += 1
                        history.append(HistoryMessage(
                            role: "assistant", content: "", executionId: nil,
                            actions: [], cost: cost
                        ))
                    }

                    var last = history.removeLast()
                    for c in content {
                        let ck = c["kind"]?.stringValue ?? ""
                        if ck == "text", let t = c["data"]?.stringValue, !t.isEmpty {
                            last = HistoryMessage(
                                role: last.role,
                                content: last.content.isEmpty ? t : last.content + "\n" + t,
                                executionId: last.executionId,
                                actions: last.actions,
                                cost: last.cost
                            )
                        } else if ck == "toolUse" {
                            let tu = c["data"]
                            let name = tu?["name"]?.stringValue ?? ""
                            let input = tu?["input"]
                            var newActions = last.actions
                            let actionIndex = newActions.count
                            newActions.append(AgentAction(
                                actionType: normalizeCliToolType(name),
                                rawToolName: name,
                                actionState: "Pending",
                                input: input,
                                output: nil
                            ))
                            if let id = tu?["toolUseId"]?.stringValue {
                                pendingToolUses[id] = (msgIndex: history.count, actionIndex: actionIndex)
                            }
                            last = HistoryMessage(
                                role: last.role,
                                content: last.content,
                                executionId: last.executionId,
                                actions: newActions,
                                cost: last.cost
                            )
                        }
                    }
                    history.append(last)

                case "ToolResults":
                    for c in content where c["kind"]?.stringValue == "toolResult" {
                        let tr = c["data"]
                        guard let id = tr?["toolUseId"]?.stringValue,
                              let ref = pendingToolUses[id],
                              ref.msgIndex < history.count,
                              ref.actionIndex < history[ref.msgIndex].actions.count else { continue }

                        let status = tr?["status"]?.stringValue ?? "unknown"
                        let state: String
                        switch status {
                        case "success": state = "Success"
                        case "error":   state = "Error"
                        default:        state = status.capitalized
                        }

                        // Flatten tool result content for display.
                        let items = tr?["content"]?.arrayValue ?? []
                        let output: JSONValue?
                        if items.count == 1 {
                            let only = items[0]
                            switch only["kind"]?.stringValue ?? "" {
                            case "json": output = only["data"]
                            case "text": output = only["data"]
                            default: output = only
                            }
                        } else if items.count > 1 {
                            let mapped = items.map { it -> JSONValue in
                                if it["kind"]?.stringValue == "text" { return it["data"] ?? .null }
                                return it
                            }
                            output = .array(mapped)
                        } else {
                            output = nil
                        }

                        var msg = history[ref.msgIndex]
                        var newActions = msg.actions
                        let old = newActions[ref.actionIndex]
                        newActions[ref.actionIndex] = AgentAction(
                            actionType: old.actionType,
                            rawToolName: old.rawToolName,
                            actionState: state,
                            input: old.input,
                            output: output
                        )
                        msg = HistoryMessage(
                            role: msg.role, content: msg.content, executionId: msg.executionId,
                            actions: newActions, cost: msg.cost
                        )
                        history[ref.msgIndex] = msg
                        pendingToolUses.removeValue(forKey: id)
                    }

                default:
                    break
                }
            }
        }

        return SessionDetail(
            id: meta.sessionId,
            source: .cli,
            title: meta.title,
            model: meta.model,
            autonomyMode: meta.agentName, // CLI surfaces agent name in autonomy slot
            sessionType: "cli",
            contextUsage: meta.contextUsage,
            workspacePath: meta.cwd,
            messageCount: history.count,
            totalCost: meta.totalCost,
            cliVersion: 2,
            history: history
        )
    }

    private static nonisolated func normalizeCliToolType(_ name: String) -> String {
        if name.isEmpty { return "tool" }
        // Collapse to lowercase alphanumerics so "execute_bash"/"executeBash" match.
        let k = name.lowercased().filter { $0.isLetter || $0.isNumber }
        let map: [String: String] = [
            "shell": "runCommand",
            "executebash": "runCommand",
            "runcommand": "runCommand",
            "commandexecution": "runCommand",
            "read": "readFiles",
            "fsread": "readFiles",
            "readfile": "readFiles",
            "readfiles": "readFiles",
            "readmultiplefiles": "readFiles",
            "write": "write",
            "fswrite": "write",
            "writefile": "write",
            "replace": "replace",
            "strreplace": "replace",
            "create": "create",
            "knowledge": "knowledge",
            "listdirectory": "search",
            "filesearch": "search",
            "grepsearch": "search",
            "grep": "search",
            "invokesubagent": "subagent",
        ]
        if let mapped = map[k] { return mapped }
        if k.contains("search") { return "search" }
        return name
    }

    // MARK: - CLI v3 trace parsing

    private static nonisolated func buildCliV3SessionDetail(meta: CliSessionMeta, sessionDir: URL) -> SessionDetail {
        let messagesFile = sessionDir.appendingPathComponent("messages.jsonl")

        // Parse all records once.
        var records: [JSONValue] = []
        let fm = FileManager.default
        if fm.fileExists(atPath: messagesFile.path),
           let raw = try? String(contentsOf: messagesFile, encoding: .utf8) {
            for line in raw.split(separator: "\n") where !line.isEmpty {
                if let data = line.data(using: .utf8),
                   let rec = try? JSONDecoder().decode(JSONValue.self, from: data) {
                    records.append(rec)
                }
            }
        }

        // Pass 1: cost per executionId from usage_summary records.
        var costByExec: [String: Double] = [:]
        for rec in records {
            let p = rec["payload"]
            guard p?["type"]?.stringValue == "usage_summary" else { continue }
            var c: Double = 0
            for s in p?["promptTurnSummaries"]?.arrayValue ?? [] {
                c += s["usage"]?.doubleValue ?? 0
            }
            if let eid = p?["executionId"]?.stringValue {
                costByExec[eid, default: 0] += c
            }
        }

        // Pass 2: build the message thread.
        var history: [HistoryMessage] = []
        var toolRefs: [String: (msgIndex: Int, actionIndex: Int)] = [:]
        var costConsumed: Set<String> = []
        var curAssistantIdx = -1
        var curExecId: String? = nil

        // Ensure there's a current assistant message for the given execution.
        // Returns the index in `history`.
        func ensureAssistant(_ execId: String?) -> Int {
            if curAssistantIdx >= 0,
               curAssistantIdx < history.count,
               history[curAssistantIdx].role == "assistant",
               curExecId == execId {
                return curAssistantIdx
            }
            var cost: Double = 0
            if let eid = execId, !costConsumed.contains(eid) {
                cost = costByExec[eid] ?? 0
                costConsumed.insert(eid)
            }
            history.append(HistoryMessage(
                role: "assistant", content: "", executionId: execId,
                actions: [], cost: cost
            ))
            curAssistantIdx = history.count - 1
            curExecId = execId
            return curAssistantIdx
        }

        for rec in records {
            let p = rec["payload"]
            let type = p?["type"]?.stringValue ?? ""
            let execId = p?["executionId"]?.stringValue

            switch type {
            case "user":
                let content = p?["content"]?.stringValue ?? ""
                if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
                history.append(HistoryMessage(
                    role: "user", content: content, executionId: nil,
                    actions: [], cost: 0
                ))
                curAssistantIdx = -1
                curExecId = nil

            case "assistant":
                let idx = ensureAssistant(execId)
                let text = p?["content"]?.stringValue ?? ""
                if !text.isEmpty {
                    let msg = history[idx]
                    let newContent = msg.content.isEmpty ? text : msg.content + "\n" + text
                    history[idx] = HistoryMessage(
                        role: msg.role, content: newContent, executionId: msg.executionId,
                        actions: msg.actions, cost: msg.cost
                    )
                }

            case "tool_call":
                let idx = ensureAssistant(execId)
                let name = p?["toolName"]?.stringValue ?? ""
                let msg = history[idx]
                var actions = msg.actions
                let actionIndex = actions.count
                actions.append(AgentAction(
                    actionType: normalizeCliToolType(name),
                    rawToolName: name,
                    actionState: "Pending",
                    input: p?["args"] ?? .object([:]),
                    output: nil
                ))
                history[idx] = HistoryMessage(
                    role: msg.role, content: msg.content, executionId: msg.executionId,
                    actions: actions, cost: msg.cost
                )
                if let id = p?["toolCallId"]?.stringValue {
                    toolRefs[id] = (msgIndex: idx, actionIndex: actionIndex)
                }

            case "tool_result":
                guard let id = p?["toolCallId"]?.stringValue,
                      let ref = toolRefs[id],
                      ref.msgIndex < history.count,
                      ref.actionIndex < history[ref.msgIndex].actions.count else { continue }
                let state = (p?["success"]?.boolValue == false) ? "Error" : "Success"
                // Content is usually a JSON string; parse it when possible.
                var output: JSONValue? = p?["content"]
                if let s = p?["content"]?.stringValue,
                   let data = s.data(using: .utf8),
                   let parsed = try? JSONDecoder().decode(JSONValue.self, from: data) {
                    output = parsed
                }
                let msg = history[ref.msgIndex]
                var actions = msg.actions
                let old = actions[ref.actionIndex]
                actions[ref.actionIndex] = AgentAction(
                    actionType: old.actionType, rawToolName: old.rawToolName,
                    actionState: state, input: old.input, output: output
                )
                history[ref.msgIndex] = HistoryMessage(
                    role: msg.role, content: msg.content, executionId: msg.executionId,
                    actions: actions, cost: msg.cost
                )
                toolRefs.removeValue(forKey: id)

            case "sub_agent_start":
                let parentExec = p?["parentExecutionId"]?.stringValue ?? execId
                let idx = ensureAssistant(parentExec)
                let msg = history[idx]
                var actions = msg.actions
                actions.append(AgentAction(
                    actionType: "subagent",
                    rawToolName: p?["subAgentName"]?.stringValue ?? "invoke_sub_agent",
                    actionState: "Success",
                    input: .object([
                        "subAgentName": p?["subAgentName"] ?? .null,
                        "prompt": p?["prompt"] ?? .null,
                    ]),
                    output: nil
                ))
                history[idx] = HistoryMessage(
                    role: msg.role, content: msg.content, executionId: msg.executionId,
                    actions: actions, cost: msg.cost
                )

            default:
                break
            }
        }

        return SessionDetail(
            id: meta.sessionId,
            source: .cli,
            title: meta.title,
            model: meta.model,
            autonomyMode: meta.agentName,
            sessionType: "cli",
            contextUsage: meta.contextUsage,
            workspacePath: meta.cwd,
            messageCount: history.count,
            totalCost: meta.totalCost,
            cliVersion: 3,
            history: history
        )
    }

    // MARK: - Dashboard aggregation

    func loadDashboard() async {
        isLoadingDashboard = true
        defer { isLoadingDashboard = false }

        let ideDir = sessionsDir
        let storage = globalStorage
        let cliDir = cliSessionsDir
        let result = await Task.detached(priority: .userInitiated) { [ideDir, storage, cliDir] in
            SessionsStore.buildDashboard(
                sessionsDir: ideDir,
                globalStorage: storage,
                cliSessionsDir: cliDir
            )
        }.value

        self.dashboard = result
    }

    private static nonisolated func buildDashboard(
        sessionsDir: URL,
        globalStorage: URL,
        cliSessionsDir: URL
    ) -> DashboardData {
        let fm = FileManager.default
        var totalCost: Double = 0
        var totalSessions = 0
        var totalExecutions = 0
        var daily: [String: DailyStats] = [:]
        var modelSessions: [String: Int] = [:]
        var sessionTypes: [String: Int] = [:]
        var autonomyModes: [String: Int] = [:]
        var workspaces: [String: WorkspaceStats] = [:]
        var sourceStats: [SessionSource: SourceStats] = [
            .ide: SourceStats(sessions: 0, executions: 0, cost: 0),
            .cli: SourceStats(sessions: 0, executions: 0, cost: 0),
        ]

        let dayFormatter: (Double) -> String = { ms in
            let date = Date(timeIntervalSince1970: ms / 1000)
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withFullDate]
            return f.string(from: date)
        }

        let blankStats: (String) -> DailyStats = { key in
            DailyStats(
                date: key,
                sessions: 0, cost: 0, executions: 0,
                ideSessions: 0, cliSessions: 0,
                ideCost: 0, cliCost: 0,
                ideExecutions: 0, cliExecutions: 0
            )
        }

        // --- IDE ---

        if let wsEntries = try? fm.contentsOfDirectory(
            at: sessionsDir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) {
            for wsUrl in wsEntries {
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: wsUrl.path, isDirectory: &isDir), isDir.boolValue else { continue }
                let dirName = wsUrl.lastPathComponent

                let sessionsFile = wsUrl.appendingPathComponent("sessions.json")
                guard let data = try? Data(contentsOf: sessionsFile),
                      let sessions = try? JSONDecoder().decode([RawSessionSummary].self, from: data),
                      !sessions.isEmpty else { continue }

                let decodedPath = decodeBase64URL(dirName)
                let projectName = decodedPath.split(separator: "/").last.map(String.init) ?? dirName
                totalSessions += sessions.count
                sourceStats[.ide]?.sessions += sessions.count

                // Per-session model/type/mode
                for s in sessions {
                    let file = wsUrl.appendingPathComponent("\(s.sessionId).json")
                    guard let sData = try? Data(contentsOf: file),
                          let json = try? JSONDecoder().decode(JSONValue.self, from: sData) else { continue }
                    let model = json["selectedModel"]?.stringValue
                        ?? json["defaultModelTitle"]?.stringValue
                        ?? "unknown"
                    let sType = json["sessionType"]?.stringValue ?? "unknown"
                    let aMode = json["autonomyMode"]?.stringValue ?? "unknown"
                    modelSessions[model, default: 0] += 1
                    sessionTypes[sType, default: 0] += 1
                    autonomyModes[aMode, default: 0] += 1
                }

                // Sessions-by-date
                for s in sessions {
                    let key = dayFormatter(Double(s.dateCreated) ?? 0)
                    var stats = daily[key] ?? blankStats(key)
                    stats.sessions += 1
                    stats.ideSessions += 1
                    daily[key] = stats
                }

                // Executions for this workspace
                let hash = sha256Hex(decodedPath).prefix(32)
                let execDir = globalStorage.appendingPathComponent(String(hash))
                var wsCost: Double = 0
                var wsExecs = 0

                if fm.fileExists(atPath: execDir.path),
                   let subEntries = try? fm.contentsOfDirectory(
                    at: execDir,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                   ) {
                    for sub in subEntries {
                        var sIsDir: ObjCBool = false
                        guard fm.fileExists(atPath: sub.path, isDirectory: &sIsDir), sIsDir.boolValue else { continue }
                        guard let files = try? fm.contentsOfDirectory(
                            at: sub,
                            includingPropertiesForKeys: [.fileSizeKey],
                            options: [.skipsHiddenFiles]
                        ) else { continue }
                        for file in files {
                            guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                                  size >= 100,
                                  let data = try? Data(contentsOf: file),
                                  let json = try? JSONDecoder().decode(JSONValue.self, from: data),
                                  json["executionId"]?.stringValue != nil,
                                  json["actions"]?.arrayValue != nil else { continue }

                            wsExecs += 1
                            totalExecutions += 1
                            sourceStats[.ide]?.executions += 1

                            let cost = extractCost(from: json)
                            wsCost += cost
                            totalCost += cost
                            sourceStats[.ide]?.cost += cost

                            let startTime = json["startTime"]?.doubleValue ?? 0
                            let key = dayFormatter(startTime)
                            var stats = daily[key] ?? blankStats(key)
                            stats.cost += cost
                            stats.executions += 1
                            stats.ideCost += cost
                            stats.ideExecutions += 1
                            daily[key] = stats
                        }
                    }
                }

                workspaces["ide:\(projectName)"] = WorkspaceStats(
                    name: projectName,
                    source: .ide,
                    cost: wsCost,
                    sessions: sessions.count,
                    executions: wsExecs
                )
            }
        }

        // --- CLI ---

        let cliMetas = loadAllCliSessionMeta(at: cliSessionsDir)
        var cliAgg: [String: (cost: Double, sessions: Int, executions: Int)] = [:]
        for s in cliMetas {
            totalSessions += 1
            sourceStats[.cli]?.sessions += 1
            modelSessions[s.model, default: 0] += 1
            sessionTypes["cli", default: 0] += 1
            autonomyModes[s.agentName, default: 0] += 1

            totalExecutions += s.turnCount
            sourceStats[.cli]?.executions += s.turnCount
            totalCost += s.totalCost
            sourceStats[.cli]?.cost += s.totalCost

            let createdKey = dayFormatter(s.createdAt > 0 ? s.createdAt : s.updatedAt)
            var createdStats = daily[createdKey] ?? blankStats(createdKey)
            createdStats.sessions += 1
            createdStats.cliSessions += 1
            daily[createdKey] = createdStats

            let updatedKey = dayFormatter(s.updatedAt > 0 ? s.updatedAt : s.createdAt)
            var stats = daily[updatedKey] ?? blankStats(updatedKey)
            stats.cost += s.totalCost
            stats.executions += s.turnCount
            stats.cliCost += s.totalCost
            stats.cliExecutions += s.turnCount
            daily[updatedKey] = stats

            let projectName = s.cwd.split(separator: "/").last.map(String.init)
                ?? (s.cwd.isEmpty ? "(unknown)" : s.cwd)
            var agg = cliAgg[projectName] ?? (0, 0, 0)
            agg.cost += s.totalCost
            agg.sessions += 1
            agg.executions += s.turnCount
            cliAgg[projectName] = agg
        }

        for (name, agg) in cliAgg {
            workspaces["cli:\(name)"] = WorkspaceStats(
                name: name, source: .cli,
                cost: agg.cost, sessions: agg.sessions, executions: agg.executions
            )
        }

        let sortedDaily = daily.values.sorted { $0.date < $1.date }
        let sortedWorkspaces = workspaces.values.sorted { $0.cost > $1.cost }

        return DashboardData(
            totalCost: totalCost,
            totalSessions: totalSessions,
            totalExecutions: totalExecutions,
            daily: sortedDaily,
            modelSessions: modelSessions,
            sessionTypes: sessionTypes,
            autonomyModes: autonomyModes,
            workspaces: sortedWorkspaces,
            sourceStats: sourceStats
        )
    }
}

// MARK: - CLI session metadata helpers

private struct CliSessionMeta {
    let sessionId: String
    let title: String
    let cwd: String
    let createdAt: Double   // unix ms
    let updatedAt: Double   // unix ms
    let model: String
    let agentName: String
    let contextUsage: Double
    let totalCost: Double
    let turnCount: Int
    let turnCosts: [Double]
    var version: Int = 2
    // v3 only: directory containing session.json + messages.jsonl
    var v3Dir: URL? = nil
}

private func loadCliSessionMeta(at file: URL) -> CliSessionMeta? {
    guard let data = try? Data(contentsOf: file),
          let json = try? JSONDecoder().decode(JSONValue.self, from: data),
          let sid = json["session_id"]?.stringValue else {
        return nil
    }
    let ss = json["session_state"]
    let cm = ss?["conversation_metadata"]
    let turns = cm?["user_turn_metadatas"]?.arrayValue ?? []

    var totalCost: Double = 0
    var turnCosts: [Double] = []
    var lastCtx: Double = 0
    for t in turns {
        var c: Double = 0
        for m in t["metering_usage"]?.arrayValue ?? [] {
            c += m["value"]?.doubleValue ?? 0
        }
        turnCosts.append(c)
        totalCost += c
        if let ctx = t["context_usage_percentage"]?.doubleValue { lastCtx = ctx }
    }

    let createdMs = parseIsoMs(json["created_at"]?.stringValue ?? "")
    let updatedMs = parseIsoMs(json["updated_at"]?.stringValue ?? "")

    return CliSessionMeta(
        sessionId: sid,
        title: json["title"]?.stringValue ?? "",
        cwd: json["cwd"]?.stringValue ?? "",
        createdAt: createdMs,
        updatedAt: updatedMs > 0 ? updatedMs : createdMs,
        model: ss?["rts_model_state"]?["model_info"]?["model_id"]?.stringValue ?? "auto",
        agentName: ss?["agent_name"]?.stringValue ?? "kiro_default",
        contextUsage: ss?["rts_model_state"]?["context_usage_percentage"]?.doubleValue ?? lastCtx,
        totalCost: totalCost,
        turnCount: turns.count,
        turnCosts: turnCosts
    )
}

private func loadAllCliSessionMeta(at cliDir: URL) -> [CliSessionMeta] {
    let fm = FileManager.default
    var results: [CliSessionMeta] = []

    // v2: flat directory of {id}.json + {id}.jsonl
    if fm.fileExists(atPath: cliDir.path),
       let entries = try? fm.contentsOfDirectory(
        at: cliDir,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
       ) {
        for url in entries where url.pathExtension == "json" {
            if let meta = loadCliSessionMeta(at: url) {
                results.append(meta)
            }
        }
    }

    // v3: ~/.kiro/sessions/{workspaceHash}/sess_{id}/  (parent of the cli dir)
    let v3Root = cliDir.deletingLastPathComponent()
    results.append(contentsOf: loadAllCliV3SessionMeta(at: v3Root, excluding: cliDir))

    return results
}

/// Scans the v3 session tree: workspace-hash directories each containing
/// `sess_{id}` directories with `session.json` + `messages.jsonl`.
private func loadAllCliV3SessionMeta(at root: URL, excluding cliDir: URL) -> [CliSessionMeta] {
    let fm = FileManager.default
    guard fm.fileExists(atPath: root.path),
          let wsDirs = try? fm.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
          ) else { return [] }

    var results: [CliSessionMeta] = []
    for ws in wsDirs {
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: ws.path, isDirectory: &isDir), isDir.boolValue else { continue }
        if ws.lastPathComponent == "cli" { continue } // v2 lives here
        guard let sessDirs = try? fm.contentsOfDirectory(
            at: ws,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { continue }
        for sess in sessDirs where sess.lastPathComponent.hasPrefix("sess_") {
            if let meta = loadCliV3SessionMeta(at: sess) {
                results.append(meta)
            }
        }
    }
    return results
}

private func loadCliV3SessionMeta(at sessionDir: URL) -> CliSessionMeta? {
    let metaFile = sessionDir.appendingPathComponent("session.json")
    guard let data = try? Data(contentsOf: metaFile),
          let json = try? JSONDecoder().decode(JSONValue.self, from: data),
          let sid = json["id"]?.stringValue else {
        return nil
    }
    let cwd = json["workspacePaths"]?.arrayValue?.first?.stringValue ?? ""
    let createdMs = parseIsoMs(json["createdAt"]?.stringValue ?? "")
    let updatedMs = parseIsoMs(json["lastModifiedAt"]?.stringValue ?? "")

    let agg = scanCliV3Trace(at: sessionDir.appendingPathComponent("messages.jsonl"))

    let autonomy: String
    if json["autopilot"]?.boolValue == true {
        autonomy = "Autopilot"
    } else {
        autonomy = json["agentMode"]?.stringValue ?? "Supervised"
    }

    return CliSessionMeta(
        sessionId: sid,
        title: json["title"]?.stringValue ?? "",
        cwd: cwd,
        createdAt: createdMs,
        updatedAt: updatedMs > 0 ? updatedMs : createdMs,
        model: json["modelId"]?.stringValue ?? "auto",
        agentName: autonomy,
        contextUsage: agg.contextUsage,
        totalCost: agg.totalCost,
        turnCount: agg.turnCount,
        turnCosts: [],
        version: 3,
        v3Dir: sessionDir
    )
}

/// Light scan of a v3 messages.jsonl for aggregate cost / turn count / context usage.
private func scanCliV3Trace(at messagesFile: URL) -> (totalCost: Double, turnCount: Int, contextUsage: Double) {
    let fm = FileManager.default
    guard fm.fileExists(atPath: messagesFile.path),
          let raw = try? String(contentsOf: messagesFile, encoding: .utf8) else {
        return (0, 0, 0)
    }
    var totalCost: Double = 0
    var turnCount = 0
    var contextUsage: Double = 0
    for line in raw.split(separator: "\n") where !line.isEmpty {
        guard let data = line.data(using: .utf8),
              let rec = try? JSONDecoder().decode(JSONValue.self, from: data) else { continue }
        let p = rec["payload"]
        switch p?["type"]?.stringValue ?? "" {
        case "turn_start":
            turnCount += 1
        case "usage_summary":
            for s in p?["promptTurnSummaries"]?.arrayValue ?? [] {
                totalCost += s["usage"]?.doubleValue ?? 0
            }
        case "session_metadata":
            if p?["key"]?.stringValue == "contextUsage",
               let v = p?["value"]?["usagePercentage"]?.doubleValue {
                contextUsage = v
            }
        default:
            break
        }
    }
    return (totalCost, turnCount, contextUsage)
}

private func parseIsoMs(_ s: String) -> Double {
    guard !s.isEmpty else { return 0 }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d.timeIntervalSince1970 * 1000 }
    f.formatOptions = [.withInternetDateTime]
    if let d = f.date(from: s) { return d.timeIntervalSince1970 * 1000 }
    return 0
}

// MARK: - Raw codable helpers

private struct RawSessionSummary: Decodable {
    let sessionId: String
    let title: String?
    let dateCreated: String
}

// MARK: - Utility functions

private func sha256Hex(_ input: String) -> String {
    let digest = SHA256.hash(data: Data(input.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

/// Best-effort base64url decoder mirroring the TypeScript server's leniency.
/// The directory names sometimes include a trailing `?` that needs to be stripped.
private func decodeBase64URL(_ str: String) -> String {
    func tryDecode(_ s: String) -> String? {
        var b = s.replacingOccurrences(of: "-", with: "+")
                 .replacingOccurrences(of: "_", with: "/")
        let pad = (4 - b.count % 4) % 4
        b.append(String(repeating: "=", count: pad))
        guard let data = Data(base64Encoded: b) else { return nil }
        guard let decoded = String(data: data, encoding: .utf8) else { return nil }
        var clean = ""
        for scalar in decoded.unicodeScalars {
            let code = scalar.value
            if code >= 0x20 && code <= 0x7e && scalar != "?" {
                clean.append(Character(scalar))
            } else {
                break
            }
        }
        return clean
    }

    if let decoded = tryDecode(str) { return decoded }
    if str.count > 1, let decoded = tryDecode(String(str.dropLast())) { return decoded }
    return str
}
