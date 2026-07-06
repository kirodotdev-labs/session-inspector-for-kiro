import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionView } from "./components/SessionView";
import { Dashboard } from "./components/Dashboard";
import { WorkspacesView } from "./components/WorkspacesView";
import { AnalyzeView } from "./components/AnalyzeView";
import { Tabs } from "./components/Tabs";
import type { Source } from "./lib/source";
import { listWorkspaces, getSessionDetail } from "./lib/api";

export type { Source };

export type View = "dashboard" | "sessions" | "workspaces" | "analyze";

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspaces={workspaces}
        selectedSession={selectedSession}
        onSelect={(workspaceId, sessionId) => {
          setSelectedSession({ workspaceId, sessionId });
          setView("sessions");
        }}
        onRefresh={loadWorkspaces}
        refreshing={refreshing}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Tabs view={view} onViewChange={setView} />
        <div className="flex-1 overflow-y-auto">
          {view === "dashboard" ? (
            <Dashboard />
          ) : view === "analyze" ? (
            <AnalyzeView />
          ) : view === "workspaces" ? (
            <WorkspacesView
              workspaces={workspaces}
              onSelectSession={(workspaceId, sessionId) => {
                setSelectedSession({ workspaceId, sessionId });
                setView("sessions");
              }}
            />
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
  );
}

export default App;
