import {
  Sparkles,
  Play,
  AlertTriangle,
  Loader2,
  Calendar,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";
import { isDesktop, openAnalysis } from "../lib/api";
import { useAnalysis } from "../lib/useAnalysis";
import { AnalysesView } from "./AnalysesView";
import type { AnalysisWindow, AnalysisVoice } from "../lib/analysisContext";

const WINDOWS: { value: AnalysisWindow; label: string; hint: string }[] = [
  { value: "day", label: "Last Day", hint: "24h" },
  { value: "week", label: "Last Week", hint: "7d" },
  { value: "month", label: "Last Month", hint: "30d" },
];

const VOICES: { value: AnalysisVoice; label: string }[] = [
  { value: "default", label: "Direct & encouraging" },
  { value: "blunt", label: "Blunt / no praise" },
  { value: "neutral", label: "Neutral / analytical" },
];

export function AnalyzeView() {
  const { status, window, voice, result, error, setWindow, setVoice, run } =
    useAnalysis();
  const loading = status === "running";
  const desktop = isDesktop();
  const [openError, setOpenError] = useState<string | null>(null);
  // Once the user opens a report, hide its "ready" banner. Tracked by id so a
  // fresh run's banner still appears.
  const [openedId, setOpenedId] = useState<string | null>(null);

  const open = async () => {
    if (!result) return;
    setOpenError(null);
    setOpenedId(result.id); // optimistically dismiss the banner
    try {
      await openAnalysis(result.id);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
      setOpenedId(null); // reopen the banner so they can retry / see the error
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--accent)]" />
          Analyze Sessions
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Runs a headless Kiro analysis of your recent sessions and produces an
          HTML report. Only optimized signals (tool success/failure counts and
          error categories) are sent — never raw transcripts or tool
          inputs/outputs. Kiro pulls more detail on demand through a local
          read-only MCP tool.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1.5 mb-2">
            <Calendar size={12} /> Time window
          </label>
          <div className="flex gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindow(w.value)}
                disabled={loading}
                className={clsx(
                  "flex-1 px-3 py-2 rounded-md text-sm border transition-colors disabled:opacity-50",
                  window === w.value
                    ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]/40",
                )}
              >
                {w.label}
                <span className="ml-1.5 text-[10px] opacity-60">{w.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-[var(--text-secondary)] block mb-2">
            Voice
          </label>
          <div className="flex gap-2">
            {VOICES.map((v) => (
              <button
                key={v.value}
                onClick={() => setVoice(v.value)}
                disabled={loading}
                className={clsx(
                  "flex-1 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50",
                  voice === v.value
                    ? "bg-[var(--bg-tertiary)] border-[var(--text-secondary)]/40 text-[var(--text-primary)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={run}
          disabled={loading || !desktop}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Analyzing… (this can
              take a minute)
            </>
          ) : (
            <>
              <Play size={16} /> Run analysis
            </>
          )}
        </button>

        {!desktop && (
          <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Analysis launches the local kiro-cli and
            is only available in the desktop app.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle size={14} /> Analysis failed
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs opacity-90">
            {error}
          </pre>
        </div>
      )}

      {status === "done" && result && openedId !== result.id && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 font-medium">
            <CheckCircle2 size={16} /> Report ready
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            Your {result.window} analysis was generated and saved. It also
            appears in the History tab.
          </p>
          <button
            onClick={open}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            <ExternalLink size={15} /> Open report in browser
          </button>
          {openError && (
            <p className="text-xs text-red-300 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {openError}
            </p>
          )}
        </div>
      )}

      {/* Past analyses — reloads whenever a new run completes. */}
      <AnalysesView reloadKey={result?.id ?? "none"} />
    </div>
  );
}
