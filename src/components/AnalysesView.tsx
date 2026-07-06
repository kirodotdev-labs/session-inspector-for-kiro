import { useCallback, useEffect, useState } from "react";
import {
  History,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { clsx } from "clsx";
import {
  listAnalyses,
  openAnalysis,
  deleteAnalysis,
  isDesktop,
  type AnalysisRecord,
} from "../lib/api";

const WINDOW_LABEL: Record<string, string> = {
  day: "Last day",
  week: "Last week",
  month: "Last month",
};

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AnalysesView({ reloadKey }: { reloadKey?: string | number }) {
  const [items, setItems] = useState<AnalysisRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const desktop = isDesktop();

  const refresh = useCallback(() => {
    setLoading(true);
    listAnalyses()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Reload on mount and whenever `reloadKey` changes (e.g. a new run finished).
  useEffect(() => {
    refresh();
  }, [refresh, reloadKey]);

  const open = async (id: string) => {
    setError(null);
    try {
      await openAnalysis(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await deleteAnalysis(id);
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2 text-[var(--text-secondary)]">
          <History size={15} className="text-[var(--accent)]" />
          Past Analyses
        </h3>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center text-sm text-[var(--text-secondary)] py-8 border border-dashed border-[var(--border)] rounded-lg">
          {desktop
            ? "No analyses yet. Run one above."
            : "Analysis history is only available in the desktop app."}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {WINDOW_LABEL[r.window] ?? r.window}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                    {r.voice}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {formatDate(r.createdAt)} · {formatBytes(r.reportBytes)}
                </div>
              </div>
              <button
                onClick={() => open(r.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                <ExternalLink size={13} /> Open
              </button>
              <button
                onClick={() => remove(r.id)}
                disabled={busyId === r.id}
                title="Delete analysis"
                className={clsx(
                  "inline-flex items-center justify-center w-8 h-8 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-50",
                )}
              >
                {busyId === r.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
