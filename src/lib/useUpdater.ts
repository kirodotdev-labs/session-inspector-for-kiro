import { useContext } from "react";
import { UpdaterContext, type UpdaterState } from "./updaterContext";

export function useUpdater(): UpdaterState {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used within UpdaterProvider");
  return ctx;
}
