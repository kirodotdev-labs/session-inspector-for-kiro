import { createContext } from "react";

export interface SettingsState {
  /** When false, only Unified (shared IDE+CLI) sessions are shown. */
  showNonUnified: boolean;
  setShowNonUnified: (value: boolean) => void;
}

export const SettingsContext = createContext<SettingsState | null>(null);
