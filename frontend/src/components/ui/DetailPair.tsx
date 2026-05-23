import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

const detailPairLabelVariants = cva("", {
  variants: {
    labelTone: {
      default: "",
      muted: "text-[0.86rem] text-muted",
    },
  },
  defaultVariants: {
    labelTone: "default",
  },
});

type DetailPairProps = {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
} & VariantProps<typeof detailPairLabelVariants>;

export function DetailPair({
  label,
  value,
  className,
  labelTone,
  labelClassName,
  valueClassName,
}: DetailPairProps) {
  return (
    <div className={cn("grid gap-[0.16rem]", className)}>
      <span
        className={cn(detailPairLabelVariants({ labelTone }), labelClassName)}
      >
        {label}
      </span>
      <strong className={cn("block break-words", valueClassName)}>
        {value}
      </strong>
    </div>
  );
}
