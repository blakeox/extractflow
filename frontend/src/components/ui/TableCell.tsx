import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

type TableHeaderCellProps = ComponentPropsWithoutRef<"th">;

export function TableHeaderCell({
  className,
  scope = "col",
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "sticky top-0 z-[1] border-b border-subtle bg-white px-4 py-[0.95rem] text-left text-[0.92rem] font-semibold whitespace-nowrap text-muted",
        className,
      )}
      {...props}
    />
  );
}

type TableDataCellProps = ComponentPropsWithoutRef<"td">;

export function TableDataCell({ className, ...props }: TableDataCellProps) {
  return (
    <td
      className={cn(
        "border-b border-subtle px-4 py-[0.95rem] text-left text-[0.92rem] text-default",
        className,
      )}
      {...props}
    />
  );
}
