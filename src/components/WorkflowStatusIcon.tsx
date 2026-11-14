import { Check, Circle, CircleSlash, LoaderCircle, X } from "lucide-react";
import { clsx } from "clsx";
import { isCompleted } from "../lib/workflow";

function StatusGlyph({ status, size }: { status: string | null; size: number }) {
  if (isCompleted(status)) return <Check size={size} className="text-emerald-400" />;
  switch (status) {
    case "running":
    case "in_progress":
      return <LoaderCircle size={size} className="animate-spin text-violet-300" />;
    case "failed":
    case "error":
      return <X size={size} className="text-red-400" />;
    case "cancelled":
    case "canceled":
    case "stopped":
    case "aborted":
    case "skipped":
      return <CircleSlash size={size} className="text-[var(--text-secondary)]" />;
    default:
      return (
        <Circle size={Math.max(size - 3, 6)} className="text-[var(--text-secondary)] opacity-70" />
      );
  }
}

/** Icon for a workflow run's or step's Kiro status, in a fixed-size box so
 * rows line up whatever the glyph. */
export function WorkflowStatusIcon({
  status,
  size = 12,
  className,
}: {
  status: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={clsx("inline-flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size }}
      title={status ?? undefined}
    >
      <StatusGlyph status={status} size={size} />
    </span>
  );
}
