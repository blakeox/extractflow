import { useEffect, useState } from "react";

import { validateJsonDraft } from "../../lib/review-draft";
import { SupportingText } from "../ui/SupportingText";

type JsonObjectReviewEditorProps = {
  fieldLabel: string;
  draftValue: string;
  onChange: (value: string) => void;
  onValidationChange?: (error: string | null) => void;
};

export function JsonObjectReviewEditor({
  fieldLabel,
  draftValue,
  onChange,
  onValidationChange,
}: JsonObjectReviewEditorProps) {
  const [error, setError] = useState<string | null>(() =>
    validateJsonDraft(draftValue),
  );

  useEffect(() => {
    onValidationChange?.(error);
  }, [error, onValidationChange]);

  function handleBlur() {
    setError(validateJsonDraft(draftValue));
  }

  return (
    <div className="grid gap-[0.35rem]">
      <textarea
        aria-label={`${fieldLabel} review value`}
        aria-invalid={error ? true : undefined}
        className="min-h-[9rem] font-mono text-[0.88rem] leading-relaxed"
        rows={8}
        spellCheck={false}
        value={draftValue}
        onBlur={handleBlur}
        onChange={(event) => {
          onChange(event.target.value);
          if (error) {
            setError(validateJsonDraft(event.target.value));
          }
        }}
      />
      {error ? (
        <SupportingText as="span" size="sm" className="text-[#b42318]">
          {error}
        </SupportingText>
      ) : (
        <SupportingText as="span" size="sm">
          Edit JSON directly. Invalid JSON cannot be saved.
        </SupportingText>
      )}
    </div>
  );
}
