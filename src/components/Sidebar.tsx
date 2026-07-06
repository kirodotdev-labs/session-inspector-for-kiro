import { useMemo, useState } from "react";
import {
  ChevronRight,
  FolderOpen,
  MessageSquare,
  SlidersHorizontal,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { clsx } from "clsx";
import type { Workspace } from "../App";
import type { Source } from "../lib/source";
import { ALL_SOURCES, SOURCE_LABELS, SOURCE_TEXT_CLASS } from "../lib/source";
import { SourceIcon } from "./SourceIcon";
import { Toggle } from "./Toggle";
import { useSettings } from "../lib/useSettings";

interface Props {
  workspaces: Workspace[];
  selectedSession: { workspaceId: string; sessionId: string } | null;
  onSelect: (workspaceId: string, sessionId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

type SourceFilter = "all" | Source;

export function Sidebar({
  workspaces,
  selectedSession,
  onSelect,
  onRefresh,
  refreshing,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const { showNonUnified, setShowNonUnified, kiroCliPath, setKiroCliPath } =
    useSettings();

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
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

  const visibleWorkspaces = useMemo(() => {
    if (!showNonUnified || sourceFilter === "all") return settingScopedWorkspaces;
    return settingScopedWorkspaces.filter((w) => w.source === sourceFilter);
  }, [settingScopedWorkspaces, sourceFilter, showNonUnified]);

  const grouped = useMemo(() => {
    const ide = visibleWorkspaces.filter((w) => w.source === "ide");
    const cli = visibleWorkspaces.filter((w) => w.source === "cli");
    const unified = visibleWorkspaces.filter((w) => w.source === "unified");
    return { ide, cli, unified };
  }, [visibleWorkspaces]);

  const totalWorkspaces = visibleWorkspaces.length;
  const totalSessions = visibleWorkspaces.reduce(
    (sum, w) => sum + w.sessionCount,
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

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {ALL_SOURCES.map((source) => {
          const list = grouped[source];
          if (list.length === 0) return null;
          // When non-unified sessions are hidden, there's only ever one
          // source (unified) in play, so the group header is redundant —
          // sessions are shown directly at the root.
          const showGroupHeader = showNonUnified;
          return (
            <div key={source}>
              {showGroupHeader && (
                <div className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                  <SourceIcon source={source} />
                  <span className={SOURCE_TEXT_CLASS[source]}>
                    {SOURCE_LABELS[source]}
                  </span>
                  <span className="ml-auto text-[var(--text-secondary)]">
                    {list.length}
                  </span>
                </div>
              )}
              <div className="space-y-0.5">
                {list.map((ws) => (
                  <div key={ws.id}>
                    <button
                      onClick={() => toggle(ws.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-left text-sm transition-colors"
                    >
                      <ChevronRight
                        size={14}
                        className={clsx(
                          "text-[var(--text-secondary)] transition-transform shrink-0",
                          expanded.has(ws.id) && "rotate-90",
                        )}
                      />
                      {source === "ide" ? (
                        <FolderOpen
                          size={14}
                          className="text-[var(--accent)] shrink-0"
                        />
                      ) : (
                        <SourceIcon source={source} size={14} />
                      )}
                      <span className="truncate flex-1">{ws.name}</span>
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {ws.sessionCount}
                      </span>
                    </button>
                    {expanded.has(ws.id) && (
                      <div className="ml-5 pl-2 border-l border-[var(--border)] space-y-0.5 mt-0.5">
                        {ws.sessions
                          .slice()
                          .sort((a, b) => b.date - a.date)
                          .map((s) => (
                            <button
                              key={s.id}
                              onClick={() => onSelect(ws.id, s.id)}
                              className={clsx(
                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors",
                                selectedSession?.sessionId === s.id
                                  ? source === "cli"
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : source === "unified"
                                      ? "bg-violet-500/15 text-violet-300"
                                      : "bg-[var(--accent)]/15 text-[var(--accent)]"
                                  : "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
                              )}
                            >
                              {source === "ide" ? (
                                <MessageSquare size={12} className="shrink-0" />
                              ) : (
                                <SourceIcon source={source} size={12} />
                              )}
                              <span className="truncate">
                                {s.title || "Untitled session"}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {visibleWorkspaces.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] px-3 py-6 text-center">
            No workspaces for this filter.
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <SlidersHorizontal size={11} />
          <span className="flex-1">Show non-unified sessions</span>
          <Toggle
            checked={showNonUnified}
            onChange={setShowNonUnified}
            label="Show non-unified sessions"
          />
        </div>
        <div className="flex flex-col gap-1 px-3 pb-2.5">
          <label htmlFor="kiro-cli-path" className="flex items-center gap-1.5">
            <Terminal size={11} />
            <span>kiro-cli path</span>
          </label>
          <input
            id="kiro-cli-path"
            type="text"
            value={kiroCliPath}
            onChange={(e) => setKiroCliPath(e.target.value)}
            placeholder="kiro-cli"
            spellCheck={false}
            className="w-full px-2 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:border-[var(--accent)]/50"
          />
        </div>
      </div>
    </aside>
  );
}
