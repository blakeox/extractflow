import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "../../lib/cn";

const surfaceVariants = cva(
  "rounded-[var(--ds-radius-xl)] border border-border bg-panel p-5 shadow-md backdrop-blur-[14px]",
  {
    variants: {
      tone: {
        default: "",
        strong: "bg-white",
        inset: "bg-inset shadow-none",
        translucent: "bg-[rgba(255,255,255,0.72)] shadow-none",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

type SurfaceOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
} & VariantProps<typeof surfaceVariants>;

export type SurfaceProps<T extends ElementType> = SurfaceOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>;

export function Surface<T extends ElementType = "div">({
  as,
  className,
  tone,
  ...props
}: SurfaceProps<T>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(surfaceVariants({ tone }), className)}
      {...props}
    />
  );
}
