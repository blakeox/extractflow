import { Button } from "./ui/Button";
import { InlineGroup } from "./ui/InlineGroup";

type MockProviderProductionNoticeProps = {
  onDismiss: () => void;
  onOpenSettings: () => void;
};

export function MockProviderProductionNotice({
  onDismiss,
  onOpenSettings,
}: MockProviderProductionNoticeProps) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[rgba(214,158,0,0.28)] bg-[rgba(255,249,235,0.98)] px-4 py-[0.9rem]"
      role="alert"
      aria-live="assertive"
    >
      <span>
        <strong className="font-semibold text-[#8a5a00]">
          Bootstrap mock extractor is active.
        </strong>{" "}
        It is for local workflow demos only—not production extraction quality.
        Configure Ollama, LangExtract, or another real provider before company
        use.
      </span>
      <InlineGroup>
        <Button variant="secondary" size="sm" onClick={onOpenSettings}>
          Open settings
        </Button>
        <Button variant="text" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </InlineGroup>
    </div>
  );
}
