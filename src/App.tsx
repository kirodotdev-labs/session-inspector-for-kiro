import { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionView } from "./components/SessionView";
import { Dashboard } from "./components/Dashboard";
import { WorkspacesView } from "./components/WorkspacesView";
import type { Source } from "./lib/source";

export type { Source };

export type View = "dashboard" | "sessions" | "workspaces";

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

const API = "http://localhost:3001/api";

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedSession, setSelectedSession] = useState<{
    workspaceId: string;
    sessionId: string;
  } | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("dashboard");

  useEffect(() => {
    fetch(`${API}/workspaces`)
      .then((r) => r.json())
      .then(setWorkspaces);
  }, []);

  useEffect(() => {
    if (!selectedSession) return;
    setLoading(true);
    fetch(
      `${API}/workspaces/${encodeURIComponent(selectedSession.workspaceId)}/sessions/${selectedSession.sessionId}`,
    )
      .then((r) => r.json())
      .then((d) => {
        setSession(d);
        setLoading(false);
      });
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
        view={view}
        onViewChange={setView}
      />
      <main className="flex-1 overflow-y-auto">
        {view === "dashboard" ? (
          <Dashboard />
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
      </main>
    </div>
  );
}

export default App;
