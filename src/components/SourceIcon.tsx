import { Terminal, MonitorDot, GitMerge, MessagesSquare } from "lucide-react";
import type { Source } from "../lib/source";
import { SOURCE_TEXT_CLASS } from "../lib/source";
import { useSettings } from "../lib/useSettings";

interface Props {
  source: Source;
  size?: number;
  className?: string;
}

/**
 * Icon for a session source, matching the macOS app's SF Symbol choices.
 *
 * When non-unified sessions are hidden, "unified" is the only source in
 * play and no longer needs to visually signal "merged IDE+CLI format" —
 * at that point it just represents "a session", so we swap the merge
 * glyph for a conversation icon that reads closer to that concept.
 */
export function SourceIcon({ source, size = 14, className }: Props) {
  const { showNonUnified } = useSettings();
  const cls = className ?? `${SOURCE_TEXT_CLASS[source]} shrink-0`;
  if (source === "cli") return <Terminal size={size} className={cls} />;
  if (source === "unified") {
    return showNonUnified ? (
      <GitMerge size={size} className={cls} />
    ) : (
      <MessagesSquare size={size} className={cls} />
    );
  }
  return <MonitorDot size={size} className={cls} />;
}
