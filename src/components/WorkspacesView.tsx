import { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  MessageSquare,
  LayoutDashboard,
} from "lucide-react";
import { clsx } from "clsx";
import type { Workspace } from "../App";
import type { Source } from "../lib/source";
import { ALL_SOURCES, SOURCE_LABELS, SOURCE_TEXT_CLASS, SOURCE_BADGE_CLASS } from "../lib/source";
import { SourceIcon } from "./SourceIcon";
import { Dashboard } from "./Dashboard";
import { useSettings } from "../lib/useSettings";

interface Props {
  workspaces: Workspace[];
  onSelectSession: (workspaceId: string, sessionId: string) => void;
}

/** A workspace path that may aggregate any combination of IDE/CLI/Unified sources. */
interface GroupedWorkspace {
  path: string;
  name: string;
  bySource: Record<Source, Workspace | undefined>;
  sessionCount: number;
  sources: Source[];
}

function groupByPath(workspaces: Workspace[]): GroupedWorkspace[] {
  const map = new Map<string, GroupedWorkspace>();
  for (const ws of workspaces) {
    const key = ws.path || ws.name;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        path: ws.path,
        name: ws.name,
        bySource: { ide: undefined, cli: undefined, unified: undefined },
        sessionCount: 0,
        sources: [],
      };
      map.set(key, entry);
    }
    entry.bySource[ws.source] = ws;
    entry.sessionCount += ws.sessionCount;
    if (!entry.sources.includes(ws.source)) entry.sources.push(ws.source);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.sessionCount - a.sessionCount,
  );
}

export function WorkspacesView({ workspaces, onSelectSession }: Props) {
  const [selected, setSelected] = useState<GroupedWorkspace | null>(null);
  const { showNonUnified } = useSettings();

  const scoped = showNonUnified
    ? workspaces
    : workspaces.filter((w) => w.source === "unified");
  const unified = useMemo(() => groupByPath(scoped), [scoped]);

  if (selected) {
    return (
      <div>
        <div className="sticky top-0 z-10 flex items-center gap-2 px-6 py-3 bg-[var(--bg-primary)]/90 backdrop-blur border-b border-[var(--border)]">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronLeft size={16} /> All workspaces
          </button>
          <span className="text-[var(--text-secondary)]">/</span>
          <span className="text-sm font-medium truncate">{selected.name}</span>
        </div>
        <Dashboard
          workspacePath={selected.path}
          workspaceName={selected.name}
        />
        <div className="max-w-5xl mx-auto px-6 pb-10">
          <SessionGroups
            unified={selected}
            onSelectSession={onSelectSession}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Workspaces</h2>
        <span className="text-xs text-[var(--text-secondary)]">
          {unified.length} workspaces
        </span>
      </div>
      <div className="space-y-2">
        {unified.map((ws) => (
          <WorkspaceRow
            key={ws.path || ws.name}
            ws={ws}
            onOpenDashboard={() => setSelected(ws)}
            onSelectSession={onSelectSession}
          />
        ))}
      </div>
    </div>
  );
}

function WorkspaceRow({
  ws,
  onOpenDashboard,
  onSelectSession,
}: {
  ws: GroupedWorkspace;
  onOpenDashboard: () => void;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-[var(--border)] rounded-lg bg-[var(--bg-secondary)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Toggle sessions"
        >
          <ChevronRight
            size={16}
            className={clsx("transition-transform", expanded && "rotate-90")}
          />
        </button>
        <FolderOpen size={16} className="text-[var(--accent)] shrink-0" />
        <button
          onClick={onOpenDashboard}
          className="flex-1 min-w-0 text-left group"
        >
          <div className="text-sm font-medium truncate group-hover:text-[var(--accent)] transition-colors">
            {ws.name}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] truncate font-mono">
            {ws.path}
          </div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {ws.sources.map((s) => (
            <SourceChip
              key={s}
              source={s}
              count={ws.bySource[s]?.sessionCount ?? 0}
            />
          ))}
        </div>
        <button
          onClick={onOpenDashboard}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors shrink-0"
        >
          <LayoutDashboard size={13} /> Dashboard
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <SessionGroups unified={ws} onSelectSession={onSelectSession} />
        </div>
      )}
    </div>
  );
}

/** Renders the per-source groups of sessions for a workspace. */
function SessionGroups({
  unified,
  onSelectSession,
}: {
  unified: GroupedWorkspace;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
}) {
  const { showNonUnified } = useSettings();
  return (
    <div className="space-y-3">
      {ALL_SOURCES.map((source) => {
        const ws = unified.bySource[source];
        if (!ws || ws.sessions.length === 0) return null;
        // When non-unified sessions are hidden, unified is the only source
        // in play — skip the redundant group header.
        const showGroupHeader = showNonUnified;
        return (
          <div key={source}>
            {showGroupHeader && (
              <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wide">
                <SourceIcon source={source} size={12} />
                <span className={SOURCE_TEXT_CLASS[source]}>
                  {SOURCE_LABELS[source]}
                </span>
                <span className="text-[var(--text-secondary)]">
                  {ws.sessions.length}
                </span>
              </div>
            )}
            <div className="space-y-0.5 ml-1 pl-2 border-l border-[var(--border)]">
              {ws.sessions
                .slice()
                .sort((a, b) => b.date - a.date)
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSession(ws.id, s.id)}
                    className={clsx(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors text-[var(--text-secondary)]",
                      source === "cli"
                        ? "hover:bg-emerald-500/10 hover:text-emerald-300"
                        : source === "unified"
                          ? "hover:bg-violet-500/10 hover:text-violet-300"
                          : "hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]",
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
          </div>
        );
      })}
    </div>
  );
}

function SourceChip({ source, count }: { source: Source; count: number }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold border",
        SOURCE_BADGE_CLASS[source],
      )}
    >
      <SourceIcon source={source} size={10} />
      {count}
    </span>
  );
}
