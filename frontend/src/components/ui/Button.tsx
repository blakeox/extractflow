import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-semibold transition-[transform,box-shadow,background,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ds-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary:
          "min-h-11 rounded-[var(--ds-radius-md)] border-transparent bg-linear-to-br from-brand to-brand-strong px-4 py-3 text-white shadow-[var(--ds-shadow-primary)] hover:-translate-y-px",
        secondary:
          "min-h-11 rounded-[var(--ds-radius-md)] border-border bg-white px-4 py-3 text-ink shadow-sm hover:-translate-y-px",
        tertiary:
          "min-h-11 rounded-[var(--ds-radius-md)] border-transparent bg-transparent px-4 py-3 text-brand-strong shadow-none hover:bg-brand-soft hover:-translate-y-px",
        text: "min-h-0 rounded-none border-transparent bg-transparent px-0 py-0 text-brand-strong shadow-none hover:text-brand",
        danger:
          "min-h-11 rounded-[var(--ds-radius-md)] border-[rgba(180,35,24,0.16)] bg-[rgba(254,242,242,0.92)] px-4 py-3 text-danger-ink shadow-none hover:bg-[rgba(254,226,226,0.98)] hover:-translate-y-px",
      },
      size: {
        md: "",
        sm: "min-h-[38px] px-3.5 py-2.5 text-sm",
        icon: "size-11 rounded-[var(--ds-radius-md)] p-0",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
      fullWidth: false,
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    fullWidth?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  fullWidth,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    />
  );
}
