import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionView } from "./components/SessionView";
import { Dashboard } from "./components/Dashboard";
import { AnalyzeView } from "./components/AnalyzeView";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { Tabs } from "./components/Tabs";
import { UpdateBanner } from "./components/UpdateBanner";
import type { Source } from "./lib/source";
import { listWorkspaces, getSessionDetail } from "./lib/api";

export type { Source };

export type View =
  | "dashboard"
  | "session"
  | "workspace"
  | "search"
  | "analyze"
  | "settings";

export interface Workspace {
  id: string;
  source: Source;
  path: string;
  name: string;
  sessionCount: number;
  sessions: { id: string; title: string; date: number; source: Source }[];
}

export interface Action {
  actionType: string;
  rawToolName?: string;
  actionState?: string;
  input?: Record<string, any>;
  output?: any;
}

/** One ordered unit of an assistant turn — a text chunk or a tool call/
 * reasoning step, in the order they actually happened. Renders from this
 * instead of `content`/`actions` (which are flattened, order-independent
 * views of the same data) so interleaved text/tool-call turns display in
 * their original order rather than all text followed by all tool calls. */
export type Block = { type: "text"; text: string } | ({ type: "action" } & Action);

export interface SessionDetail {
  source: Source;
  sessionId: string;
  title: string;
  model: string;
  autonomyMode: string;
  sessionType: string;
  contextUsage: number;
  workspacePath: string;
  messageCount: number;
  totalCost: number;
  /** Wall-clock duration from session start to last activity, in ms. */
  durationMs?: number;
  /** Legacy CLI (v2) session format version. Absent for IDE/Unified sessions. */
  cliVersion?: number;
  history: {
    role: string;
    content: string;
    executionId?: string;
    actions?: Action[];
    /** Ordered view of this turn's blocks — see `Block`. Empty for turns
     * that don't carry any (plain user messages) or for sources whose
     * on-disk format doesn't preserve interleaving. */
    blocks?: Block[];
    cost?: number;
  }[];
}

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedSession, setSelectedSession] = useState<{
    workspaceId: string;
    sessionId: string;
  } | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [refreshing, setRefreshing] = useState(false);
  // Workspace whose dashboard the Workspace tab shows. Set by picking a
  // workspace directly, or implicitly by the workspace of a selected session.
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );

  const loadWorkspaces = useCallback(() => {
    setRefreshing(true);
    return listWorkspaces()
      .then(setWorkspaces)
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!selectedSession) return;
    setLoading(true);
    getSessionDetail(selectedSession.workspaceId, selectedSession.sessionId).then(
      (d) => {
        setSession(d);
        setLoading(false);
      },
    );
  }, [selectedSession]);

  // The workspace backing the Workspace tab: an explicitly selected workspace,
  // else the one owning the selected session.
  const activeWorkspaceId = selectedWorkspaceId ?? selectedSession?.workspaceId ?? null;
  const activeWorkspace = activeWorkspaceId
    ? workspaces.find((w) => w.id === activeWorkspaceId) ?? null
    : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          workspaces={workspaces}
          selectedSession={selectedSession}
          selectedWorkspaceId={activeWorkspaceId}
          onSelect={(workspaceId, sessionId) => {
            setSelectedSession({ workspaceId, sessionId });
            setSelectedWorkspaceId(workspaceId);
            setView("session");
          }}
          onSelectWorkspace={(workspaceId) => {
            setSelectedWorkspaceId(workspaceId);
            setView("workspace");
          }}
          onRefresh={loadWorkspaces}
          refreshing={refreshing}
        />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Tabs view={view} onViewChange={setView} />
        <div className="flex-1 overflow-y-auto">
          {view === "dashboard" ? (
            <Dashboard />
          ) : view === "search" ? (
            <SearchView
              onOpenSession={(workspaceId, sessionId) => {
                setSelectedSession({ workspaceId, sessionId });
                setSelectedWorkspaceId(workspaceId);
                setView("session");
              }}
            />
          ) : view === "analyze" ? (
            <AnalyzeView />
          ) : view === "settings" ? (
            <SettingsView />
          ) : view === "workspace" ? (
            activeWorkspace ? (
              <Dashboard
                key={activeWorkspace.path}
                workspacePath={activeWorkspace.path}
                workspaceName={activeWorkspace.name}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
                <div className="text-center">
                  <p className="text-2xl font-light mb-2">Workspace</p>
                  <p className="text-sm">
                    Select a workspace or a session from the sidebar to see its
                    dashboard
                  </p>
                </div>
              </div>
            )
          ) : loading ? (
            <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
              Loading session...
            </div>
          ) : session ? (
            <SessionView session={session} />
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
              <div className="text-center">
                <p className="text-2xl font-light mb-2">
                  Kiro Sessions Inspector
                </p>
                <p className="text-sm">
                  Select a session from the sidebar to inspect
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      </div>
    </div>
  );
}

export default App;
