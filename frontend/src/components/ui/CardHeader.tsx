export type CardHeaderProps = {
  title: string;
  subtitle?: string;
  titleId?: string;
};

export function CardHeader({ title, subtitle, titleId }: CardHeaderProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="grid min-w-0 gap-2">
        <h2
          id={titleId}
          className="m-0 text-[1.1rem] tracking-[-0.03em] text-ink"
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="m-0 text-[0.98rem] text-muted">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
