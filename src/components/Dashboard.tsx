import { useEffect, useState } from "react";
import {
  Coins,
  Activity,
  Layers,
  FolderOpen,
  TrendingUp,
  Terminal,
  MonitorDot,
} from "lucide-react";
import { clsx } from "clsx";

type Source = "ide" | "cli";

interface DashboardData {
  totalCost: number;
  totalSessions: number;
  totalExecutions: number;
  daily: {
    date: string;
    sessions: number;
    cost: number;
    executions: number;
    ideSessions: number;
    cliSessions: number;
    ideCost: number;
    cliCost: number;
    ideExecutions: number;
    cliExecutions: number;
    actions: Record<string, number>;
  }[];
  modelUsage: Record<string, number>;
  modelSessions: Record<string, number>;
  sessionTypes: Record<string, number>;
  autonomyModes: Record<string, number>;
  workspaces: {
    name: string;
    cost: number;
    sessions: number;
    executions: number;
    source: Source;
  }[];
  sourceStats: Record<
    Source,
    { sessions: number; executions: number; cost: number }
  >;
}

const API = "http://localhost:3001/api";

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/dashboard`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
        Loading dashboard...
      </div>
    );
  if (!data)
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
        Failed to load dashboard
      </div>
    );

  const last30 = (() => {
    const days: typeof data.daily = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const existing = data.daily.find((x) => x.date === key);
      days.push(
        existing || {
          date: key,
          sessions: 0,
          cost: 0,
          executions: 0,
          ideSessions: 0,
          cliSessions: 0,
          ideCost: 0,
          cliCost: 0,
          ideExecutions: 0,
          cliExecutions: 0,
          actions: {},
        },
      );
    }
    return days;
  })();
  const maxCost = Math.max(...last30.map((d) => d.cost), 0.01);

  // Weekly aggregation
  const weeks: {
    week: string;
    cost: number;
    sessions: number;
    executions: number;
    ideCost: number;
    cliCost: number;
  }[] = [];
  const weekMap = new Map<
    string,
    {
      cost: number;
      sessions: number;
      executions: number;
      ideCost: number;
      cliCost: number;
    }
  >();
  for (const d of data.daily) {
    const date = new Date(d.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const existing = weekMap.get(key) || {
      cost: 0,
      sessions: 0,
      executions: 0,
      ideCost: 0,
      cliCost: 0,
    };
    existing.cost += d.cost;
    existing.sessions += d.sessions;
    existing.executions += d.executions;
    existing.ideCost += d.ideCost ?? 0;
    existing.cliCost += d.cliCost ?? 0;
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
        <StatCard
          icon={<Coins size={16} />}
          label="Total Credits"
          value={data.totalCost.toFixed(1)}
        />
        <StatCard
          icon={<Layers size={16} />}
          label="Sessions"
          value={String(data.totalSessions)}
        />
        <StatCard
          icon={<Activity size={16} />}
          label="Executions"
          value={String(data.totalExecutions)}
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="Avg/Session"
          value={(data.totalCost / Math.max(data.totalSessions, 1)).toFixed(2)}
        />
      </div>

      {/* Source breakdown (IDE vs CLI) */}
      {data.sourceStats && (
        <div className="grid grid-cols-2 gap-4">
          <SourceCard
            source="ide"
            stats={data.sourceStats.ide}
            totalSessions={data.totalSessions}
            totalCost={data.totalCost}
          />
          <SourceCard
            source="cli"
            stats={data.sourceStats.cli}
            totalSessions={data.totalSessions}
            totalCost={data.totalCost}
          />
        </div>
      )}

      {/* Daily activity chart (last 30 days) */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            Daily Activity (Last 30 Days)
          </h3>
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" /> IDE
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> CLI
            </span>
          </div>
        </div>
        <div className="flex items-end gap-px" style={{ height: "128px" }}>
          {last30.map((d) => {
            const total = d.cost;
            const totalH =
              total > 0 ? Math.max(4, Math.round((total / maxCost) * 120)) : 0;
            const ideRatio = total > 0 ? (d.ideCost ?? 0) / total : 0;
            const ideH = total > 0 ? Math.round(totalH * ideRatio) : 0;
            const cliH = totalH - ideH;
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-px group relative"
              >
                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-1 text-xs whitespace-nowrap z-10">
                  {d.date}: {total.toFixed(2)} cr ({(d.ideCost ?? 0).toFixed(2)}{" "}
                  IDE · {(d.cliCost ?? 0).toFixed(2)} CLI), {d.executions} execs
                </div>
                <div
                  className="w-full flex flex-col justify-end overflow-hidden rounded-t"
                  style={{ height: `${totalH}px` }}
                >
                  {cliH > 0 && (
                    <div
                      className="w-full bg-emerald-500 opacity-80 group-hover:opacity-100 transition-opacity"
                      style={{ height: `${cliH}px` }}
                    />
                  )}
                  {ideH > 0 && (
                    <div
                      className="w-full bg-[var(--accent)] opacity-80 group-hover:opacity-100 transition-opacity"
                      style={{ height: `${ideH}px` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div
          className="flex gap-px mt-1 text-[10px] font-mono text-[var(--text-secondary)]"
          aria-hidden
        >
          {last30.map((d) => {
            const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
            const letter = ["S", "M", "T", "W", "T", "F", "S"][dow];
            const isWeekend = dow === 0 || dow === 6;
            return (
              <span
                key={`dow-${d.date}`}
                className={clsx(
                  "flex-1 text-center",
                  isWeekend && "text-[var(--text-primary)]/50",
                )}
              >
                {letter}
              </span>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
          <span>{last30[0]?.date}</span>
          <span>{last30.at(-1)?.date}</span>
        </div>
      </div>

      {/* Weekly trend */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            Weekly Spend
          </h3>
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" /> IDE
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> CLI
            </span>
          </div>
        </div>
        <div className="space-y-1">
          {weeks.slice(-8).map((w) => {
            const maxWeekCost = Math.max(
              ...weeks.slice(-8).map((x) => x.cost),
              0.01,
            );
            const totalPct = (w.cost / maxWeekCost) * 100;
            const idePct = w.cost > 0 ? (w.ideCost / w.cost) * totalPct : 0;
            const cliPct = w.cost > 0 ? (w.cliCost / w.cost) * totalPct : 0;
            return (
              <div key={w.week} className="flex items-center gap-2 text-xs">
                <span className="w-20 text-[var(--text-secondary)]">
                  {w.week}
                </span>
                <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden flex">
                  <div
                    className="h-full bg-[var(--accent)] opacity-85"
                    style={{ width: `${idePct}%` }}
                    title={`IDE ${w.ideCost.toFixed(2)} cr`}
                  />
                  <div
                    className="h-full bg-emerald-500 opacity-85"
                    style={{ width: `${cliPct}%` }}
                    title={`CLI ${w.cliCost.toFixed(2)} cr`}
                  />
                </div>
                <span className="w-20 text-right text-[var(--text-primary)]">
                  {w.cost.toFixed(1)} cr
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mode & Model breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">
            Session Type
          </h3>
          <div className="space-y-2">
            {Object.entries(data.sessionTypes || {})
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => {
                const pct = (count / data.totalSessions) * 100;
                return (
                  <div key={type} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-primary)] capitalize">
                        {type}
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                      <div
                        className={clsx(
                          "h-full rounded",
                          type === "spec" ? "bg-blue-500" : "bg-purple-500",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">
            Autonomy Mode
          </h3>
          <div className="space-y-2">
            {Object.entries(data.autonomyModes || {})
              .sort((a, b) => b[1] - a[1])
              .map(([mode, count]) => {
                const pct = (count / data.totalSessions) * 100;
                return (
                  <div key={mode} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-primary)]">{mode}</span>
                      <span className="text-[var(--text-secondary)]">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                      <div
                        className={clsx(
                          "h-full rounded",
                          mode === "Autopilot"
                            ? "bg-green-500"
                            : "bg-amber-500",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">
            Model Usage
          </h3>
          <div className="space-y-2">
            {Object.entries(data.modelSessions || {})
              .sort((a, b) => b[1] - a[1])
              .map(([model, count]) => {
                const pct = (count / data.totalSessions) * 100;
                return (
                  <div key={model} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-primary)] truncate mr-2">
                        {model}
                      </span>
                      <span className="text-[var(--text-secondary)] shrink-0">
                        {count}
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                      <div
                        className="h-full rounded bg-[var(--accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Top workspaces */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3 text-[var(--text-secondary)]">
          Top Workspaces by Spend
        </h3>
        <div className="space-y-2">
          {data.workspaces.slice(0, 10).map((ws) => (
            <div
              key={`${ws.source}:${ws.name}`}
              className="flex items-center gap-3 text-sm"
            >
              {ws.source === "cli" ? (
                <Terminal size={14} className="text-emerald-400" />
              ) : (
                <FolderOpen
                  size={14}
                  className="text-[var(--text-secondary)]"
                />
              )}
              <span className="flex-1 truncate text-[var(--text-primary)]">
                {ws.name}
              </span>
              <span
                className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                  ws.source === "cli"
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                    : "bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30",
                )}
              >
                {ws.source}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {ws.sessions} sessions
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {ws.executions} execs
              </span>
              <span className="text-sm font-medium w-20 text-right">
                {ws.cost.toFixed(1)} cr
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
      <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-1">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  stats,
  totalSessions,
  totalCost,
}: {
  source: Source;
  stats: { sessions: number; executions: number; cost: number };
  totalSessions: number;
  totalCost: number;
}) {
  const isCli = source === "cli";
  const pct = totalSessions > 0 ? (stats.sessions / totalSessions) * 100 : 0;
  const costPct = totalCost > 0 ? (stats.cost / totalCost) * 100 : 0;
  return (
    <div
      className={clsx(
        "border rounded-lg p-4",
        isCli
          ? "bg-emerald-500/5 border-emerald-500/30"
          : "bg-[var(--accent)]/5 border-[var(--accent)]/30",
      )}
    >
      <div
        className={clsx(
          "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-3",
          isCli ? "text-emerald-300" : "text-[var(--accent)]",
        )}
      >
        {isCli ? <Terminal size={14} /> : <MonitorDot size={14} />}
        {isCli ? "Kiro CLI" : "Kiro IDE"}
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-[var(--text-secondary)]">Sessions</div>
          <div className="text-xl font-semibold text-[var(--text-primary)]">
            {stats.sessions}
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            {pct.toFixed(0)}% of all
          </div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Executions</div>
          <div className="text-xl font-semibold text-[var(--text-primary)]">
            {stats.executions}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-secondary)]">Credits</div>
          <div className="text-xl font-semibold text-[var(--text-primary)]">
            {stats.cost.toFixed(1)}
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            {costPct.toFixed(0)}% of spend
          </div>
        </div>
      </div>
    </div>
  );
}
