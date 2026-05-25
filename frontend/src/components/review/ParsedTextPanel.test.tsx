import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ParsedTextPanel } from "./ParsedTextPanel";

describe("ParsedTextPanel", () => {
  it("loads parsed text and highlights the focused field range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          document_id: 42,
          text: "Invoice Vendor: Acme Company",
          source: "parser",
        }),
      }),
    );

    render(
      <ParsedTextPanel
        documentId={42}
        focusedField={{
          label: "Vendor Name",
          char_start: 16,
          char_end: 28,
          page_number: 1,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Acme Company")).toBeInTheDocument();
    });

    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(
      screen.getByText("Highlighting source range for Vendor Name."),
    ).toBeInTheDocument();
  });

  it("shows an error when parsed text is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    );

    render(<ParsedTextPanel documentId={99} focusedField={null} />);

    await waitFor(() => {
      expect(
        screen.getByText("Parsed document text is not available yet."),
      ).toBeInTheDocument();
    });
  });
});
