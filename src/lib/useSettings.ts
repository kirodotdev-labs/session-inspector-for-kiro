import { useContext } from "react";
import { SettingsContext, type SettingsState } from "./settingsContext";

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
