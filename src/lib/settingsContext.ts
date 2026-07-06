import { createContext } from "react";

export interface SettingsState {
  /** When false, only Unified (shared IDE+CLI) sessions are shown. */
  showNonUnified: boolean;
  setShowNonUnified: (value: boolean) => void;
  /**
   * Optional path to the `kiro-cli` binary. Empty string means "use the
   * default `kiro-cli` lookup" (PATH resolution, falling back to the common
   * `~/.local/bin/kiro-cli` install location).
   */
  kiroCliPath: string;
  setKiroCliPath: (value: string) => void;
}

export const SettingsContext = createContext<SettingsState | null>(null);
