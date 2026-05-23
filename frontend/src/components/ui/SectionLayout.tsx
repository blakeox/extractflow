import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export function SectionStack({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={cn("grid gap-[0.9rem]", className)} {...props} />;
}

export function SectionHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid items-start gap-[0.9rem] [grid-template-columns:minmax(0,1fr)_auto] max-[820px]:grid-cols-1",
        className,
      )}
      {...props}
    />
  );
}
