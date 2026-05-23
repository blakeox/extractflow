import { cn } from "../../lib/cn";

type ProviderModeBadgeProps = {
  className?: string;
  mode: "cloud" | "local";
};

export function ProviderModeBadge({ className, mode }: ProviderModeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-[0.62rem] py-[0.25rem] text-xs font-bold",
        mode === "local"
          ? "bg-[rgba(31,159,103,0.12)] text-[var(--success)]"
          : "bg-[rgba(var(--accent-rgb),0.12)] text-brand-strong",
        className,
      )}
    >
      {mode === "local" ? "Local" : "Cloud"}
    </span>
  );
}
