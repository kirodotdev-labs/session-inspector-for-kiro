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
// v3 CLI sessions live directly under ~/.kiro/sessions/{sha256(workspacePath)[:16]}/sess_{id}/
const CLI_V3_SESSIONS_DIR = path.join(process.env.HOME!, ".kiro/sessions");

// Kiro CLI v3 and the new IDE share the same session format and storage, so
// those sessions are surfaced as "unified" rather than "CLI v3" — a distinct
// source alongside the legacy `ide` and `cli` (v2) sources.
type Source = "ide" | "cli" | "unified";

/** Maps a CLI-family session's on-disk format version to its UI source. */
function cliSourceForVersion(version: 2 | 3): Source {
  return version === 3 ? "unified" : "cli";
}

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

// Active time for one IDE turn: from the execution start (≈ when the user
// submitted) to the agent's last emitted action (its final response). Using
// `emittedAt` — not `endTime` — avoids counting abort gaps and long-running
// background processes whose end timestamps land hours/days later.
function ideActiveMs(exec: any): number {
  const st = exec?.startTime;
  if (typeof st !== "number") return 0;
  let lastEmit = st;
  for (const a of exec.actions || []) {
    const e = a?.emittedAt;
    if (typeof e === "number" && e > lastEmit) lastEmit = e;
  }
  return lastEmit > st ? lastEmit - st : 0;
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

  // Active time: sum each turn's agent work (start → last emitted action),
  // which excludes idle gaps where the user steps away between turns.
  const seenExec = new Set<string>();
  let durationMs = 0;
  for (const h of history) {
    if (!h.executionId || seenExec.has(h.executionId)) continue;
    seenExec.add(h.executionId);
    const execData = execMap.get(h.executionId);
    if (execData) durationMs += ideActiveMs(execData);
  }

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
    durationMs,
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
  version: 2 | 3;
  // v3 only: directory containing session.json + messages.jsonl
  v3Dir?: string;
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
      version: 2,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI v3 sessions (~/.kiro/sessions/{workspaceHash}/sess_{id}/)
// Each session is a directory containing:
//   session.json    — metadata (id, title, agentMode, workspacePaths, timestamps, modelId)
//   messages.jsonl  — one record per line: { id, timestamp, payload: { type, ... } }
// ---------------------------------------------------------------------------

// Light scan of a v3 messages.jsonl for aggregate cost / turn count / context usage,
// without building the full message history (used for the workspace list + dashboard).
function scanCliV3Trace(messagesFile: string): {
  totalCost: number;
  turnCount: number;
  contextUsage: number;
} {
  let totalCost = 0;
  let turnCount = 0;
  let contextUsage = 0;
  if (!fs.existsSync(messagesFile))
    return { totalCost, turnCount, contextUsage };
  try {
    const raw = fs.readFileSync(messagesFile, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const p = rec.payload || {};
      if (p.type === "turn_start") {
        turnCount++;
      } else if (p.type === "usage_summary") {
        for (const s of p.promptTurnSummaries || []) totalCost += s.usage || 0;
      } else if (p.type === "session_metadata" && p.key === "contextUsage") {
        const v = p.value?.usagePercentage;
        if (typeof v === "number") contextUsage = v;
      }
    }
  } catch {}
  return { totalCost, turnCount, contextUsage };
}

function loadCliV3SessionMeta(sessionDir: string): CliSessionMeta | null {
  try {
    const metaFile = path.join(sessionDir, "session.json");
    const data = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
    if (!data.id) return null;
    const cwd = Array.isArray(data.workspacePaths)
      ? data.workspacePaths[0] || ""
      : "";
    const createdAt = data.createdAt ? Date.parse(data.createdAt) : 0;
    const updatedAt = data.lastModifiedAt
      ? Date.parse(data.lastModifiedAt)
      : createdAt;
    const { totalCost, turnCount, contextUsage } = scanCliV3Trace(
      path.join(sessionDir, "messages.jsonl"),
    );
    return {
      sessionId: data.id,
      title: data.title || "",
      cwd,
      createdAt,
      updatedAt,
      model: data.modelId || "auto",
      // v3 has no agent_name; surface the autopilot/agent mode in the autonomy slot.
      agentName: data.autopilot ? "Autopilot" : data.agentMode || "Supervised",
      contextUsage,
      totalCost,
      turnCount,
      version: 3,
      v3Dir: sessionDir,
    };
  } catch {
    return null;
  }
}

function loadAllCliV3SessionMeta(): CliSessionMeta[] {
  const out: CliSessionMeta[] = [];
  if (!fs.existsSync(CLI_V3_SESSIONS_DIR)) return out;
  let workspaceDirs: fs.Dirent[];
  try {
    workspaceDirs = fs.readdirSync(CLI_V3_SESSIONS_DIR, {
      withFileTypes: true,
    });
  } catch {
    return out;
  }
  for (const wd of workspaceDirs) {
    if (!wd.isDirectory()) continue;
    if (wd.name === "cli") continue; // v2 lives here — skip
    const wsDir = path.join(CLI_V3_SESSIONS_DIR, wd.name);
    let sessEntries: fs.Dirent[];
    try {
      sessEntries = fs.readdirSync(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const se of sessEntries) {
      if (!se.isDirectory() || !se.name.startsWith("sess_")) continue;
      const meta = loadCliV3SessionMeta(path.join(wsDir, se.name));
      if (meta) out.push(meta);
    }
  }
  return out;
}

function loadAllCliSessionMeta(): CliSessionMeta[] {
  if (cliMetaCache && Date.now() - cliMetaCache.loadedAt < CLI_CACHE_TTL_MS) {
    return cliMetaCache.sessions;
  }
  const sessions: CliSessionMeta[] = [];
  if (fs.existsSync(CLI_SESSIONS_DIR)) {
    const entries = fs.readdirSync(CLI_SESSIONS_DIR);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(CLI_SESSIONS_DIR, entry);
      const meta = loadCliSessionMeta(file);
      if (meta && meta.sessionId) sessions.push(meta);
    }
  }
  // v3 sessions
  for (const meta of loadAllCliV3SessionMeta()) {
    if (meta.sessionId) sessions.push(meta);
  }
  cliMetaCache = { sessions, loadedAt: Date.now() };
  return sessions;
}

// CLI-family sessions live in two on-disk layouts:
// - v2: a flat directory of {id}.json + {id}.jsonl files -> "cli" source.
// - v3: the shared "unified" format (also written by the new IDE) -> "unified" source.
// Grouped by (source, cwd) so v2 and v3 never merge, even when they share a cwd.
function listCliWorkspaces() {
  const sessions = loadAllCliSessionMeta();
  const bySourceCwd = new Map<
    string,
    { source: Source; cwd: string; list: CliSessionMeta[] }
  >();
  for (const s of sessions) {
    const source = cliSourceForVersion(s.version);
    const cwd = s.cwd || "(unknown)";
    const key = `${source}|${cwd}`;
    const entry = bySourceCwd.get(key) || { source, cwd, list: [] };
    entry.list.push(s);
    bySourceCwd.set(key, entry);
  }
  const workspaces = Array.from(bySourceCwd.values()).map(
    ({ source, cwd, list }) => {
      const name = cwd.split("/").filter(Boolean).pop() || cwd;
      return {
        id: `${source}:${Buffer.from(cwd).toString("base64url")}`,
        source,
        path: cwd,
        name,
        sessionCount: list.length,
        sessions: list
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((s) => ({
            id: s.sessionId,
            title: s.title,
            date: s.updatedAt || s.createdAt,
            source,
          })),
      };
    },
  );
  return workspaces.sort((a, b) => b.sessionCount - a.sessionCount);
}

// Map CLI tool name to a normalized action type shared with the IDE view.
// Handles both v2 (snake_case) and v3 (camelCase + snake_case) tool vocabularies.
function normalizeCliToolType(name: string): string {
  if (!name) return "tool";
  // Collapse to lowercase alphanumerics so "execute_bash"/"executeBash" match.
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    shell: "runCommand",
    executebash: "runCommand",
    runcommand: "runCommand",
    commandexecution: "runCommand",
    read: "readFiles",
    fsread: "readFiles",
    readfile: "readFiles",
    readfiles: "readFiles",
    readmultiplefiles: "readFiles",
    write: "write",
    fswrite: "write",
    writefile: "write",
    replace: "replace",
    strreplace: "replace",
    create: "create",
    knowledge: "knowledge",
    listdirectory: "search",
    filesearch: "search",
    grepsearch: "search",
    grep: "search",
    invokesubagent: "subagent",
  };
  if (map[k]) return map[k];
  if (k.includes("search")) return "search";
  return name;
}

