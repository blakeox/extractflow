import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const inlineGroupVariants = cva("flex flex-wrap items-center", {
  variants: {
    spacing: {
      default: "gap-[0.55rem]",
      relaxed: "gap-[0.65rem]",
      roomy: "gap-[0.7rem]",
    },
  },
  defaultVariants: {
    spacing: "default",
  },
});

type InlineGroupProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof inlineGroupVariants>;

export function InlineGroup({
  className,
  spacing,
  ...props
}: InlineGroupProps) {
  return (
    <div
      className={cn(inlineGroupVariants({ spacing }), className)}
      {...props}
    />
  );
}
