import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const noteCardVariants = cva(
  "grid gap-2 rounded-[var(--ds-radius-lg)] border border-border bg-card shadow-sm",
  {
    variants: {
      density: {
        default: "p-4",
        compact: "gap-[0.35rem] px-4 py-[0.95rem]",
      },
      tone: {
        default: "",
        info: "border-[rgba(77,96,255,0.12)] bg-[rgba(246,248,255,0.96)] shadow-none",
      },
    },
    defaultVariants: {
      density: "default",
      tone: "default",
    },
  },
);

export type NoteCardProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof noteCardVariants>;

export function NoteCard({
  className,
  density,
  tone,
  ...props
}: NoteCardProps) {
  return (
    <div
      className={cn(noteCardVariants({ density, tone }), className)}
      {...props}
    />
  );
}
