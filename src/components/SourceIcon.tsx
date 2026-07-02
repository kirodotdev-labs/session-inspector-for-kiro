import { Terminal, MonitorDot, GitMerge } from "lucide-react";
import type { Source } from "../lib/source";
import { SOURCE_TEXT_CLASS } from "../lib/source";

interface Props {
  source: Source;
  size?: number;
  className?: string;
}

/** Icon for a session source, matching the macOS app's SF Symbol choices. */
export function SourceIcon({ source, size = 14, className }: Props) {
  const cls = className ?? `${SOURCE_TEXT_CLASS[source]} shrink-0`;
  if (source === "cli") return <Terminal size={size} className={cls} />;
  if (source === "unified") return <GitMerge size={size} className={cls} />;
  return <MonitorDot size={size} className={cls} />;
}
