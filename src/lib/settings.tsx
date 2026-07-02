import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SettingsContext } from "./settingsContext";

/** localStorage key mirroring AppSettings.showNonUnifiedKey in the macOS app. */
const SHOW_NON_UNIFIED_KEY = "showNonUnifiedSessions";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(SHOW_NON_UNIFIED_KEY);
  return raw === null ? true : raw === "true";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showNonUnified, setShowNonUnifiedState] = useState<boolean>(readInitial);

  useEffect(() => {
    window.localStorage.setItem(SHOW_NON_UNIFIED_KEY, String(showNonUnified));
  }, [showNonUnified]);

  const setShowNonUnified = useCallback((value: boolean) => {
    setShowNonUnifiedState(value);
  }, []);

  return (
    <SettingsContext.Provider value={{ showNonUnified, setShowNonUnified }}>
      {children}
    </SettingsContext.Provider>
  );
}
