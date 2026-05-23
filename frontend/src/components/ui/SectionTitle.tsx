import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "../../lib/cn";

type SectionTitleOwnProps<T extends ElementType> = {
  as?: T;
  className?: string;
};

type SectionTitleProps<T extends ElementType> = SectionTitleOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof SectionTitleOwnProps<T>>;

export function SectionTitle<T extends ElementType = "h3">({
  as,
  className,
  ...props
}: SectionTitleProps<T>) {
  const Component = as ?? "h3";

  return (
    <Component className={cn("m-0 tracking-[-0.02em]", className)} {...props} />
  );
}
