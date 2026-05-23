import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { StepMarker } from "./StepMarker";

const stepCardVariants = cva(
  "grid gap-[0.85rem] rounded-[18px] px-4 py-[0.95rem] [grid-template-columns:42px_minmax(0,1fr)]",
  {
    variants: {
      tone: {
        accent:
          "border border-[rgba(var(--accent-rgb),0.2)] bg-[rgba(var(--accent-rgb),0.06)]",
        default: "border border-subtle bg-[rgba(255,255,255,0.82)]",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

type StepCardOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
  description: ReactNode;
  step: ReactNode;
  title: ReactNode;
} & VariantProps<typeof stepCardVariants>;

type StepCardProps<T extends ElementType> = StepCardOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof StepCardOwnProps<T>>;

export function StepCard<T extends ElementType = "div">({
  as,
  className,
  description,
  step,
  title,
  tone,
  ...props
}: StepCardProps<T>) {
  const Component = as ?? "div";

  return (
    <Component className={cn(stepCardVariants({ tone }), className)} {...props}>
      <StepMarker as="span" aria-hidden="true">
        {step}
      </StepMarker>
      <div>
        <strong className="block">{title}</strong>
        <p className="mt-[0.45rem] text-[0.9rem] text-muted">{description}</p>
      </div>
    </Component>
  );
}
