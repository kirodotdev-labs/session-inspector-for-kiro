import {
  Settings as SettingsIcon,
  SlidersHorizontal,
  Terminal,
  ArrowUpCircle,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
} from "lucide-react";
import { Toggle } from "./Toggle";
import { useSettings } from "../lib/useSettings";
import { useUpdater } from "../lib/useUpdater";
import { isDesktop } from "../lib/api";

/** Dedicated settings screen (moved out of the sidebar footer). */
export function SettingsView() {
  const { showNonUnified, setShowNonUnified, kiroCliPath, setKiroCliPath } =
    useSettings();

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-lg font-medium flex items-center gap-2">
          <SettingsIcon size={18} className="text-[var(--accent)]" />
          Settings
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Preferences are stored locally on this machine.
        </p>
      </div>

      {/* Display */}
      <section className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-3">
          Display
        </h3>
        <div className="flex items-start gap-3">
          <SlidersHorizontal
            size={15}
            className="text-[var(--text-secondary)] mt-0.5 shrink-0"
          />
          <div className="flex-1">
            <div className="text-sm text-[var(--text-primary)]">
              Show non-unified sessions
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              When off, only Unified (shared IDE + CLI) sessions are shown across
              the sidebar and dashboards.
            </p>
          </div>
          <Toggle
            checked={showNonUnified}
            onChange={setShowNonUnified}
            label="Show non-unified sessions"
          />
        </div>
      </section>

      {/* kiro-cli */}
      <section className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-3">
          kiro-cli
        </h3>
        <label
          htmlFor="kiro-cli-path"
          className="flex items-center gap-1.5 text-sm text-[var(--text-primary)]"
        >
          <Terminal size={14} className="text-[var(--text-secondary)]" />
          Binary path
        </label>
        <input
          id="kiro-cli-path"
          type="text"
          value={kiroCliPath}
          onChange={(e) => setKiroCliPath(e.target.value)}
          placeholder="kiro-cli"
          spellCheck={false}
          className="w-full mt-2 px-2.5 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:border-[var(--accent)]/50"
        />
        <p className="text-xs text-[var(--text-secondary)] mt-2">
          Used for the “copy resume command” action and to run analyses. Leave
          empty to use the default lookup (your <code>PATH</code>, falling back
          to <code>~/.local/bin/kiro-cli</code>).
        </p>
      </section>

      <UpdatesSection />
    </div>
  );
}

function UpdatesSection() {
  const { status, currentVersion, update, error, check, install } =
    useUpdater();
  const desktop = isDesktop();
  const busy = status === "checking" || status === "downloading" || status === "installing";

  return (
    <section className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-3">
        Updates
      </h3>
      <div className="flex items-center gap-3">
        <ArrowUpCircle size={15} className="text-[var(--text-secondary)] shrink-0" />
        <div className="flex-1">
          <div className="text-sm text-[var(--text-primary)]">
            Current version{currentVersion ? ` — v${currentVersion}` : ""}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            {!desktop
              ? "Updates are only available in the desktop app."
              : status === "available"
                ? `Update available: v${update?.version}`
                : status === "uptodate"
                  ? "You’re on the latest version."
                  : status === "checking"
                    ? "Checking for updates…"
                    : status === "downloading"
                      ? "Downloading update…"
                      : status === "installing"
                        ? "Installing… the app will restart"
                        : status === "error"
                          ? "Update check failed."
                          : "Automatically checks on launch."}
          </div>
        </div>
        {desktop &&
          (status === "available" ? (
            <button
              onClick={install}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
            >
              <Download size={13} /> Install & restart
            </button>
          ) : (
            <button
              onClick={check}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : status === "uptodate" ? (
                <CheckCircle2 size={13} className="text-emerald-400" />
              ) : (
                <ArrowUpCircle size={13} />
              )}
              Check for updates
            </button>
          ))}
      </div>
      {error && (
        <p className="text-xs text-red-300 flex items-center gap-1.5 mt-2">
          <AlertTriangle size={12} /> {error}
        </p>
      )}
    </section>
  );
}
