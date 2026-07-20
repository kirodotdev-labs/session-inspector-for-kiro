/**
 * Thin data-fetching layer used by App.tsx and Dashboard.tsx. Calls into the
 * Rust backend (see `src-tauri/src/commands.rs`) via Tauri's `invoke()`. The
 * app is desktop-only; there is no web/HTTP backend.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Workspace, SessionDetail, Source } from "../App";

/**
 * True when running inside the Tauri desktop shell. The app is desktop-only,
 * but the UI can still be loaded in a plain browser via `vite dev`/`preview`
 * where the Tauri APIs are absent — features that call native commands guard
 * on this to fail gracefully instead of throwing.
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return invoke<Workspace[]>("list_workspaces");
}

export async function getSessionDetail(
  workspaceId: string,
  sessionId: string,
): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_session_detail", {
    workspaceId,
    sessionId,
  });
}

/**
 * Loads a sub-agent's own transcript — dispatched from a "subagent" Action's
 * `subSessionId` (see `Block`/`Action` in App.tsx). Only Unified (v3)
 * sessions can have these.
 */
export async function getSubagentSession(
  sessionId: string,
  subSessionId: string,
): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_subagent_session", {
    sessionId,
    subSessionId,
  });
}

// Dashboard payload shape is defined and typed locally in Dashboard.tsx
// (it's a plain JSON-shaped aggregate); these functions are generic so
// the caller supplies that shape without a redundant duplicate type here.

export async function getDashboard<T = unknown>(): Promise<T> {
  return invoke<T>("get_dashboard");
}

/** Dashboard scoped to Unified (shared IDE+CLI format) sessions only. */
export async function getUnifiedDashboard<T = unknown>(): Promise<T> {
  return invoke<T>("get_unified_dashboard");
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
  return invoke<T>("get_workspace_dashboard", { path, source });
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
 */
export async function runAnalysis(
  window: "day" | "week" | "month",
  voice?: "default" | "blunt" | "neutral",
  cliPath?: string,
): Promise<AnalysisRecord> {
  return invoke<AnalysisRecord>("run_analysis", { window, voice, cliPath });
}

/** List all stored analyses, newest first. */
export async function listAnalyses(): Promise<AnalysisRecord[]> {
  return invoke<AnalysisRecord[]>("list_analyses");
}

/** Open a stored analysis's HTML report in the default browser. */
export async function openAnalysis(id: string): Promise<void> {
  return invoke<void>("open_analysis", { id });
}

/** Delete a stored analysis (HTML + metadata) by id. */
export async function deleteAnalysis(id: string): Promise<void> {
  return invoke<void>("delete_analysis", { id });
}

/** One highlighted snippet from a matching message (HTML `<mark>` markers). */
export interface SearchSnippet {
  role: string;
  text: string;
}

/** A single search result, grouped per session. */
export interface SearchHit {
  sessionId: string;
  workspaceId: string;
  source: Source;
  workspacePath: string;
  title: string;
  model: string;
  date: number;
  /** False when the session's files were deleted from disk after indexing. */
  onDisk: boolean;
  /** BM25 score (lower is a better match). */
  score: number;
  matchCount: number;
  snippets: SearchSnippet[];
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  query: string;
}

export interface IndexStats {
  sessionCount: number;
  messageCount: number;
  onDiskCount: number;
  archivedCount: number;
  lastIndexedAt: number | null;
}

/**
 * Free-text search across indexed sessions. Results are grouped per session,
 * ranked by relevance, with highlighted snippets. Sessions deleted from disk
 * after indexing remain searchable (`onDisk: false`).
 */
export async function searchSessions(
  query: string,
  opts: {
    source?: Source;
    workspacePath?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<SearchResults> {
  return invoke<SearchResults>("search_sessions", {
    query,
    source: opts.source,
    workspacePath: opts.workspacePath,
    limit: opts.limit,
    offset: opts.offset,
  });
}

/**
 * Bring the search index up to date (incremental), or fully rebuild it when
 * `full` is true. Returns the resulting index statistics.
 */
export async function reindexSessions(full = false): Promise<IndexStats> {
  return invoke<IndexStats>("reindex_sessions", { full });
}

/** Current search index statistics. */
export async function searchIndexStats(): Promise<IndexStats> {
  return invoke<IndexStats>("search_index_stats");
}
