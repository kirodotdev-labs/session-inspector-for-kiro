import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
app.use(cors());

const GLOBAL_STORAGE = path.join(
  process.env.HOME!,
  "Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent",
);
const SESSIONS_DIR = path.join(GLOBAL_STORAGE, "workspace-sessions");
const CLI_SESSIONS_DIR = path.join(process.env.HOME!, ".kiro/sessions/cli");

type Source = "ide" | "cli";

function decodeBase64Url(str: string): string {
  const tryDecode = (s: string): string | null => {
    try {
      let b = s.replace(/-/g, "+").replace(/_/g, "/");
      b += "=".repeat((4 - (b.length % 4)) % 4);
      const decoded = Buffer.from(b, "base64").toString("utf-8");
      let clean = "";
      for (const ch of decoded) {
        const code = ch.charCodeAt(0);
        if (code >= 0x20 && code <= 0x7e && ch !== "?") clean += ch;
        else if (code > 0x7e) break;
        else if (code < 0x20) break;
      }
      return clean;
    } catch {
      return null;
    }
  };
  return tryDecode(str) ?? tryDecode(str.slice(0, -1)) ?? str;
}

// ---------------------------------------------------------------------------
// IDE sessions (Application Support/Kiro/.../workspace-sessions)
// ---------------------------------------------------------------------------

// Cache execution lookups per workspace
const executionCache = new Map<string, Map<string, any>>();

function loadExecutionsForWorkspace(workspacePath: string): Map<string, any> {
  if (executionCache.has(workspacePath))
    return executionCache.get(workspacePath)!;

  const map = new Map<string, any>();
  const wsHash = crypto
    .createHash("sha256")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 32);
  const wsDir = path.join(GLOBAL_STORAGE, wsHash);
  if (!fs.existsSync(wsDir)) {
    executionCache.set(workspacePath, map);
    return map;
  }

  try {
    const entries = fs.readdirSync(wsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(wsDir, entry.name);
      let files: string[];
      try {
        files = fs.readdirSync(subDir);
      } catch {
        continue;
      }
      for (const file of files) {
        const filePath = path.join(subDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile() || stat.size < 100) continue;
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (data.executionId && data.actions) {
            map.set(data.executionId, data);
          }
        } catch {}
      }
    }
  } catch {}

  executionCache.set(workspacePath, map);
  return map;
}

function extractActions(executionData: any): any[] {
  if (!executionData?.actions) return [];
  return executionData.actions
    .filter((a: any) => {
      const t = a.actionType;
      return t && t !== "intentClassification" && t !== "model";
    })
    .map((a: any) => ({
      actionType: a.actionType,
      actionState: a.actionState,
      input: a.input,
      output: a.output,
    }));
}

function extractCostIde(executionData: any): number {
  const summary = executionData?.usageSummary;
  if (!Array.isArray(summary)) return 0;
  return summary.reduce((sum: number, s: any) => sum + (s.usage || 0), 0);
}

function listIdeWorkspaces() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  return dirs
    .filter((d) => d.isDirectory())
    .map((d) => {
      const sessionsFile = path.join(SESSIONS_DIR, d.name, "sessions.json");
      let sessions: {
        sessionId: string;
        title: string;
        dateCreated: string;
      }[] = [];
      try {
        sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      } catch {}
      if (!Array.isArray(sessions) || sessions.length === 0) return null;
      const decodedPath = decodeBase64Url(d.name);
      const projectName =
        decodedPath.split("/").filter(Boolean).pop() || d.name;
      return {
        id: `ide:${d.name}`,
        source: "ide" as Source,
        path: decodedPath,
        name: projectName,
        sessionCount: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.sessionId,
          title: s.title,
          date: Number(s.dateCreated),
          source: "ide" as Source,
        })),
      };
    })
    .filter(Boolean) as any[];
}

