import { Badge } from "../ui/Badge";
import { InlineGroup } from "../ui/InlineGroup";
import { NoteCard } from "../ui/NoteCard";

type SourceField = {
  label: string;
  source_text?: string;
  page_number?: number | null;
  location_reference?: string;
  char_start?: number | null;
  char_end?: number | null;
  confidence_score?: number;
};

function formatConfidence(score?: number) {
  return score == null ? "—" : `${Math.round(score * 100)}%`;
}

function formatCharInterval(
  field: Pick<SourceField, "char_start" | "char_end">,
) {
  return field.char_start != null && field.char_end != null
    ? `Chars ${field.char_start}-${field.char_end}`
    : "Chars —";
}

export function SourceEvidencePanel({ field }: { field: SourceField }) {
  const snippet = field.source_text?.trim();

  return (
    <NoteCard>
      <strong>{field.label}</strong>
      {snippet ? (
        <p className="mt-[0.55rem] rounded-[14px] border border-[rgba(77,96,255,0.18)] bg-[rgba(247,248,255,0.98)] px-3 py-2 text-[0.95rem] leading-relaxed">
          <mark className="rounded-[6px] bg-[rgba(77,96,255,0.14)] px-1 py-0.5 text-inherit">
            {snippet}
          </mark>
        </p>
      ) : (
        <p className="mt-[0.45rem] text-muted">
          No citation snippet returned for this field.
        </p>
      )}
      <InlineGroup className="mt-4">
        <Badge tone="indigo">
          {field.page_number ? `Page ${field.page_number}` : "Page —"}
        </Badge>
        <Badge tone="indigo">
          {field.location_reference || "Unknown location"}
        </Badge>
        <Badge tone="indigo">{formatCharInterval(field)}</Badge>
        <Badge tone="indigo">
          Confidence {formatConfidence(field.confidence_score)}
        </Badge>
      </InlineGroup>
    </NoteCard>
  );
}
