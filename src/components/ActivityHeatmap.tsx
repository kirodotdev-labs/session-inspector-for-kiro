import { useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { clsx } from "clsx";

interface DayStat {
  date: string;
  sessions: number;
  executions: number;
  cost: number;
}

interface Cell {
  date: string;
  dow: number;
  inRange: boolean;
  sessions: number;
  executions: number;
  cost: number;
  value: number;
}

const RANGE_OPTIONS = [3, 6, 12] as const;
type RangeMonths = (typeof RANGE_OPTIONS)[number];

const WEEKDAY_LABELS: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };

/**
 * Format a Date as a local YYYY-MM-DD key. `toISOString().slice(0, 10)`
 * converts through UTC first, which shifts the date across a DST boundary
 * (e.g. in Europe/London, local midnight on the day clocks spring forward
 * lands on the *previous* UTC day) — producing a duplicated/skipped day.
 * Building the key from local Y/M/D components avoids that entirely.
 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LEVEL_CLASS = [
  "bg-[var(--bg-tertiary)]",
  "bg-emerald-900/60",
  "bg-emerald-700",
  "bg-emerald-500",
  "bg-emerald-400",
];

function levelFor(value: number, max: number): number {
  if (value <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** GitHub-style activity heatmap: one column per week, one row per weekday. */
export function ActivityHeatmap({ daily }: { daily: DayStat[] }) {
  const [months, setMonths] = useState<RangeMonths>(6);

  const { weeks, max } = useMemo(() => {
    const byDate = new Map(daily.map((d) => [d.date, d]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeStart = new Date(today);
    rangeStart.setMonth(rangeStart.getMonth() - months);
    // Align to the start of the week (Sunday) so full columns line up.
    const start = new Date(rangeStart);
    start.setDate(start.getDate() - start.getDay());

    const cells: Cell[] = [];
    let cur = new Date(start);
    while (cur <= today) {
      const key = localDateKey(cur);
      const stat = byDate.get(key);
      const sessions = stat?.sessions ?? 0;
      const executions = stat?.executions ?? 0;
      const cost = stat?.cost ?? 0;
      cells.push({
        date: key,
        dow: cur.getDay(),
        inRange: cur >= rangeStart,
        sessions,
        executions,
        cost,
        value: sessions + executions,
      });
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }

    const weeks: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    const max = Math.max(...cells.map((c) => c.value), 1);
    return { weeks, max };
  }, [daily, months]);

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
          <Calendar size={14} />
          Activity Heat Map
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            {RANGE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={clsx(
                  "px-2 py-0.5 rounded transition-colors",
                  months === m
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {m}mo
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-[var(--text-secondary)]">
            <span>Less</span>
            {LEVEL_CLASS.map((cls, i) => (
              <span key={i} className={clsx("w-2.5 h-2.5 rounded-sm", cls)} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>

      <div className="flex gap-[3px] overflow-x-auto pb-1">
        <div className="flex flex-col gap-[3px] pr-1 shrink-0">
          {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
            <div
              key={dow}
              className="w-8 h-2.5 text-[10px] leading-[10px] text-[var(--text-secondary)]"
            >
              {WEEKDAY_LABELS[dow] ?? ""}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((cell) =>
                cell.inRange ? (
                  <div
                    key={cell.date}
                    className={clsx(
                      "w-2.5 h-2.5 rounded-sm",
                      LEVEL_CLASS[levelFor(cell.value, max)],
                    )}
                    title={`${cell.date}: ${cell.sessions} sessions, ${cell.executions} execs, ${cell.cost.toFixed(2)} cr`}
                  />
                ) : (
                  <div key={cell.date} className="w-2.5 h-2.5" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
