import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export type MetricLabelProps = HTMLAttributes<HTMLSpanElement>;

export function MetricLabel({ className, ...props }: MetricLabelProps) {
  return (
    <span
      className={cn(
        "text-[var(--text-xs)] font-bold uppercase tracking-[0.05em] text-muted",
        className,
      )}
      {...props}
    />
  );
}
