import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type ChecklistProps = HTMLAttributes<HTMLUListElement>;

export function Checklist({ className, ...props }: ChecklistProps) {
  return (
    <ul
      className={cn("grid gap-[0.45rem] pl-[1.1rem] text-[0.92rem]", className)}
      {...props}
    />
  );
}
