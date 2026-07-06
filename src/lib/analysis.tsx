import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AnalysisContext,
  type AnalysisStatus,
  type AnalysisVoice,
  type AnalysisWindow,
} from "./analysisContext";
import { runAnalysis, type AnalysisRecord } from "./api";
import { useSettings } from "./useSettings";

/**
 * Owns the (potentially long-running) analysis job at the app root so it
 * survives switching away from the Analyze tab. The `runAnalysis` promise and
 * all its setState calls live here — unmounting `AnalyzeView` no longer drops
 * an in-flight run, and returning to the tab shows its live status/result.
 */
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [window, setWindow] = useState<AnalysisWindow>("week");
  const [voice, setVoice] = useState<AnalysisVoice>("default");
  const [result, setResult] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Guards against launching a second run while one is in flight (survives
  // re-renders without triggering them).
  const runningRef = useRef(false);
  const { kiroCliPath } = useSettings();

  const run = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("running");
    setError(null);
    setResult(null);
    setStartedAt(Date.now());
    // Fire-and-forget: the provider stays mounted, so the resolution always
    // has a live component to update.
    runAnalysis(window, voice, kiroCliPath || undefined)
      .then((record) => {
        setResult(record);
        setStatus("done");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      })
      .finally(() => {
        runningRef.current = false;
      });
  }, [window, voice, kiroCliPath]);

  return (
    <AnalysisContext.Provider
      value={{
        status,
        window,
        voice,
        result,
        error,
        startedAt,
        setWindow,
        setVoice,
        run,
      }}
    >
      {children}
    </AnalysisContext.Provider>
  );
}
