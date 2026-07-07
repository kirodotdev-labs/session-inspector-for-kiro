import { createContext } from "react";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "downloading"
  | "installing"
  | "error";

export interface UpdateMeta {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface UpdaterState {
  status: UpdaterStatus;
  /** Running app version (empty in the browser). */
  currentVersion: string;
  /** Metadata for an available update, if any. */
  update: UpdateMeta | null;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  /** Manually check for an update (surfaces up-to-date / error states). */
  check: () => void;
  /** Download + install the available update, then relaunch. */
  install: () => void;
}

export const UpdaterContext = createContext<UpdaterState | null>(null);
