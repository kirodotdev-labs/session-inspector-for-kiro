import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Archive,
  Database,
} from "lucide-react";
import { clsx } from "clsx";
import {
  isDesktop,
  searchSessions,
  reindexSessions,
  searchIndexStats,
  type SearchHit,
  type IndexStats,
} from "../lib/api";
import type { Source } from "../lib/source";
import { ALL_SOURCES, SOURCE_LABELS, SOURCE_BADGE_CLASS } from "../lib/source";
import { SourceIcon } from "./SourceIcon";

interface Props {
  /** Open an on-disk session in the Session view. */
  onOpenSession: (workspaceId: string, sessionId: string) => void;
}

type SourceFilter = "all" | Source;

const DEBOUNCE_MS = 200;

/**
 * Minimum query length before searching. A single character is both a very
 * broad match (slow, unhelpful) and rarely what the user wants.
 */
const MIN_QUERY_LEN = 2;

function relativeTime(ms: number | null): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/**
 * Renders a snippet whose highlighted terms are wrapped in `<mark>` by the
 * backend's FTS5 snippet(). We escape everything else and only re-allow the
 * `<mark>`/`</mark>` markers so the highlight can't inject arbitrary HTML.
 */
function Snippet({ text }: { text: string }) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
  return (
    <span
      className="[&_mark]:bg-[var(--accent)]/30 [&_mark]:text-[var(--text-primary)] [&_mark]:rounded [&_mark]:px-0.5"
      dangerouslySetInnerHTML={{ __html: escaped }}
    />
  );
}

export function SearchView({ onOpenSession }: Props) {
  const desktop = isDesktop();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(() => {
    if (!desktop) return;
    searchIndexStats()
      .then(setStats)
      .catch(() => {});
  }, [desktop]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const runSearch = useCallback(
    (q: string, source: SourceFilter) => {
      const trimmed = q.trim();
      if (trimmed.length < MIN_QUERY_LEN) {
        setHits([]);
        setTotal(0);
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      searchSessions(trimmed, {
        source: source === "all" ? undefined : source,
        limit: 50,
      })
        .then((r) => {
          setHits(r.hits);
          setTotal(r.total);
          setSearched(true);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [],
  );

  // Debounced search as the user types / changes the filter.
  useEffect(() => {
    if (!desktop) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, sourceFilter), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, sourceFilter, desktop, runSearch]);

  const reindex = async (full: boolean) => {
    setReindexing(true);
    setError(null);
    try {
      const s = await reindexSessions(full);
      setStats(s);
      // Refresh current results against the updated index.
      runSearch(query, sourceFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReindexing(false);
    }
  };

  if (!desktop) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-sm text-amber-400/90 flex items-center gap-1.5">
          <AlertTriangle size={14} /> Full-text search runs against a local index
          and is only available in the desktop app.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Search size={18} className="text-[var(--accent)]" />
          Search Sessions
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Free-text search across all indexed sessions. Sessions deleted from
          disk after indexing remain searchable.
        </p>
      </div>

      {/* Search box */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search prompts, responses… use &quot;quotes&quot; for a phrase"
          className="w-full pl-9 pr-9 py-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-sm outline-none focus:border-[var(--accent)]/50 transition-colors"
        />
        {loading && (
          <Loader2
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] animate-spin"
          />
        )}
      </div>

      {/* Filters + index status */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {(["all", ...ALL_SOURCES] as SourceFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={clsx(
                "px-2.5 py-1 text-[11px] rounded transition-colors flex items-center gap-1",
                sourceFilter === f
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {f !== "all" && <SourceIcon source={f} size={10} />}
              {f === "all" ? "All" : SOURCE_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
          {stats && (
            <span className="flex items-center gap-1" title="Indexed content">
              <Database size={11} />
              {stats.sessionCount} sessions
              {stats.archivedCount > 0 && (
                <span className="flex items-center gap-0.5 ml-1 text-amber-400/80">
                  <Archive size={10} /> {stats.archivedCount} archived
                </span>
              )}
              <span className="opacity-60 ml-1">
                · indexed {relativeTime(stats.lastIndexedAt)}
              </span>
            </span>
          )}
          <button
            onClick={() => reindex(false)}
            disabled={reindexing}
            title="Incrementally update the index"
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={clsx(reindexing && "animate-spin")} />
            Reindex
          </button>
          <button
            onClick={() => reindex(true)}
            disabled={reindexing}
            title="Rebuild the entire index from scratch"
            className="px-2 py-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
          >
            Rebuild
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Results */}
      {searched && (
        <p className="text-xs text-[var(--text-secondary)]">
          {total} {total === 1 ? "session" : "sessions"} matched
          {total > hits.length && ` (showing first ${hits.length})`}
        </p>
      )}

      <div className="space-y-2">
        {hits.map((hit) => {
          const clickable = hit.onDisk;
          return (
            <div
              key={`${hit.source}:${hit.sessionId}`}
              onClick={() =>
                clickable && onOpenSession(hit.workspaceId, hit.sessionId)
              }
              className={clsx(
                "border rounded-lg p-3 transition-colors",
                clickable
                  ? "border-[var(--border)] hover:border-[var(--accent)]/40 hover:bg-[var(--bg-secondary)] cursor-pointer"
                  : "border-[var(--border)] opacity-80",
              )}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={clsx(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border",
                    SOURCE_BADGE_CLASS[hit.source],
                  )}
                >
                  <SourceIcon source={hit.source} size={9} />
                  {SOURCE_LABELS[hit.source]}
                </span>
                <span className="text-sm font-medium truncate">
                  {hit.title || "Untitled session"}
                </span>
                {!hit.onDisk && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30"
                    title="Files deleted from disk; showing indexed snippets"
                  >
                    <Archive size={9} /> archived
                  </span>
                )}
                <span className="ml-auto text-[11px] text-[var(--text-secondary)] shrink-0">
                  {hit.matchCount} {hit.matchCount === 1 ? "match" : "matches"}
                </span>
              </div>

              {hit.workspacePath && (
                <p className="text-[11px] text-[var(--text-secondary)] truncate mb-1.5">
                  {hit.workspacePath}
                </p>
              )}

              <div className="space-y-1">
                {hit.snippets.map((s, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] shrink-0 w-14 pt-0.5">
                      {s.role}
                    </span>
                    <span className="text-[var(--text-secondary)] break-words">
                      <Snippet text={s.text} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {searched && !loading && hits.length === 0 && !error && (
        <div className="text-center text-sm text-[var(--text-secondary)] py-10">
          No sessions matched “{query.trim()}”.
        </div>
      )}
    </div>
  );
}
