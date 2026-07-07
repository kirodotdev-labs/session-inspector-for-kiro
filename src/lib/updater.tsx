import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  UpdaterContext,
  type UpdateMeta,
  type UpdaterStatus,
} from "./updaterContext";
import { isDesktop } from "./api";

/**
 * Owns the Tauri auto-update flow at the app root: a check on startup plus a
 * manual check/install driven from Settings, with a banner reflecting the same
 * state. No-op in the browser (updates require the desktop shell).
 */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [currentVersion, setCurrentVersion] = useState("");
  const [update, setUpdate] = useState<UpdateMeta | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The live Update handle (a class instance) is kept out of React state.
  const rawRef = useRef<import("@tauri-apps/plugin-updater").Update | null>(
    null,
  );
  const checkingRef = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (!isDesktop() || checkingRef.current) return;
    checkingRef.current = true;
    setError(null);
    setStatus("checking");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const upd = await check();
      if (upd) {
        rawRef.current = upd;
        setUpdate({
          version: upd.version,
          currentVersion: upd.currentVersion,
          date: upd.date,
          body: upd.body,
        });
        setStatus("available");
      } else {
        // On the silent startup check, stay quiet if nothing's available.
        setStatus(manual ? "uptodate" : "idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(manual ? "error" : "idle");
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const upd = rawRef.current;
    if (!upd) return;
    setError(null);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setStatus("downloading");
    try {
      let downloaded = 0;
      await upd.downloadAndInstall((e) => {
        switch (e.event) {
          case "Started":
            setTotalBytes(e.data.contentLength ?? 0);
            break;
          case "Progress":
            downloaded += e.data.chunkLength;
            setDownloadedBytes(downloaded);
            break;
          case "Finished":
            setStatus("installing");
            break;
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const check = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  useEffect(() => {
    if (!isDesktop()) return;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setCurrentVersion(await getVersion());
      } catch {
        /* ignore */
      }
    })();
    void runCheck(false); // silent startup check
  }, [runCheck]);

  return (
    <UpdaterContext.Provider
      value={{
        status,
        currentVersion,
        update,
        downloadedBytes,
        totalBytes,
        error,
        check,
        install,
      }}
    >
      {children}
    </UpdaterContext.Provider>
  );
}
