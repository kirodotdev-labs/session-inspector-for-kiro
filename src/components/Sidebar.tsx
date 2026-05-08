import { useMemo, useState } from "react";
import {
  ChevronRight,
  FolderOpen,
  MessageSquare,
  LayoutDashboard,
  List,
  Terminal,
  MonitorDot,
} from "lucide-react";
import { clsx } from "clsx";
import type { Source, Workspace } from "../App";

interface Props {
  workspaces: Workspace[];
  selectedSession: { workspaceId: string; sessionId: string } | null;
  onSelect: (workspaceId: string, sessionId: string) => void;
  view: "dashboard" | "sessions";
  onViewChange: (view: "dashboard" | "sessions") => void;
}

type SourceFilter = "all" | Source;

const SOURCE_LABELS: Record<Source, string> = {
  ide: "IDE",
  cli: "CLI",
};

const SOURCE_COLORS: Record<Source, string> = {
  ide: "text-[var(--accent)]",
  cli: "text-emerald-400",
};

function SourceIcon({
  source,
  className,
}: {
  source: Source;
  className?: string;
}) {
  if (source === "cli")
    return (
      <Terminal
        size={14}
        className={clsx("shrink-0", className ?? "text-emerald-400")}
      />
    );
  return (
    <MonitorDot
      size={14}
      className={clsx("shrink-0", className ?? "text-[var(--accent)]")}
    />
  );
}

export function Sidebar({
  workspaces,
  selectedSession,
  onSelect,
  view,
  onViewChange,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

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
    };
    for (const ws of workspaces) {
      totals[ws.source].workspaces += 1;
      totals[ws.source].sessions += ws.sessionCount;
    }
    return totals;
  }, [workspaces]);

  const visibleWorkspaces = useMemo(() => {
    if (sourceFilter === "all") return workspaces;
    return workspaces.filter((w) => w.source === sourceFilter);
  }, [workspaces, sourceFilter]);

  const grouped = useMemo(() => {
    const ide = visibleWorkspaces.filter((w) => w.source === "ide");
    const cli = visibleWorkspaces.filter((w) => w.source === "cli");
    return { ide, cli };
  }, [visibleWorkspaces]);

  const totalWorkspaces = counts.ide.workspaces + counts.cli.workspaces;
  const totalSessions = counts.ide.sessions + counts.cli.sessions;

  return (
    <aside className="w-80 h-full border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
      <div className="p-4 border-b border-[var(--border)]">
        <h1 className="text-sm font-semibold tracking-wide uppercase text-[var(--accent)]">
          Sessions Inspector
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {totalWorkspaces} workspaces • {totalSessions} sessions
        </p>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <MonitorDot size={10} className="text-[var(--accent)]" /> IDE{" "}
            {counts.ide.sessions}
          </span>
          <span className="flex items-center gap-1">
            <Terminal size={10} className="text-emerald-400" /> CLI{" "}
            {counts.cli.sessions}
          </span>
        </div>
      </div>

      <div className="flex border-b border-[var(--border)]">
        <button
          onClick={() => onViewChange("dashboard")}
          className={clsx(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
            view === "dashboard"
              ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
          )}
        >
          <LayoutDashboard size={12} /> Dashboard
        </button>
        <button
          onClick={() => onViewChange("sessions")}
          className={clsx(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
            view === "sessions"
              ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
          )}
        >
          <List size={12} /> Sessions
        </button>
      </div>

      <div className="flex gap-1 p-2 border-b border-[var(--border)] bg-[var(--bg-primary)]/20">
        {(["all", "ide", "cli"] as SourceFilter[]).map((f) => (
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
            {f === "ide" && <MonitorDot size={10} />}
            {f === "cli" && <Terminal size={10} />}
            {f === "all" ? "All" : SOURCE_LABELS[f]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {(["ide", "cli"] as Source[]).map((source) => {
          const list = source === "ide" ? grouped.ide : grouped.cli;
          if (list.length === 0) return null;
          return (
            <div key={source}>
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                <SourceIcon source={source} />
                <span className={SOURCE_COLORS[source]}>
                  {SOURCE_LABELS[source]}
                </span>
                <span className="ml-auto text-[var(--text-secondary)]">
                  {list.length}
                </span>
              </div>
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
                      {source === "cli" ? (
                        <Terminal
                          size={14}
                          className="text-emerald-400 shrink-0"
                        />
                      ) : (
                        <FolderOpen
                          size={14}
                          className="text-[var(--accent)] shrink-0"
                        />
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
                                    : "bg-[var(--accent)]/15 text-[var(--accent)]"
                                  : "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
                              )}
                            >
                              {source === "cli" ? (
                                <Terminal
                                  size={12}
                                  className="shrink-0 text-emerald-400"
                                />
                              ) : (
                                <MessageSquare size={12} className="shrink-0" />
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
    </aside>
  );
}
