import type { ComponentProps, HTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import { Surface } from "./Surface";

export type PageStackProps = HTMLAttributes<HTMLDivElement>;

export function PageStack({ className, ...props }: PageStackProps) {
  return <div className={cn("grid gap-[1.3rem]", className)} {...props} />;
}

export type PageIntroProps = ComponentProps<typeof Surface>;

export function PageIntro({ className, ...props }: PageIntroProps) {
  return (
    <Surface
      as="section"
      className={cn("p-[1.5rem_1.6rem]", className)}
      {...props}
    />
  );
}
