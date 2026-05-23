import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type StatusRowProps = HTMLAttributes<HTMLDivElement> & {
  complete: boolean;
  description: ReactNode;
  title: ReactNode;
};

export function StatusRow({
  className,
  complete,
  description,
  title,
  ...props
}: StatusRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[40px_minmax(0,1fr)] gap-[0.85rem] rounded-[18px] border px-4 py-[0.95rem]",
        complete
          ? "border-[rgba(31,159,103,0.16)] bg-[rgba(241,255,247,0.82)]"
          : "border-[rgba(208,70,86,0.14)] bg-[rgba(255,244,246,0.75)]",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "grid h-10 w-10 place-items-center rounded-[14px] font-bold",
          complete
            ? "bg-[rgba(31,159,103,0.12)] text-success"
            : "bg-[rgba(208,70,86,0.12)] text-danger",
        )}
        aria-hidden="true"
      >
        {complete ? "✓" : "!"}
      </div>
      <div>
        <strong className="block text-[0.95rem]">{title}</strong>
        <p className="mt-[0.35rem] text-[0.9rem] text-muted">{description}</p>
      </div>
    </div>
  );
}
