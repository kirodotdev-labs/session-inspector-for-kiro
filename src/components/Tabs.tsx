import { LayoutDashboard, List, Boxes, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import type { View } from "../App";

interface Props {
  view: View;
  onViewChange: (view: View) => void;
}

const TABS: { view: View; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "analyze", label: "Analyze", icon: Sparkles },
  { view: "workspaces", label: "Workspaces", icon: Boxes },
  { view: "sessions", label: "Sessions", icon: List },
];

/** Primary view navigation, shown as a top bar in the main panel. */
export function Tabs({ view, onViewChange }: Props) {
  return (
    <div className="flex border-b border-[var(--border)] bg-[var(--bg-secondary)] px-2">
      {TABS.map(({ view: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onViewChange(v)}
          className={clsx(
            "flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
            view === v
              ? "text-[var(--accent)] border-[var(--accent)]"
              : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]",
          )}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
