import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const summaryGridVariants = cva("grid max-[820px]:grid-cols-1", {
  variants: {
    columns: {
      two: "[grid-template-columns:repeat(2,minmax(0,1fr))]",
      four: "[grid-template-columns:repeat(4,minmax(0,1fr))] max-[1280px]:[grid-template-columns:repeat(2,minmax(0,1fr))]",
    },
    gap: {
      md: "gap-[0.8rem]",
      lg: "gap-[0.85rem]",
    },
  },
  defaultVariants: {
    columns: "two",
    gap: "md",
  },
});

export type SummaryGridProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof summaryGridVariants>;

export function SummaryGrid({
  className,
  columns,
  gap,
  ...props
}: SummaryGridProps) {
  return (
    <div
      className={cn(summaryGridVariants({ columns, gap }), className)}
      {...props}
    />
  );
}
