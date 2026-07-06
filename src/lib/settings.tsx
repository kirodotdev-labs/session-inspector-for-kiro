import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SettingsContext } from "./settingsContext";

/** localStorage key mirroring AppSettings.showNonUnifiedKey in the macOS app. */
const SHOW_NON_UNIFIED_KEY = "showNonUnifiedSessions";
/** localStorage key for the optional custom path to the kiro-cli binary. */
const KIRO_CLI_PATH_KEY = "kiroCliPath";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(SHOW_NON_UNIFIED_KEY);
  return raw === null ? true : raw === "true";
}

function readInitialCliPath(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KIRO_CLI_PATH_KEY) ?? "";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showNonUnified, setShowNonUnifiedState] = useState<boolean>(readInitial);
  const [kiroCliPath, setKiroCliPathState] = useState<string>(readInitialCliPath);

  useEffect(() => {
    window.localStorage.setItem(SHOW_NON_UNIFIED_KEY, String(showNonUnified));
  }, [showNonUnified]);

  useEffect(() => {
    window.localStorage.setItem(KIRO_CLI_PATH_KEY, kiroCliPath);
  }, [kiroCliPath]);

  const setShowNonUnified = useCallback((value: boolean) => {
    setShowNonUnifiedState(value);
  }, []);

  const setKiroCliPath = useCallback((value: string) => {
    setKiroCliPathState(value);
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        showNonUnified,
        setShowNonUnified,
        kiroCliPath,
        setKiroCliPath,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
