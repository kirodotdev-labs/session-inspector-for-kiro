import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
app.use(cors());

const GLOBAL_STORAGE = path.join(
  process.env.HOME!,
  "Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent"
);
const SESSIONS_DIR = path.join(GLOBAL_STORAGE, "workspace-sessions");

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

function findExecutionFile(workspacePath: string, executionId: string): any | null {
  const wsHash = crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 32);
  const wsDir = path.join(GLOBAL_STORAGE, wsHash);
  if (!fs.existsSync(wsDir)) return null;

  // Search subdirectories for execution files matching the executionId
  try {
    const entries = fs.readdirSync(wsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(wsDir, entry.name);
      const files = fs.readdirSync(subDir);
      for (const file of files) {
        const filePath = path.join(subDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile() || stat.size < 100) continue;
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (data.executionId === executionId) return data;
        } catch {}
      }
    }
  } catch {}
  return null;
}

// Cache execution lookups per workspace
const executionCache = new Map<string, Map<string, any>>();

function loadExecutionsForWorkspace(workspacePath: string): Map<string, any> {
  if (executionCache.has(workspacePath)) return executionCache.get(workspacePath)!;

  const map = new Map<string, any>();
  const wsHash = crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 32);
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
      try { files = fs.readdirSync(subDir); } catch { continue; }
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

function extractCost(executionData: any): number {
  const summary = executionData?.usageSummary;
  if (!Array.isArray(summary)) return 0;
  return summary.reduce((sum: number, s: any) => sum + (s.usage || 0), 0);
}

app.get("/api/workspaces", (_req, res) => {
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const workspaces = dirs
    .filter((d) => d.isDirectory())
    .map((d) => {
      const sessionsFile = path.join(SESSIONS_DIR, d.name, "sessions.json");
      let sessions: { sessionId: string; title: string; dateCreated: string }[] = [];
      try {
        sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
      } catch {}
      if (!Array.isArray(sessions) || sessions.length === 0) return null;
      const decodedPath = decodeBase64Url(d.name);
      const projectName = decodedPath.split("/").filter(Boolean).pop() || d.name;
      return {
        id: d.name,
        path: decodedPath,
        name: projectName,
        sessionCount: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.sessionId,
          title: s.title,
          date: Number(s.dateCreated),
        })),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.sessionCount - a!.sessionCount);

  res.json(workspaces);
});

app.get("/api/workspaces/:workspaceId/sessions/:sessionId", (req, res) => {
  const { workspaceId, sessionId } = req.params;
  const sessionFile = path.join(SESSIONS_DIR, workspaceId, `${sessionId}.json`);
  try {
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
          .map((c: any) => {
            if (c.type === "text") return c.text;
            return "";
          })
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
          cost = extractCost(execData);
        }
      }

      return {
        role: msg.role || "unknown",
        content,
        executionId,
        actions,
        cost,
      };
    });

    res.json({
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
    });
  } catch (e: any) {
    res.status(404).json({ error: "Session not found" });
  }
});

// Dashboard: aggregate stats across all workspaces and executions
app.get("/api/dashboard", (_req, res) => {
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  const dailyStats: Record<string, { sessions: number; cost: number; executions: number; actions: Record<string, number> }> = {};
  const modelUsage: Record<string, number> = {};
  const workspaceStats: Record<string, { name: string; cost: number; sessions: number; executions: number }> = {};
  let totalCost = 0;
  let totalExecutions = 0;
  let totalSessions = 0;

  for (const d of dirs) {
    const sessionsFile = path.join(SESSIONS_DIR, d.name, "sessions.json");
    let sessions: any[] = [];
    try { sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf-8")); } catch { continue; }
    if (!Array.isArray(sessions) || sessions.length === 0) continue;

    const decodedPath = decodeBase64Url(d.name);
    const projectName = decodedPath.split("/").filter(Boolean).pop() || d.name;
    const wsHash = crypto.createHash("sha256").update(decodedPath).digest("hex").slice(0, 32);
    const wsExecDir = path.join(GLOBAL_STORAGE, wsHash);

    totalSessions += sessions.length;

    // Track sessions by date
    for (const s of sessions) {
      const date = new Date(Number(s.dateCreated)).toISOString().slice(0, 10);
      if (!dailyStats[date]) dailyStats[date] = { sessions: 0, cost: 0, executions: 0, actions: {} };
      dailyStats[date].sessions++;
    }

    // Load executions for this workspace
    if (!fs.existsSync(wsExecDir)) continue;
    let wsCost = 0;
    let wsExecs = 0;

    try {
      const entries = fs.readdirSync(wsExecDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(wsExecDir, entry.name);
        let files: string[];
        try { files = fs.readdirSync(subDir); } catch { continue; }
        for (const file of files) {
          const filePath = path.join(subDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size < 100) continue;
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            if (!data.executionId || !data.actions) continue;

            wsExecs++;
            totalExecutions++;
            const cost = extractCost(data);
            wsCost += cost;
            totalCost += cost;

            const date = new Date(data.startTime).toISOString().slice(0, 10);
            if (!dailyStats[date]) dailyStats[date] = { sessions: 0, cost: 0, executions: 0, actions: {} };
            dailyStats[date].cost += cost;
            dailyStats[date].executions++;

            // Count action types
            for (const a of data.actions) {
              const t = a.actionType;
              if (t && t !== "intentClassification" && t !== "model") {
                dailyStats[date].actions[t] = (dailyStats[date].actions[t] || 0) + 1;
              }
            }

            // Model usage from metadata or input
            const model = data.input?.model || "unknown";
            modelUsage[model] = (modelUsage[model] || 0) + cost;
          } catch {}
        }
      }
    } catch {}

    if (wsExecs > 0 || sessions.length > 0) {
      workspaceStats[projectName] = { name: projectName, cost: wsCost, sessions: sessions.length, executions: wsExecs };
    }
  }

  // Convert dailyStats to sorted array
  const daily = Object.entries(dailyStats)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const workspaces = Object.values(workspaceStats).sort((a, b) => b.cost - a.cost);

  res.json({
    totalCost,
    totalSessions,
    totalExecutions,
    daily,
    modelUsage,
    workspaces,
  });
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
