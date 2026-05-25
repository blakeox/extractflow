import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE } from "../../lib/config";
import { SupportingText } from "../ui/SupportingText";

type ParsedTextField = {
  label: string;
  char_start?: number | null;
  char_end?: number | null;
  page_number?: number | null;
};

type ParsedTextPanelProps = {
  documentId: number | null;
  focusedField: ParsedTextField | null;
};

type ParsedTextResponse = {
  document_id: number;
  text: string;
  source: string;
};

export function ParsedTextPanel({
  documentId,
  focusedField,
}: ParsedTextPanelProps) {
  const highlightRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<ParsedTextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setState(null);
      setError(null);
      return;
    }

    let cancelled = false;
    async function loadParsedText() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${API_BASE}/documents/${documentId}/parsed-text`,
        );
        if (!response.ok) {
          throw new Error("Parsed document text is not available yet.");
        }
        const payload = (await response.json()) as ParsedTextResponse;
        if (!cancelled) {
          setState(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setState(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load parsed document text.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadParsedText();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (typeof highlightRef.current?.scrollIntoView === "function") {
      highlightRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [focusedField?.char_start, focusedField?.char_end, state?.text]);

  const segments = useMemo(() => {
    const text = state?.text ?? "";
    const start = focusedField?.char_start;
    const end = focusedField?.char_end;
    if (
      !text ||
      start == null ||
      end == null ||
      start < 0 ||
      end <= start ||
      end > text.length
    ) {
      return [{ text, highlighted: false }];
    }
    return [
      { text: text.slice(0, start), highlighted: false },
      { text: text.slice(start, end), highlighted: true },
      { text: text.slice(end), highlighted: false },
    ].filter((segment) => segment.text.length > 0);
  }, [focusedField?.char_end, focusedField?.char_start, state?.text]);

  return (
    <div className="grid gap-[0.45rem]">
      <div className="flex items-center justify-between gap-3">
        <strong>Parsed document</strong>
        {focusedField?.page_number ? (
          <SupportingText as="span" size="sm">
            Page {focusedField.page_number}
          </SupportingText>
        ) : null}
      </div>
      {loading ? (
        <SupportingText as="p" size="sm">
          Loading parsed text…
        </SupportingText>
      ) : null}
      {error ? (
        <SupportingText as="p" size="sm" className="text-muted">
          {error}
        </SupportingText>
      ) : null}
      {state?.text ? (
        <pre className="max-h-[18rem] overflow-auto rounded-[14px] border border-[rgba(77,96,255,0.14)] bg-[rgba(247,248,255,0.98)] p-3 text-[0.82rem] leading-relaxed whitespace-pre-wrap">
          {segments.map((segment, index) =>
            segment.highlighted ? (
              <mark
                key={`highlight-${index}`}
                ref={highlightRef}
                className="rounded-[4px] bg-[rgba(77,96,255,0.18)] px-0.5"
              >
                {segment.text}
              </mark>
            ) : (
              <span key={`text-${index}`}>{segment.text}</span>
            ),
          )}
        </pre>
      ) : null}
      {focusedField ? (
        <SupportingText as="p" size="sm">
          Highlighting source range for {focusedField.label}.
        </SupportingText>
      ) : (
        <SupportingText as="p" size="sm">
          Select a field to highlight its citation range in the parsed document.
        </SupportingText>
      )}
    </div>
  );
}
