/**
 * Thin data-fetching layer used by App.tsx and Dashboard.tsx. Uses Tauri's
 * `invoke()` to call into the Rust commands (see `src-tauri/src/commands.rs`)
 * when running inside the Tauri shell, and falls back to `fetch()` against
 * the Express dev server (`server/index.ts`) when running in a plain browser
 * via `vite dev` — this keeps `pnpm run start` working for day-to-day
 * frontend iteration without requiring the Tauri toolchain.
 */
import type { Workspace, SessionDetail } from "../App";

const API = "http://localhost:3001/api";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Workspace[]>("list_workspaces");
  }
  const r = await fetch(`${API}/workspaces`);
  return r.json();
}

export async function getSessionDetail(
  workspaceId: string,
  sessionId: string,
): Promise<SessionDetail> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SessionDetail>("get_session_detail", {
      workspaceId,
      sessionId,
    });
  }
  const r = await fetch(
    `${API}/workspaces/${encodeURIComponent(workspaceId)}/sessions/${sessionId}`,
  );
  return r.json();
}

// Dashboard payload shape is defined and typed locally in Dashboard.tsx
// (it's a plain JSON-shaped aggregate); these functions are generic so
// the caller supplies that shape without a redundant duplicate type here.

export async function getDashboard<T = unknown>(): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("get_dashboard");
  }
  const r = await fetch(`${API}/dashboard`);
  return r.json();
}

/** Dashboard scoped to Unified (shared IDE+CLI format) sessions only. */
export async function getUnifiedDashboard<T = unknown>(): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("get_unified_dashboard");
  }
  const r = await fetch(`${API}/unified-dashboard`);
  return r.json();
}

/**
 * Per-workspace dashboard, scoped to a single workspace path (covers IDE and
 * CLI-family sessions for that path). Pass `source: "unified"` to further
 * restrict it to Unified sessions only.
 */
export async function getWorkspaceDashboard<T = unknown>(
  path: string,
  source?: string,
): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("get_workspace_dashboard", { path, source });
  }
  let url = `${API}/workspace-dashboard?path=${encodeURIComponent(path)}`;
  if (source) url += `&source=${encodeURIComponent(source)}`;
  const r = await fetch(url);
  return r.json();
}

/**
 * A stored analysis (metadata). The HTML report lives on disk at `htmlPath`
 * and is opened in the browser via `openAnalysis`.
 */
export interface AnalysisRecord {
  id: string;
  window: "day" | "week" | "month";
  voice: string;
  createdAt: number;
  htmlPath: string;
  reportBytes: number;
}

/**
 * Run a headless Kiro analysis over the given window ("day" | "week" |
 * "month"). This spawns the local `kiro-cli` and a Rust-hosted stats MCP
 * server, persists the resulting HTML report, and returns its stored record.
 * Only available in the desktop (Tauri) app — the browser cannot launch a
 * subprocess.
 */
export async function runAnalysis(
  window: "day" | "week" | "month",
  voice?: "default" | "blunt" | "neutral",
  cliPath?: string,
): Promise<AnalysisRecord> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AnalysisRecord>("run_analysis", { window, voice, cliPath });
  }
  throw new Error(
    "Session analysis runs the local kiro-cli and is only available in the desktop app.",
  );
}

/** List all stored analyses, newest first. */
export async function listAnalyses(): Promise<AnalysisRecord[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AnalysisRecord[]>("list_analyses");
  }
  return [];
}

/** Open a stored analysis's HTML report in the default browser. */
export async function openAnalysis(id: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("open_analysis", { id });
  }
  throw new Error("Opening reports is only available in the desktop app.");
}

/** Delete a stored analysis (HTML + metadata) by id. */
export async function deleteAnalysis(id: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<void>("delete_analysis", { id });
  }
  throw new Error("Deleting reports is only available in the desktop app.");
}

/** True when running inside the Tauri desktop shell (analysis requires it). */
export function isDesktop(): boolean {
  return isTauri();
}