function getIdeSession(workspaceId: string, sessionId: string) {
  const sessionFile = path.join(SESSIONS_DIR, workspaceId, `${sessionId}.json`);
  const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
  const workspacePath = data.workspaceDirectory || "";
  const execMap = loadExecutionsForWorkspace(workspacePath);

  const history = (data.history || []).map((h: any) => {
    const msg = h.message || {};
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
    }

    const executionId = h.executionId || null;
    let actions: any[] = [];
    let cost = 0;
    if (executionId) {
      const execData = execMap.get(executionId);
      if (execData) {
        actions = extractActions(execData);
        cost = extractCostIde(execData);
      }
    }

    return { role: msg.role || "unknown", content, executionId, actions, cost };
  });

  return {
    source: "ide" as Source,
    sessionId: data.sessionId,
    title: data.title,
    model: data.selectedModel || data.defaultModelTitle,
    autonomyMode: data.autonomyMode,
    sessionType: data.sessionType,
    contextUsage: data.contextUsagePercentage,
    workspacePath,
    messageCount: history.length,
    totalCost: history.reduce((sum: number, h: any) => sum + (h.cost || 0), 0),
    history,
  };
}

// ---------------------------------------------------------------------------
// CLI sessions (~/.kiro/sessions/cli)
// ---------------------------------------------------------------------------

interface CliSessionMeta {
  sessionId: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  agentName: string;
  contextUsage: number;
  totalCost: number;
  turnCount: number;
}

// Cache parsed CLI session metadata files
let cliMetaCache: { sessions: CliSessionMeta[]; loadedAt: number } | null =
  null;
const CLI_CACHE_TTL_MS = 30_000;

function loadCliSessionMeta(file: string): CliSessionMeta | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const ss = data.session_state || {};
    const cm = ss.conversation_metadata || {};
    const turns: any[] = cm.user_turn_metadatas || [];
    let totalCost = 0;
    let lastCtx = 0;
    for (const t of turns) {
      for (const m of t.metering_usage || []) totalCost += m.value || 0;
      if (typeof t.context_usage_percentage === "number")
        lastCtx = t.context_usage_percentage;
    }
    const createdAt = data.created_at ? Date.parse(data.created_at) : 0;
    const updatedAt = data.updated_at ? Date.parse(data.updated_at) : createdAt;
    return {
      sessionId: data.session_id,
      title: data.title || "",
      cwd: data.cwd || "",
      createdAt,
      updatedAt,
      model: ss.rts_model_state?.model_info?.model_id || "auto",
      agentName: ss.agent_name || "kiro_default",
      contextUsage: ss.rts_model_state?.context_usage_percentage ?? lastCtx,
      totalCost,
      turnCount: turns.length,
    };
  } catch {
    return null;
  }
}

function loadAllCliSessionMeta(): CliSessionMeta[] {
  if (cliMetaCache && Date.now() - cliMetaCache.loadedAt < CLI_CACHE_TTL_MS) {
    return cliMetaCache.sessions;
  }
  const sessions: CliSessionMeta[] = [];
  if (!fs.existsSync(CLI_SESSIONS_DIR)) {
    cliMetaCache = { sessions, loadedAt: Date.now() };
    return sessions;
  }
  const entries = fs.readdirSync(CLI_SESSIONS_DIR);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(CLI_SESSIONS_DIR, entry);
    const meta = loadCliSessionMeta(file);
    if (meta && meta.sessionId) sessions.push(meta);
  }
  cliMetaCache = { sessions, loadedAt: Date.now() };
  return sessions;
}

function listCliWorkspaces() {
  const sessions = loadAllCliSessionMeta();
  const byCwd = new Map<string, CliSessionMeta[]>();
  for (const s of sessions) {
    const cwd = s.cwd || "(unknown)";
    const list = byCwd.get(cwd) || [];
    list.push(s);
    byCwd.set(cwd, list);
  }
  const workspaces = Array.from(byCwd.entries()).map(([cwd, list]) => {
    const name = cwd.split("/").filter(Boolean).pop() || cwd;
    return {
      id: `cli:${Buffer.from(cwd).toString("base64url")}`,
      source: "cli" as Source,
      path: cwd,
      name,
      sessionCount: list.length,
      sessions: list
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((s) => ({
          id: s.sessionId,
          title: s.title,
          date: s.updatedAt || s.createdAt,
          source: "cli" as Source,
        })),
    };
  });
  return workspaces.sort((a, b) => b.sessionCount - a.sessionCount);
}

