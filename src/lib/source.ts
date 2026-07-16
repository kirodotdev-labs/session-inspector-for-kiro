/**
 * Session source. Kiro CLI v3 and the new IDE share the same session format
 * and storage, so those sessions are surfaced as "unified" rather than
 * "CLI v3" — a distinct source alongside the legacy `ide` and `cli` (v2)
 * sources. Mirrors `SessionSource` in the macOS Swift app.
 */
export type Source = "ide" | "cli" | "unified";

export const ALL_SOURCES: Source[] = ["ide", "cli", "unified"];

export const SOURCE_LABELS: Record<Source, string> = {
  ide: "IDE",
  cli: "CLI",
  unified: "Unified",
};

export const SOURCE_DISPLAY_NAMES: Record<Source, string> = {
  ide: "Kiro IDE",
  cli: "Kiro CLI",
  unified: "Kiro Unified",
};

/** Tailwind text color class for a source's accent. */
export const SOURCE_TEXT_CLASS: Record<Source, string> = {
  ide: "text-[var(--accent)]",
  cli: "text-emerald-400",
  unified: "text-violet-400",
};

/** Tailwind background/border classes for badges and chips. */
export const SOURCE_BADGE_CLASS: Record<Source, string> = {
  ide: "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30",
  cli: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  unified: "bg-violet-500/10 text-violet-300 border-violet-500/30",
};

/** Chart/bar fill classes per source. */
export const SOURCE_FILL_CLASS: Record<Source, string> = {
  ide: "bg-[var(--accent)]",
  cli: "bg-emerald-500",
  unified: "bg-violet-500",
};

/** Tint classes for a selected item in a list (sidebar sessions, etc.). */
export const SOURCE_SELECTED_CLASS: Record<Source, string> = {
  ide: "bg-[var(--accent)]/15 text-[var(--accent)]",
  cli: "bg-emerald-500/15 text-emerald-300",
  unified: "bg-violet-500/15 text-violet-300",
};
