import { Settings as SettingsIcon, SlidersHorizontal, Terminal } from "lucide-react";
import { Toggle } from "./Toggle";
import { useSettings } from "../lib/useSettings";

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
    </div>
  );
}
