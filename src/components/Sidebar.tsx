import { useMemo, useState } from "react";
import { ChevronRight, FolderOpen, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import type { Workspace } from "../App";
import type { Source } from "../lib/source";
import { ALL_SOURCES, SOURCE_LABELS, SOURCE_SELECTED_CLASS } from "../lib/source";
import { SourceIcon } from "./SourceIcon";
import { useSettings } from "../lib/useSettings";

interface Props {
  workspaces: Workspace[];
  selectedSession: { workspaceId: string; sessionId: string } | null;
  selectedWorkspaceId: string | null;
  onSelect: (workspaceId: string, sessionId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

type SourceFilter = "all" | Source;

/** A session as shown in the sidebar, tagged with the specific per-source
 * workspace id needed to load it (a single real-world workspace can have
 * sessions from more than one source — IDE, legacy CLI, Unified — each
 * with its own backing workspace id). */
interface SidebarSession {
  id: string;
  title: string;
  date: number;
  source: Source;
  workspaceId: string;
}

/** One real-world workspace (grouped by path), merged across every source
 * that has sessions in it. */
interface MergedWorkspace {
  key: string;
  path: string;
  name: string;
  /** Every underlying per-source workspace id folded into this group —
   * used to resolve "is this group the selected one" and as a stand-in id
   * when the dashboard is opened for the whole group. */
  ids: string[];
  sessions: SidebarSession[];
}

/** Group raw (per-source) workspaces into one entry per real-world path, so
 * a project visited via more than one source shows as a single workspace
 * with each session tagged by its own source instead of as separate
 * per-source workspace entries. Sorted by most recently active first. */
function mergeWorkspaces(workspaces: Workspace[]): MergedWorkspace[] {
  const byPath = new Map<string, MergedWorkspace>();
  for (const ws of workspaces) {
    const key = ws.path || ws.name;
    let merged = byPath.get(key);
    if (!merged) {
      merged = { key, path: ws.path, name: ws.name, ids: [], sessions: [] };
      byPath.set(key, merged);
    }
    merged.ids.push(ws.id);
    for (const s of ws.sessions) {
      merged.sessions.push({ ...s, workspaceId: ws.id });
    }
  }
  return Array.from(byPath.values()).sort((a, b) => {
    const aLatest = a.sessions.reduce((max, s) => Math.max(max, s.date), 0);
    const bLatest = b.sessions.reduce((max, s) => Math.max(max, s.date), 0);
    return bLatest - aLatest;
  });
}

export function Sidebar({
  workspaces,
  selectedSession,
  selectedWorkspaceId,
  onSelect,
  onSelectWorkspace,
  onRefresh,
  refreshing,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const { showNonUnified } = useSettings();

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const counts = useMemo(() => {
    const totals: Record<Source, { workspaces: number; sessions: number }> = {
      ide: { workspaces: 0, sessions: 0 },
      cli: { workspaces: 0, sessions: 0 },
      unified: { workspaces: 0, sessions: 0 },
    };
    for (const ws of workspaces) {
      totals[ws.source].workspaces += 1;
      totals[ws.source].sessions += ws.sessionCount;
    }
    return totals;
  }, [workspaces]);

  // Setting overrides the source tabs: only Unified sessions are shown.
  const settingScopedWorkspaces = useMemo(() => {
    if (!showNonUnified) return workspaces.filter((w) => w.source === "unified");
    return workspaces;
  }, [workspaces, showNonUnified]);

  // Merge across sources first (one entry per real workspace path), then
  // apply the source filter to each group's *sessions* — a workspace with
  // sessions from more than one source should stay visible (showing just
  // that source's sessions) rather than disappearing entirely when filtered.
  const mergedWorkspaces = useMemo(
    () => mergeWorkspaces(settingScopedWorkspaces),
    [settingScopedWorkspaces],
  );

  const visibleWorkspaces = useMemo(() => {
    if (!showNonUnified || sourceFilter === "all") return mergedWorkspaces;
    return mergedWorkspaces
      .map((ws) => ({
        ...ws,
        sessions: ws.sessions.filter((s) => s.source === sourceFilter),
      }))
      .filter((ws) => ws.sessions.length > 0);
  }, [mergedWorkspaces, sourceFilter, showNonUnified]);

  const totalWorkspaces = visibleWorkspaces.length;
  const totalSessions = visibleWorkspaces.reduce(
    (sum, w) => sum + w.sessions.length,
    0,
  );

  return (
    <aside className="w-80 h-full border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold tracking-wide uppercase text-[var(--accent)]">
            Sessions Inspector
          </h1>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh sessions"
              aria-label="Refresh sessions"
              className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={clsx(refreshing && "animate-spin")}
              />
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {totalWorkspaces} workspaces • {totalSessions} sessions
        </p>
        {showNonUnified && (
          <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">
              <SourceIcon source="ide" size={10} /> {SOURCE_LABELS.ide}{" "}
              {counts.ide.sessions}
            </span>
            <span className="flex items-center gap-1">
              <SourceIcon source="cli" size={10} /> {SOURCE_LABELS.cli}{" "}
              {counts.cli.sessions}
            </span>
            <span className="flex items-center gap-1">
              <SourceIcon source="unified" size={10} /> {SOURCE_LABELS.unified}{" "}
              {counts.unified.sessions}
            </span>
          </div>
        )}
      </div>

      {showNonUnified && (
        <div className="flex gap-1 p-2 border-b border-[var(--border)] bg-[var(--bg-primary)]/20">
          {(["all", ...ALL_SOURCES] as SourceFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={clsx(
                "flex-1 px-2 py-1 text-[11px] rounded transition-colors flex items-center justify-center gap-1",
                sourceFilter === f
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {f !== "all" && <SourceIcon source={f} size={10} />}
              {f === "all" ? "All" : SOURCE_LABELS[f]}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {visibleWorkspaces.map((ws) => {
          // Distinct sources present in this workspace, shown as a small
          // icon strip on the workspace row. Redundant (and suppressed)
          // when non-unified sessions are hidden, since only unified is
          // ever in play at that point.
          const sourcesPresent = showNonUnified
            ? ALL_SOURCES.filter((s) => ws.sessions.some((sess) => sess.source === s))
            : [];
          const isSelected = ws.ids.includes(selectedWorkspaceId ?? "");
          return (
            <div key={ws.key}>
              <div
                className={clsx(
                  "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors",
                  isSelected
                    ? "bg-[var(--bg-tertiary)]"
                    : "hover:bg-[var(--bg-tertiary)]",
                )}
              >
                <button
                  onClick={() => toggle(ws.key)}
                  aria-label="Toggle sessions"
                  className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ChevronRight
                    size={14}
                    className={clsx(
                      "transition-transform",
                      expanded.has(ws.key) && "rotate-90",
                    )}
                  />
                </button>
                <button
                  onClick={() => onSelectWorkspace(ws.ids[0])}
                  title="Show workspace dashboard"
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <FolderOpen
                    size={14}
                    className="text-[var(--text-secondary)] shrink-0"
                  />
                  <span className="truncate flex-1">{ws.name}</span>
                  {sourcesPresent.length > 0 && (
                    <span className="flex items-center gap-0.5 shrink-0">
                      {sourcesPresent.map((s) => (
                        <SourceIcon key={s} source={s} size={10} />
                      ))}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                    {ws.sessions.length}
                  </span>
                </button>
              </div>
              {expanded.has(ws.key) && (
                <div className="ml-5 pl-2 border-l border-[var(--border)] space-y-0.5 mt-0.5">
                  {ws.sessions
                    .slice()
                    .sort((a, b) => b.date - a.date)
                    .map((s) => (
                      <button
                        key={`${s.workspaceId}:${s.id}`}
                        onClick={() => onSelect(s.workspaceId, s.id)}
                        title={`${SOURCE_LABELS[s.source]} session`}
                        className={clsx(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors",
                          selectedSession?.sessionId === s.id
                            ? SOURCE_SELECTED_CLASS[s.source]
                            : "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
                        )}
                      >
                        <SourceIcon source={s.source} size={12} />
                        <span className="truncate">
                          {s.title || "Untitled session"}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {visibleWorkspaces.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] px-3 py-6 text-center">
            No workspaces for this filter.
          </div>
        )}
      </div>
    </aside>
  );
}
