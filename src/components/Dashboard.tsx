import { useEffect, useState } from "react";
import {
  Coins,
  Activity,
  Layers,
  FolderOpen,
  TrendingUp,
  Clock,
} from "lucide-react";
import { clsx } from "clsx";
import { formatDuration } from "../lib/format";
import type { Source } from "../lib/source";
import {
  ALL_SOURCES,
  SOURCE_BADGE_CLASS,
  SOURCE_DISPLAY_NAMES,
  SOURCE_FILL_CLASS,
  SOURCE_LABELS,
  SOURCE_TEXT_CLASS,
} from "../lib/source";
import { SourceIcon } from "./SourceIcon";
import { useSettings } from "../lib/useSettings";

interface DailyStats {
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
  unifiedSessions: number;
  unifiedCost: number;
  unifiedExecutions: number;
  actions: Record<string, number>;
}

const BLANK_DAY: Omit<DailyStats, "date"> = {
  sessions: 0,
  cost: 0,
  executions: 0,
  ideSessions: 0,
  cliSessions: 0,
  ideCost: 0,
  cliCost: 0,
  ideExecutions: 0,
  cliExecutions: 0,
  unifiedSessions: 0,
  unifiedCost: 0,
  unifiedExecutions: 0,
  actions: {},
};

function costFor(d: DailyStats, source: Source): number {
  if (source === "ide") return d.ideCost;
  if (source === "cli") return d.cliCost;
  return d.unifiedCost;
}

interface DashboardData {
  totalCost: number;
  totalSessions: number;
  totalExecutions: number;
  totalDuration: number;
  daily: DailyStats[];
  modelUsage: Record<string, number>;
  modelSessions: Record<string, number>;
  sessionTypes: Record<string, number>;
  autonomyModes: Record<string, number>;
  workspaces: {
    name: string;
    cost: number;
    sessions: number;
    executions: number;
    duration: number;
    source: Source;
  }[];
  sourceStats: Record<
    Source,
    { sessions: number; executions: number; cost: number }
  >;
}

const API = "http://localhost:3001/api";

interface DashboardProps {
  /** When set, the dashboard is scoped to a single workspace path. */
  workspacePath?: string;
  /** Display name for the scoped workspace (used in the heading). */
  workspaceName?: string;
}

