import { useContext } from "react";
import { AnalysisContext, type AnalysisState } from "./analysisContext";

export function useAnalysis(): AnalysisState {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}
