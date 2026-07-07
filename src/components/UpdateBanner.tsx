import { Download, X, Loader2, ArrowUpCircle } from "lucide-react";
import { useState } from "react";
import { useUpdater } from "../lib/useUpdater";

/**
 * Slim top banner shown when an update is available (from the silent startup
 * check) or while it's installing. Dismissible; the update stays available in
 * Settings.
 */
export function UpdateBanner() {
  const { status, update, install, downloadedBytes, totalBytes } = useUpdater();
  const [dismissed, setDismissed] = useState(false);

  const installing = status === "downloading" || status === "installing";
  const visible = (status === "available" && !dismissed) || installing;
  if (!visible) return null;

  const pct =
    totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[var(--accent)]/15 border-b border-[var(--accent)]/30 text-sm">
      <ArrowUpCircle size={16} className="text-[var(--accent)] shrink-0" />
      {installing ? (
        <span className="flex items-center gap-2 text-[var(--text-primary)]">
          <Loader2 size={14} className="animate-spin" />
          {status === "installing"
            ? "Installing update… the app will restart"
            : `Downloading update…${pct !== null ? ` ${pct}%` : ""}`}
        </span>
      ) : (
        <>
          <span className="flex-1 text-[var(--text-primary)]">
            A new version{" "}
            <span className="font-semibold">v{update?.version}</span> is
            available.
          </span>
          <button
            onClick={install}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Download size={13} /> Install & restart
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}