export function Dashboard({ workspacePath, workspaceName }: DashboardProps = {}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // When non-unified sessions are hidden, every dashboard (main + per-workspace)
  // scopes to Unified sessions only; otherwise it shows all sources.
  const { showNonUnified } = useSettings();

  useEffect(() => {
    setLoading(true);
    let url: string;
    if (workspacePath) {
      url = `${API}/workspace-dashboard?path=${encodeURIComponent(workspacePath)}`;
      if (!showNonUnified) url += "&source=unified";
    } else {
      url = showNonUnified ? `${API}/dashboard` : `${API}/unified-dashboard`;
    }
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspacePath, showNonUnified]);

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

  const title = workspaceName
    ? `${workspaceName} — Dashboard`
    : showNonUnified
      ? "Usage Dashboard"
      : "Unified Dashboard";

  if (!showNonUnified && data.totalSessions === 0) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          No unified sessions yet. Going forward, IDE and CLI both write the
          unified format.
        </p>
      </div>
    );
  }

  // Sources present in this dataset, in a stable order — drives the source
  // cards, chart legends, and stacked bars below.
  const presentSources = ALL_SOURCES.filter(
    (s) => (data.sourceStats?.[s]?.sessions ?? 0) > 0,
  );

  const last30 = (() => {
    const days: DailyStats[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const existing = data.daily.find((x) => x.date === key);
      days.push(existing || { date: key, ...BLANK_DAY });
    }
    return days;
  })();
  const maxCost = Math.max(...last30.map((d) => d.cost), 0.01);

  // Weekly aggregation
  interface WeeklyStats {
    week: string;
    cost: number;
    sessions: number;
    executions: number;
    costBySource: Record<Source, number>;
  }
  const weeks: WeeklyStats[] = [];
  const weekMap = new Map<string, WeeklyStats>();
  for (const d of data.daily) {
    const date = new Date(d.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const existing =
      weekMap.get(key) ||
      ({
        week: key,
        cost: 0,
        sessions: 0,
        executions: 0,
        costBySource: { ide: 0, cli: 0, unified: 0 },
      } as WeeklyStats);
    existing.cost += d.cost;
    existing.sessions += d.sessions;
    existing.executions += d.executions;
    for (const s of ALL_SOURCES) existing.costBySource[s] += costFor(d, s);
    weekMap.set(key, existing);
  }
  for (const stats of weekMap.values()) {
    weeks.push(stats);
  }
  weeks.sort((a, b) => a.week.localeCompare(b.week));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h2 className="text-lg font-medium">{title}</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4">
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
          icon={<Clock size={16} />}
          label="Total Time"
          value={formatDuration(data.totalDuration)}
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label="Avg/Session"
          value={(data.totalCost / Math.max(data.totalSessions, 1)).toFixed(2)}
        />
      </div>

      {/* Source breakdown — only sources present in this dataset */}
      {data.sourceStats && presentSources.length > 0 && (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${presentSources.length}, minmax(0, 1fr))`,
          }}
        >
          {presentSources.map((source) => (
            <SourceCard
              key={source}
              source={source}
              stats={data.sourceStats[source]}
              totalSessions={data.totalSessions}
              totalCost={data.totalCost}
            />
          ))}
        </div>
      )}

      {/* Daily activity chart (last 30 days) */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            Daily Activity (Last 30 Days)
          </h3>
          <SourceLegend sources={presentSources} />
        </div>
        <div className="flex items-end gap-px" style={{ height: "128px" }}>
          {last30.map((d) => {
            const total = d.cost;
            const totalH =
              total > 0 ? Math.max(4, Math.round((total / maxCost) * 120)) : 0;
            // Stack segments in source order; each segment's height is
            // proportional to its share of the day's total cost.
            let remaining = totalH;
            const segments = presentSources.map((source, idx) => {
              if (idx === presentSources.length - 1) {
                const h = remaining;
                remaining = 0;
                return { source, h };
              }
              const ratio = total > 0 ? costFor(d, source) / total : 0;
              const h = total > 0 ? Math.round(totalH * ratio) : 0;
              remaining -= h;
              return { source, h };
            });
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-px group relative"
              >
                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-2 py-1 text-xs whitespace-nowrap z-10">
                  {d.date}: {total.toFixed(2)} cr (
                  {presentSources
                    .map((s) => `${costFor(d, s).toFixed(2)} ${SOURCE_LABELS[s]}`)
                    .join(" · ")}
                  ), {d.executions} execs
                </div>
                <div
                  className="w-full flex flex-col justify-end overflow-hidden rounded-t"
                  style={{ height: `${totalH}px` }}
                >
                  {segments
                    .slice()
                    .reverse()
                    .map(
                      ({ source, h }) =>
                        h > 0 && (
                          <div
                            key={source}
                            className={clsx(
                              SOURCE_FILL_CLASS[source],
                              "w-full opacity-80 group-hover:opacity-100 transition-opacity",
                            )}
                            style={{ height: `${h}px` }}
                          />
                        ),
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
          <SourceLegend sources={presentSources} />
        </div>
        <div className="space-y-1">
          {weeks.slice(-8).map((w) => {
            const maxWeekCost = Math.max(
              ...weeks.slice(-8).map((x) => x.cost),
              0.01,
            );
            const totalPct = (w.cost / maxWeekCost) * 100;
            return (
              <div key={w.week} className="flex items-center gap-2 text-xs">
                <span className="w-20 text-[var(--text-secondary)]">
                  {w.week}
                </span>
                <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden flex">
                  {presentSources.map((source) => {
                    const pct =
                      w.cost > 0
                        ? (w.costBySource[source] / w.cost) * totalPct
                        : 0;
                    return (
                      <div
                        key={source}
                        className={clsx(SOURCE_FILL_CLASS[source], "h-full opacity-85")}
                        style={{ width: `${pct}%` }}
                        title={`${SOURCE_LABELS[source]} ${w.costBySource[source].toFixed(2)} cr`}
                      />
                    );
                  })}
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
                          type === "spec"
                            ? "bg-blue-500"
                            : type === "cli"
                              ? "bg-emerald-500"
                              : type === "unified"
                                ? "bg-violet-500"
                                : "bg-purple-500",
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
              {ws.source === "ide" ? (
                <FolderOpen
                  size={14}
                  className="text-[var(--text-secondary)]"
                />
              ) : (
                <SourceIcon source={ws.source} size={14} />
              )}
              <span className="flex-1 truncate text-[var(--text-primary)]">
                {ws.name}
              </span>
              <span
                className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold border",
                  SOURCE_BADGE_CLASS[ws.source],
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
              <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)] w-20 justify-end">
                <Clock size={11} /> {formatDuration(ws.duration ?? 0)}
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

function SourceLegend({ sources }: { sources: Source[] }) {
  return (
    <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
      {sources.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={clsx("w-2.5 h-2.5 rounded-sm", SOURCE_FILL_CLASS[s])} />{" "}
          {SOURCE_LABELS[s]}
        </span>
      ))}
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
  const pct = totalSessions > 0 ? (stats.sessions / totalSessions) * 100 : 0;
  const costPct = totalCost > 0 ? (stats.cost / totalCost) * 100 : 0;
  const cardBgClass: Record<Source, string> = {
    ide: "bg-[var(--accent)]/5 border-[var(--accent)]/30",
    cli: "bg-emerald-500/5 border-emerald-500/30",
    unified: "bg-violet-500/5 border-violet-500/30",
  };
  return (
    <div className={clsx("border rounded-lg p-4", cardBgClass[source])}>
      <div
        className={clsx(
          "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-3",
          SOURCE_TEXT_CLASS[source],
        )}
      >
        <SourceIcon source={source} size={14} />
        {SOURCE_DISPLAY_NAMES[source]}
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
