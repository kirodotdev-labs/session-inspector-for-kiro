import { createContext } from "react";
import type { AnalysisRecord } from "./api";

export type AnalysisWindow = "day" | "week" | "month";
export type AnalysisVoice = "default" | "blunt" | "neutral";
export type AnalysisStatus = "idle" | "running" | "done" | "error";

export interface AnalysisState {
  status: AnalysisStatus;
  /** Selected window (also reflects the window of the running/last job). */
  window: AnalysisWindow;
  voice: AnalysisVoice;
  /** The stored record produced by the last completed run. */
  result: AnalysisRecord | null;
  error: string | null;
  /** Epoch ms when the current/last run started (for elapsed display). */
  startedAt: number | null;
  setWindow: (w: AnalysisWindow) => void;
  setVoice: (v: AnalysisVoice) => void;
  /** Start a run. No-op if one is already running. */
  run: () => void;
}

export const AnalysisContext = createContext<AnalysisState | null>(null);
