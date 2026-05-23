import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export type FormGridProps = HTMLAttributes<HTMLDivElement>;

export function FormGrid({ className, ...props }: FormGridProps) {
  return (
    <div
      className={cn(
        "grid gap-[0.95rem] [grid-template-columns:repeat(2,minmax(0,1fr))] max-[820px]:grid-cols-1 [&_label]:grid [&_label]:gap-[0.45rem] [&_label>span]:text-[0.88rem] [&_label>span]:font-semibold [&_label>span]:text-muted",
        className,
      )}
      {...props}
    />
  );
}