// Map CLI tool name to a normalized action type shared with the IDE view.
function normalizeCliToolType(name: string): string {
  const n = (name || "").toLowerCase();
  if (n === "shell") return "runCommand";
  if (n === "read" || n === "fs_read") return "readFiles";
  if (n === "write" || n === "fs_write") return "write";
  if (n === "replace" || n === "str_replace") return "replace";
  if (n === "create") return "create";
  if (n === "knowledge") return "knowledge";
  if (n.includes("search") || n === "grep") return "search";
  return n || "tool";
}

function getCliSession(sessionId: string) {
  const metaFile = path.join(CLI_SESSIONS_DIR, `${sessionId}.json`);
  const traceFile = path.join(CLI_SESSIONS_DIR, `${sessionId}.jsonl`);

  const meta = loadCliSessionMeta(metaFile);
  if (!meta) throw new Error("not found");

  // Parse jsonl and group into a user/assistant history.
  type Msg = { role: string; content: string; actions: any[]; cost: number };
  const history: Msg[] = [];
  let pendingToolUses = new Map<
    string,
    { msgIndex: number; actionIndex: number }
  >();

  // Cost is per-turn (assistant's response). We map turns to assistant messages in order.
  const turns = (() => {
    try {
      const rawMeta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      return (
        rawMeta.session_state?.conversation_metadata?.user_turn_metadatas || []
      );
    } catch {
      return [];
    }
  })();
  const turnCosts: number[] = turns.map((t: any) =>
    (t.metering_usage || []).reduce(
      (s: number, m: any) => s + (m.value || 0),
      0,
    ),
  );
  let turnIdx = 0;

  if (fs.existsSync(traceFile)) {
    const raw = fs.readFileSync(traceFile, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const kind = record.kind;
      const content: any[] = record.data?.content || [];

      if (kind === "Prompt") {
        // New user message: also advances to the next assistant turn for cost.
        const text = content
          .filter((c) => c.kind === "text")
          .map((c) => c.data)
          .filter(Boolean)
          .join("\n");
        history.push({ role: "user", content: text, actions: [], cost: 0 });
      } else if (kind === "AssistantMessage") {
        // Collect this assistant turn (may span several records until the next Prompt).
        let last = history[history.length - 1];
        if (!last || last.role !== "assistant") {
          const cost = turnCosts[turnIdx++] || 0;
          last = { role: "assistant", content: "", actions: [], cost };
          history.push(last);
        }
        for (const c of content) {
          if (c.kind === "text" && c.data) {
            last.content = last.content ? last.content + "\n" + c.data : c.data;
          } else if (c.kind === "toolUse") {
            const tu = c.data || {};
            const name = tu.name || "";
            const input = tu.input || {};
            const actionIndex = last.actions.length;
            last.actions.push({
              actionType: normalizeCliToolType(name),
              rawToolName: name,
              actionState: "Pending",
              input,
              output: null,
            });
            if (tu.toolUseId) {
              pendingToolUses.set(tu.toolUseId, {
                msgIndex: history.length - 1,
                actionIndex,
              });
            }
          }
        }
      } else if (kind === "ToolResults") {
        for (const c of content) {
          if (c.kind !== "toolResult") continue;
          const tr = c.data || {};
          const ref = pendingToolUses.get(tr.toolUseId);
          if (!ref) continue;
          const action = history[ref.msgIndex]?.actions?.[ref.actionIndex];
          if (!action) continue;
          action.actionState =
            tr.status === "success"
              ? "Success"
              : tr.status === "error"
                ? "Error"
                : tr.status;
          // Flatten toolResult content into something compact for the UI.
          let outputBody: any = null;
          const items: any[] = tr.content || [];
          if (items.length === 1) {
            const only = items[0];
            if (only.kind === "json") outputBody = only.data;
            else if (only.kind === "text") outputBody = only.data;
            else outputBody = only;
          } else if (items.length > 1) {
            outputBody = items.map((it: any) =>
              it.kind === "text" ? it.data : it,
            );
          }
          action.output = outputBody;
          pendingToolUses.delete(tr.toolUseId);
        }
      }
    }
  }

  return {
    source: "cli" as Source,
    sessionId: meta.sessionId,
    title: meta.title,
    model: meta.model,
    autonomyMode: meta.agentName, // CLI doesn't have Autopilot/Supervised; surface the agent instead.
    sessionType: "cli",
    contextUsage: meta.contextUsage,
    workspacePath: meta.cwd,
    messageCount: history.length,
    totalCost: meta.totalCost,
    history,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/api/workspaces", (_req, res) => {
  const ide = listIdeWorkspaces();
  const cli = listCliWorkspaces();
  // Return them ordered by source + sessionCount; frontend groups by source.
  res.json([...ide, ...cli]);
});

