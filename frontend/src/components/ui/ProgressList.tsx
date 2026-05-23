import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type ProgressListItem = {
  complete: boolean;
  key?: string;
  label: ReactNode;
};

type ProgressListProps = HTMLAttributes<HTMLDivElement> & {
  steps: ProgressListItem[];
};

export function ProgressList({
  className,
  steps,
  ...props
}: ProgressListProps) {
  return (
    <div className={cn("grid gap-[0.8rem]", className)} {...props}>
      {steps.map((step, index) => (
        <div
          key={
            step.key ?? (typeof step.label === "string" ? step.label : index)
          }
          className={cn(
            "grid items-center gap-[0.7rem] rounded-[16px] border px-[0.85rem] py-[0.75rem] text-[0.92rem] [grid-template-columns:18px_minmax(0,1fr)]",
            step.complete
              ? "border-[rgba(31,159,103,0.18)] bg-[rgba(241,255,247,0.95)]"
              : "border-[rgba(122,138,179,0.14)] bg-[rgba(255,255,255,0.92)]",
          )}
        >
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              step.complete
                ? "bg-[var(--success)]"
                : "bg-[rgba(122,138,179,0.28)]",
            )}
            aria-hidden="true"
          />
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  );
}