// Find a CLI session's metadata by id across both v2 and v3 sources.
function findCliSessionMeta(sessionId: string): CliSessionMeta | null {
  return (
    loadAllCliSessionMeta().find((m) => m.sessionId === sessionId) || null
  );
}

function getCliSession(sessionId: string) {
  const meta = findCliSessionMeta(sessionId);
  if (meta?.version === 3) return getCliV3Session(meta);
  return getCliV2Session(sessionId);
}

function getCliV2Session(sessionId: string) {
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
    cliVersion: 2,
    durationMs: Math.max(0, (meta.updatedAt || 0) - (meta.createdAt || 0)),
    history,
  };
}

// ---------------------------------------------------------------------------
// CLI v3 trace parsing
// ---------------------------------------------------------------------------

function getCliV3Session(meta: CliSessionMeta) {
  const messagesFile = path.join(meta.v3Dir || "", "messages.jsonl");

  type Action = {
    actionType: string;
    rawToolName: string;
    actionState: string;
    input: any;
    output: any;
  };
  type Msg = {
    role: string;
    content: string;
    executionId: string | null;
    actions: Action[];
    cost: number;
  };

  // Parse all records once.
  const records: any[] = [];
  if (fs.existsSync(messagesFile)) {
    const raw = fs.readFileSync(messagesFile, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {}
    }
  }

  // Pass 1: cost per executionId from usage_summary records.
  const costByExec = new Map<string, number>();
  for (const rec of records) {
    const p = rec.payload || {};
    if (p.type === "usage_summary") {
      let c = 0;
      for (const s of p.promptTurnSummaries || []) c += s.usage || 0;
      const eid = p.executionId;
      if (eid) costByExec.set(eid, (costByExec.get(eid) || 0) + c);
    }
  }

  // Pass 2: build the message thread.
  const history: Msg[] = [];
  const toolRefs = new Map<string, { msgIndex: number; actionIndex: number }>();
  const costConsumed = new Set<string>();
  let curAssistantIdx = -1;
  let curExecId: string | null = null;

  const ensureAssistant = (execId: string | null): Msg => {
    if (
      curAssistantIdx >= 0 &&
      history[curAssistantIdx]?.role === "assistant" &&
      curExecId === execId
    ) {
      return history[curAssistantIdx];
    }
    let cost = 0;
    if (execId && !costConsumed.has(execId)) {
      cost = costByExec.get(execId) || 0;
      costConsumed.add(execId);
    }
    const msg: Msg = {
      role: "assistant",
      content: "",
      executionId: execId,
      actions: [],
      cost,
    };
    history.push(msg);
    curAssistantIdx = history.length - 1;
    curExecId = execId;
    return msg;
  };

  for (const rec of records) {
    const p = rec.payload || {};
    const type = p.type;
    const execId: string | null = p.executionId ?? null;

    if (type === "user") {
      const content = typeof p.content === "string" ? p.content : "";
      if (!content.trim()) continue;
      history.push({
        role: "user",
        content,
        executionId: null,
        actions: [],
        cost: 0,
      });
      // Break assistant accumulation so the next assistant turn starts fresh.
      curAssistantIdx = -1;
      curExecId = null;
    } else if (type === "assistant") {
      const msg = ensureAssistant(execId);
      const text = typeof p.content === "string" ? p.content : "";
      if (text) msg.content = msg.content ? msg.content + "\n" + text : text;
    } else if (type === "tool_call") {
      const msg = ensureAssistant(execId);
      const name = p.toolName || "";
      const actionIndex = msg.actions.length;
      msg.actions.push({
        actionType: normalizeCliToolType(name),
        rawToolName: name,
        actionState: "Pending",
        input: p.args ?? {},
        output: null,
      });
      if (p.toolCallId) {
        toolRefs.set(p.toolCallId, {
          msgIndex: curAssistantIdx,
          actionIndex,
        });
      }
    } else if (type === "tool_result") {
      const ref = toolRefs.get(p.toolCallId);
      if (!ref) continue;
      const action = history[ref.msgIndex]?.actions?.[ref.actionIndex];
      if (!action) continue;
      action.actionState = p.success === false ? "Error" : "Success";
      // Content is usually a JSON string; parse it when possible.
      let body: any = p.content ?? null;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          /* leave as string */
        }
      }
      action.output = body;
      toolRefs.delete(p.toolCallId);
    } else if (type === "sub_agent_start") {
      const msg = ensureAssistant(p.parentExecutionId ?? execId);
      msg.actions.push({
        actionType: "subagent",
        rawToolName: p.subAgentName || "invoke_sub_agent",
        actionState: "Success",
        input: { subAgentName: p.subAgentName, prompt: p.prompt },
        output: null,
      });
    }
  }

  return {
    source: "unified" as Source,
    sessionId: meta.sessionId,
    title: meta.title,
    model: meta.model,
    autonomyMode: meta.agentName,
    sessionType: "unified",
    contextUsage: meta.contextUsage,
    workspacePath: meta.cwd,
    messageCount: history.length,
    totalCost: meta.totalCost,
    // No cliVersion tag: the "v3" tag is retired in favor of the Unified source.
    durationMs: Math.max(0, (meta.updatedAt || 0) - (meta.createdAt || 0)),
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
    // Both legacy CLI (v2) and Unified (v3) sessions are parsed by the
    // CLI-family loader, which locates the session by id across formats.
    if (workspaceId.startsWith("cli:") || workspaceId.startsWith("unified:")) {
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

// Dashboard: aggregate stats across all workspaces and executions.
// When `filterPath` is provided, only sessions/executions whose workspace path
// (IDE) or cwd (CLI-family) match are included — used for the per-workspace
// dashboard. When `sourceFilter` is provided, only that source is aggregated —
// used for the Unified-only dashboard.
function computeDashboard(filterPath?: string, sourceFilter?: Source) {
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
      unifiedSessions: number;
      unifiedCost: number;
      unifiedExecutions: number;
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
      duration: number;
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
    unified: { sessions: 0, executions: 0, cost: 0 },
  };
  let totalCost = 0;
  let totalExecutions = 0;
  let totalSessions = 0;
  let totalDuration = 0;

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
        unifiedSessions: 0,
        unifiedCost: 0,
        unifiedExecutions: 0,
        actions: {},
      };
    return dailyStats[date];
  };

  // --- IDE ---
  // Legacy IDE sessions are never Unified, so skip them entirely when the
  // dashboard is scoped to a different source.
  if ((!sourceFilter || sourceFilter === "ide") && fs.existsSync(SESSIONS_DIR)) {
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
      if (filterPath && decodedPath !== filterPath) continue;
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

      // Active time accumulator: sum of per-execution (end − start).
      let wsDuration = 0;

      if (!fs.existsSync(wsExecDir)) {
        workspaceStats[`ide:${projectName}`] = {
          name: projectName,
          cost: 0,
          sessions: sessions.length,
          executions: 0,
          duration: 0,
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

              // Active turn time: start → last emitted agent action.
              wsDuration += ideActiveMs(data);

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
        duration: wsDuration,
        source: "ide",
      };
      totalDuration += wsDuration;
    }
  }

  // --- CLI-family (legacy CLI v2 -> "cli", shared v3 format -> "unified") ---
  const cliSessions = loadAllCliSessionMeta();
  const cliWsAgg = new Map<
    string,
    {
      name: string;
      source: Source;
      cost: number;
      sessions: number;
      executions: number;
      duration: number;
    }
  >();
  for (const s of cliSessions) {
    if (filterPath && s.cwd !== filterPath) continue;
    const source = cliSourceForVersion(s.version);
    if (sourceFilter && sourceFilter !== source) continue;

    totalSessions += 1;
    sourceStats[source].sessions += 1;

    modelSessions[s.model] = (modelSessions[s.model] || 0) + 1;
    sessionTypes[source] = (sessionTypes[source] || 0) + 1;
    autonomyModes[s.agentName] = (autonomyModes[s.agentName] || 0) + 1;

    // Count every turn as one "execution" to stay comparable with the IDE side.
    totalExecutions += s.turnCount;
    sourceStats[source].executions += s.turnCount;
    totalCost += s.totalCost;
    sourceStats[source].cost += s.totalCost;
    modelUsage[s.model] = (modelUsage[s.model] || 0) + s.totalCost;

    const isUnified = source === "unified";
    const created = s.createdAt || s.updatedAt || Date.now();
    const createdBucket = bucketDaily(created);
    createdBucket.sessions++;
    if (isUnified) createdBucket.unifiedSessions++;
    else createdBucket.cliSessions++;
    // Attribute cost/executions to session's last update day.
    const updated = s.updatedAt || created;
    const bucket = bucketDaily(updated);
    bucket.cost += s.totalCost;
    bucket.executions += s.turnCount;
    if (isUnified) {
      bucket.unifiedCost += s.totalCost;
      bucket.unifiedExecutions += s.turnCount;
    } else {
      bucket.cliCost += s.totalCost;
      bucket.cliExecutions += s.turnCount;
    }

    const projectName =
      (s.cwd || "(unknown)").split("/").filter(Boolean).pop() || "(unknown)";
    const key = `${source}:${projectName}`;
    const prev = cliWsAgg.get(key) || {
      name: projectName,
      source,
      cost: 0,
      sessions: 0,
      executions: 0,
      duration: 0,
    };
    const dur = Math.max(0, (s.updatedAt || 0) - (s.createdAt || 0));
    totalDuration += dur;
    prev.cost += s.totalCost;
    prev.sessions += 1;
    prev.executions += s.turnCount;
    prev.duration += dur;
    cliWsAgg.set(key, prev);
  }
  for (const [key, agg] of cliWsAgg) {
    workspaceStats[key] = agg;
  }

  const daily = Object.entries(dailyStats)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const workspaces = Object.values(workspaceStats).sort(
    (a, b) => b.cost - a.cost,
  );

  return {
    totalCost,
    totalSessions,
    totalExecutions,
    totalDuration,
    daily,
    modelUsage,
    modelSessions,
    sessionTypes,
    autonomyModes,
    workspaces,
    sourceStats,
  };
}

app.get("/api/dashboard", (_req, res) => {
  res.json(computeDashboard());
});

// Dashboard scoped to Unified (shared IDE+CLI format) sessions only.
app.get("/api/unified-dashboard", (_req, res) => {
  res.json(computeDashboard(undefined, "unified"));
});

// Per-workspace dashboard, scoped to a single workspace path (covers IDE and
// CLI-family sessions for that path). Pass `?source=unified` to further
// restrict it to Unified sessions only.
app.get("/api/workspace-dashboard", (req, res) => {
  const p = typeof req.query.path === "string" ? req.query.path : "";
  if (!p) {
    res.status(400).json({ error: "path query param required" });
    return;
  }
  const source =
    typeof req.query.source === "string"
      ? (req.query.source as Source)
      : undefined;
  res.json(computeDashboard(p, source));
});

const PORT = 3001;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
