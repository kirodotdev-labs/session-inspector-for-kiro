import { useEffect, useState } from "react";
import { Coins, Activity, Layers, FolderOpen, TrendingUp } from "lucide-react";

interface DashboardData {
  totalCost: number;
  totalSessions: number;
  totalExecutions: number;
  daily: { date: string; sessions: number; cost: number; executions: number; actions: Record<string, number> }[];
  modelUsage: Record<string, number>;
  workspaces: { name: string; cost: number; sessions: number; executions: number }[];
}

const API = "http://localhost:3001/api";

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/dashboard`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">Loading dashboard...</div>;
  if (!data) return <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">Failed to load dashboard</div>;

  const last30 = data.daily.slice(-30);
  const maxCost = Math.max(...last30.map((d) => d.cost), 0.01);

  // Weekly aggregation
  const weeks: { week: string; cost: number; sessions: number; executions: number }[] = [];
  const weekMap = new Map<string, { cost: number; sessions: number; executions: number }>();
  for (const d of data.daily) {
    const date = new Date(d.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const existing = weekMap.get(key) || { cost: 0, sessions: 0, executions: 0 };
    existing.cost += d.cost;
    existing.sessions += d.sessions;
    existing.executions += d.executions;
    weekMap.set(key, existing);
  }
  for (const [week, stats] of weekMap) {
    weeks.push({ week, ...stats });
  }
  weeks.sort((a, b) => a.week.localeCompare(b.week));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h2 className="text-lg font-medium">Usage Dashboard</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<Coins size={16} />} label="Total Credits" value={data.totalCost.toFixed(1)} />
        <StatCard icon={<Layers size={16} />} label="Sessions" value={String(data.totalSessions)} />
        <StatCard icon={<Activity size={16} />} label="Executions" value={String(data.totalExecutions)} />
        <StatCard icon={<TrendingUp size={16} />} label="Avg/Session" value={(data.totalCost / Math.max(data.totalSessions, 1)).toFixed(2)} />
      </div>

      {/* Daily activity chart (last 30 days) */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">Daily Activity (Last 30 Days)</h3>
        <div className="flex items-end gap-px h-32">
          {last30.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-px group relative">
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-1 text-xs whitespace-nowrap z-10">
                {d.date}: {d.cost.toFixed(2)} credits, {d.executions} execs
              </div>
              <div
                className="w-full bg-[var(--accent)] rounded-t opacity-70 hover:opacity-100 transition-opacity"
                style={{ height: `${(d.cost / maxCost) * 100}%`, minHeight: d.cost > 0 ? "2px" : "0" }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
          <span>{last30[0]?.date}</span>
          <span>{last30[last30.length - 1]?.date}</span>
        </div>
      </div>

      {/* Weekly trend */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">Weekly Spend</h3>
        <div className="space-y-1">
          {weeks.slice(-8).map((w) => {
            const maxWeekCost = Math.max(...weeks.slice(-8).map((x) => x.cost), 0.01);
            return (
              <div key={w.week} className="flex items-center gap-2 text-xs">
                <span className="w-20 text-[var(--text-secondary)]">{w.week}</span>
                <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                  <div className="h-full bg-[var(--accent)] rounded opacity-70" style={{ width: `${(w.cost / maxWeekCost) * 100}%` }} />
                </div>
                <span className="w-20 text-right text-[var(--text-primary)]">{w.cost.toFixed(1)} cr</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top workspaces */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">Top Workspaces by Spend</h3>
        <div className="space-y-2">
          {data.workspaces.slice(0, 10).map((ws) => (
            <div key={ws.name} className="flex items-center gap-3 text-sm">
              <FolderOpen size={14} className="text-[var(--text-secondary)]" />
              <span className="flex-1 truncate text-[var(--text-primary)]">{ws.name}</span>
              <span className="text-xs text-[var(--text-secondary)]">{ws.sessions} sessions</span>
              <span className="text-xs text-[var(--text-secondary)]">{ws.executions} execs</span>
              <span className="text-sm font-medium w-20 text-right">{ws.cost.toFixed(1)} cr</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
      <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-1">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
