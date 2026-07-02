import { clsx } from "clsx";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}

/** A macOS-style toggle switch, matching the native app's `.switch` control. */
export function Toggle({ checked, onChange, label, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors duration-150 ease-in-out",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        checked ? "bg-[var(--accent)]" : "bg-[var(--bg-tertiary)] border border-[var(--border)]",
        className,
      )}
    >
      <span
        className={clsx(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150 ease-in-out",
          checked ? "translate-x-[14px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
