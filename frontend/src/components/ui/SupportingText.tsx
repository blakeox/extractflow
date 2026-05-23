import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "../../lib/cn";

type SupportingTextOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
} & VariantProps<typeof supportingTextVariants>;

const supportingTextVariants = cva("text-muted", {
  variants: {
    size: {
      default: "mt-[0.35rem] text-[0.9rem]",
      sm: "mt-0 text-[0.86rem]",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

type SupportingTextProps<T extends ElementType> = SupportingTextOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof SupportingTextOwnProps<T>>;

export function SupportingText<T extends ElementType = "p">({
  as,
  className,
  size,
  ...props
}: SupportingTextProps<T>) {
  const Component = as ?? "p";

  return (
    <Component
      className={cn(supportingTextVariants({ size }), className)}
      {...props}
    />
  );
}