app.get("/api/workspaces/:workspaceId/sessions/:sessionId", (req, res) => {
  const { workspaceId, sessionId } = req.params;
  try {
    if (workspaceId.startsWith("cli:")) {
      res.json(getCliSession(sessionId));
    } else {
      const rawId = workspaceId.startsWith("ide:")
        ? workspaceId.slice(4)
        : workspaceId;
      res.json(getIdeSession(rawId, sessionId));
    }
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// Dashboard: aggregate stats across all workspaces and executions
app.get("/api/dashboard", (_req, res) => {
  const dailyStats: Record<
    string,
    {
      sessions: number;
      cost: number;
      executions: number;
      ideSessions: number;
      cliSessions: number;
      ideCost: number;
      cliCost: number;
      ideExecutions: number;
      cliExecutions: number;
      actions: Record<string, number>;
    }
  > = {};
  const modelUsage: Record<string, number> = {};
  const workspaceStats: Record<
    string,
    {
      name: string;
      cost: number;
      sessions: number;
      executions: number;
      source: Source;
    }
  > = {};
  const sessionTypes: Record<string, number> = {};
  const autonomyModes: Record<string, number> = {};
  const modelSessions: Record<string, number> = {};
  const sourceStats: Record<
    Source,
    { sessions: number; executions: number; cost: number }
  > = {
    ide: { sessions: 0, executions: 0, cost: 0 },
    cli: { sessions: 0, executions: 0, cost: 0 },
  };
  let totalCost = 0;
  let totalExecutions = 0;
  let totalSessions = 0;

  const bucketDaily = (ts: number) => {
    const date = new Date(ts).toISOString().slice(0, 10);
    if (!dailyStats[date])
      dailyStats[date] = {
        sessions: 0,
        cost: 0,
        executions: 0,
        ideSessions: 0,
        cliSessions: 0,
        ideCost: 0,
        cliCost: 0,
        ideExecutions: 0,
        cliExecutions: 0,
        actions: {},
      };
    return dailyStats[date];
  };

  // --- IDE ---
  if (fs.existsSync(SESSIONS_DIR)) {
    const dirs = fs
      .readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    for (const d of dirs) {
      const sessionsFile = path.join(SESSIONS_DIR, d.name, "sessions.json");
      let sessions: any[] = [];
      try {
        sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      } catch {
        continue;
      }
      if (!Array.isArray(sessions) || sessions.length === 0) continue;

      const decodedPath = decodeBase64Url(d.name);
      const projectName =
        decodedPath.split("/").filter(Boolean).pop() || d.name;
      const wsHash = crypto
        .createHash("sha256")
        .update(decodedPath)
        .digest("hex")
        .slice(0, 32);
      const wsExecDir = path.join(GLOBAL_STORAGE, wsHash);

      totalSessions += sessions.length;
      sourceStats.ide.sessions += sessions.length;

      for (const s of sessions) {
        const sessionFile = path.join(
          SESSIONS_DIR,
          d.name,
          `${s.sessionId}.json`,
        );
        try {
          const sData = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
          const model =
            sData.selectedModel || sData.defaultModelTitle || "unknown";
          const sType = sData.sessionType || "unknown";
          const aMode = sData.autonomyMode || "unknown";
          modelSessions[model] = (modelSessions[model] || 0) + 1;
          sessionTypes[sType] = (sessionTypes[sType] || 0) + 1;
          autonomyModes[aMode] = (autonomyModes[aMode] || 0) + 1;
        } catch {}
        bucketDaily(Number(s.dateCreated)).sessions++;
        bucketDaily(Number(s.dateCreated)).ideSessions++;
      }

      if (!fs.existsSync(wsExecDir)) {
        workspaceStats[`ide:${projectName}`] = {
          name: projectName,
          cost: 0,
          sessions: sessions.length,
          executions: 0,
          source: "ide",
        };
        continue;
      }
      let wsCost = 0;
      let wsExecs = 0;
      try {
        const entries = fs.readdirSync(wsExecDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const subDir = path.join(wsExecDir, entry.name);
          let files: string[];
          try {
            files = fs.readdirSync(subDir);
          } catch {
            continue;
          }
          for (const file of files) {
            const filePath = path.join(subDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (!stat.isFile() || stat.size < 100) continue;
              const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
              if (!data.executionId || !data.actions) continue;

              wsExecs++;
              totalExecutions++;
              sourceStats.ide.executions++;
              const cost = extractCostIde(data);
              wsCost += cost;
              totalCost += cost;
              sourceStats.ide.cost += cost;

              const bucket = bucketDaily(data.startTime);
              bucket.cost += cost;
              bucket.executions++;
              bucket.ideCost += cost;
              bucket.ideExecutions++;
              for (const a of data.actions) {
                const t = a.actionType;
                if (t && t !== "intentClassification" && t !== "model") {
                  bucket.actions[t] = (bucket.actions[t] || 0) + 1;
                }
              }
              const model = data.input?.model || "unknown";
              modelUsage[model] = (modelUsage[model] || 0) + cost;
            } catch {}
          }
        }
      } catch {}
      workspaceStats[`ide:${projectName}`] = {
        name: projectName,
        cost: wsCost,
        sessions: sessions.length,
        executions: wsExecs,
        source: "ide",
      };
    }
  }

  // --- CLI ---
  const cliSessions = loadAllCliSessionMeta();
  const cliWsAgg = new Map<
    string,
    { cost: number; sessions: number; executions: number }
  >();
  for (const s of cliSessions) {
    totalSessions += 1;
    sourceStats.cli.sessions += 1;

    modelSessions[s.model] = (modelSessions[s.model] || 0) + 1;
    sessionTypes["cli"] = (sessionTypes["cli"] || 0) + 1;
    autonomyModes[s.agentName] = (autonomyModes[s.agentName] || 0) + 1;

    // Count every turn as one "execution" to stay comparable with the IDE side.
    totalExecutions += s.turnCount;
    sourceStats.cli.executions += s.turnCount;
    totalCost += s.totalCost;
    sourceStats.cli.cost += s.totalCost;
    modelUsage[s.model] = (modelUsage[s.model] || 0) + s.totalCost;

    const created = s.createdAt || s.updatedAt || Date.now();
    const createdBucket = bucketDaily(created);
    createdBucket.sessions++;
    createdBucket.cliSessions++;
    // Attribute cost/executions to session's last update day.
    const updated = s.updatedAt || created;
    const bucket = bucketDaily(updated);
    bucket.cost += s.totalCost;
    bucket.executions += s.turnCount;
    bucket.cliCost += s.totalCost;
    bucket.cliExecutions += s.turnCount;

    const projectName =
      (s.cwd || "(unknown)").split("/").filter(Boolean).pop() || "(unknown)";
    const key = `cli:${projectName}`;
    const prev = cliWsAgg.get(key) || { cost: 0, sessions: 0, executions: 0 };
    prev.cost += s.totalCost;
    prev.sessions += 1;
    prev.executions += s.turnCount;
    cliWsAgg.set(key, prev);
  }
  for (const [key, agg] of cliWsAgg) {
    const name = key.slice(4);
    workspaceStats[key] = { name, ...agg, source: "cli" };
  }

  const daily = Object.entries(dailyStats)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const workspaces = Object.values(workspaceStats).sort(
    (a, b) => b.cost - a.cost,
  );

  res.json({
    totalCost,
    totalSessions,
    totalExecutions,
    daily,
    modelUsage,
    modelSessions,
    sessionTypes,
    autonomyModes,
    workspaces,
    sourceStats,
  });
});

const PORT = 3001;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
