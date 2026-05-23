import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { MetricLabel } from "./MetricLabel";

const detailTileVariants = cva("rounded-[16px] px-[0.9rem] py-[0.85rem]", {
  variants: {
    tone: {
      muted: "bg-muted",
      subtle: "border border-subtle bg-[rgba(255,255,255,0.78)]",
      plain:
        "border border-[rgba(122,138,179,0.16)] bg-[rgba(255,255,255,0.92)]",
      accent:
        "border border-[rgba(var(--accent-rgb),0.18)] bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.05),rgba(255,255,255,0.9))]",
    },
  },
  defaultVariants: {
    tone: "muted",
  },
});

type DetailTileProps = {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  valueClassName?: string;
} & VariantProps<typeof detailTileVariants>;

export function DetailTile({
  label,
  value,
  className,
  tone,
  valueClassName,
}: DetailTileProps) {
  return (
    <div className={cn(detailTileVariants({ tone }), className)}>
      <MetricLabel>{label}</MetricLabel>
      <strong className={cn("mt-[0.28rem] block", valueClassName)}>
        {value}
      </strong>
    </div>
  );
}
