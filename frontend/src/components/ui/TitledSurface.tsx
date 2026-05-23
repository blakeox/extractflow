import type { HTMLAttributes, ReactNode } from "react";

import type { CardHeaderProps } from "./CardHeader";
import { CardHeader } from "./CardHeader";
import { Surface } from "./Surface";

type TitledSurfaceProps = CardHeaderProps & {
  as?: "aside" | "div" | "section";
  className?: string;
  children?: ReactNode;
  tone?: "default" | "strong" | "inset" | "translucent";
};

export function TitledSurface({
  as,
  className,
  children,
  subtitle,
  title,
  titleId,
  tone,
  ...props
}: TitledSurfaceProps &
  Omit<HTMLAttributes<HTMLElement>, keyof TitledSurfaceProps>) {
  return (
    <Surface as={as} className={className} tone={tone} {...props}>
      <CardHeader title={title} subtitle={subtitle} titleId={titleId} />
      {children}
    </Surface>
  );
}
