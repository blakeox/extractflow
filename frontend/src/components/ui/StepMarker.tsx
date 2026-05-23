import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "../../lib/cn";

type StepMarkerOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
};

type StepMarkerProps<T extends ElementType> = StepMarkerOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof StepMarkerOwnProps<T>>;

export function StepMarker<T extends ElementType = "div">({
  as,
  className,
  ...props
}: StepMarkerProps<T>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(
        "grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-[rgba(var(--accent-rgb),0.1)] text-[0.95rem] font-bold text-brand-strong",
        className,
      )}
      {...props}
    />
  );
}
