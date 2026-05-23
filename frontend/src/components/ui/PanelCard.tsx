import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "../../lib/cn";

type PanelCardOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
} & VariantProps<typeof panelCardVariants>;

const panelCardVariants = cva(
  "grid rounded-[18px] px-[1.05rem] py-4 shadow-sm",
  {
    variants: {
      spacing: {
        compact: "gap-[0.55rem]",
        cozy: "gap-[0.75rem]",
        relaxed: "gap-[0.85rem]",
        roomy: "gap-[0.9rem]",
        spacious: "gap-4",
      },
      tone: {
        default: "border border-[rgba(122,138,179,0.16)]",
        gradient:
          "border border-[rgba(122,138,179,0.16)] bg-[linear-gradient(180deg,rgba(246,248,255,0.96),rgba(255,255,255,0.95))]",
        info: "border border-[rgba(77,96,255,0.12)] bg-[rgba(246,248,255,0.96)]",
        panel: "border border-border bg-panel",
        plain:
          "border border-[rgba(122,138,179,0.16)] bg-[rgba(255,255,255,0.9)]",
        soft: "border border-[rgba(122,138,179,0.16)] bg-[rgba(248,250,255,0.9)]",
        subtle: "border border-subtle bg-[rgba(255,255,255,0.82)]",
      },
    },
    defaultVariants: {
      spacing: undefined,
      tone: "default",
    },
  },
);

type PanelCardProps<T extends ElementType> = PanelCardOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof PanelCardOwnProps<T>>;

export function PanelCard<T extends ElementType = "div">({
  as,
  className,
  spacing,
  tone,
  ...props
}: PanelCardProps<T>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(panelCardVariants({ spacing, tone }), className)}
      {...props}
    />
  );
}
