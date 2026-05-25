import { useEffect, useMemo } from "react";

import { formatStructuredDraftValue } from "../../lib/review-draft";
import { SupportingText } from "../ui/SupportingText";
import { TableDataCell, TableHeaderCell } from "../ui/TableCell";

type TableReviewEditorProps = {
  fieldLabel: string;
  draftValue: string;
  onChange: (value: string) => void;
  onValidationChange?: (error: string | null) => void;
};

type TableRow = Record<string, string>;

function parseTableDraft(raw: string): {
  rows: TableRow[];
  error: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { rows: [], error: null };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        rows: [],
        error: "Table value must be a JSON array of row objects.",
      };
    }
    const entries = parsed as unknown[];
    const rows = entries.map((entry, index): TableRow => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error(`Row ${index + 1} must be an object.`);
      }
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(record).map(([key, value]) => [
          key,
          String(value ?? ""),
        ]),
      );
    });
    return { rows, error: null };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Table value must be valid JSON.";
    return { rows: [], error: message };
  }
}

function serializeTableRows(rows: TableRow[]): string {
  return formatStructuredDraftValue(rows);
}

export function TableReviewEditor({
  fieldLabel,
  draftValue,
  onChange,
  onValidationChange,
}: TableReviewEditorProps) {
  const { rows, error } = useMemo(
    () => parseTableDraft(draftValue),
    [draftValue],
  );
  const columns = useMemo(
    () => [...new Set(rows.flatMap((row) => Object.keys(row)))],
    [rows],
  );

  useEffect(() => {
    onValidationChange?.(error);
  }, [error, onValidationChange]);

  function updateCell(rowIndex: number, column: string, value: string) {
    const nextRows = rows.map((row, index) =>
      index === rowIndex ? { ...row, [column]: value } : row,
    );
    onChange(serializeTableRows(nextRows));
  }

  function addRow() {
    const blankRow = Object.fromEntries(columns.map((column) => [column, ""]));
    onChange(serializeTableRows([...rows, blankRow]));
  }

  function addColumn() {
    const columnName = `column_${columns.length + 1}`;
    onChange(
      serializeTableRows(
        rows.length
          ? rows.map((row) => ({ ...row, [columnName]: "" }))
          : [{ [columnName]: "" }],
      ),
    );
  }

  return (
    <div className="grid gap-[0.45rem]">
      <div className="overflow-x-auto rounded-[14px] border border-[rgba(77,96,255,0.14)]">
        <table className="min-w-full border-collapse text-left text-[0.9rem]">
          <thead>
            <tr>
              {columns.map((column) => (
                <TableHeaderCell key={column}>{column}</TableHeaderCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {columns.map((column) => (
                  <TableDataCell key={`${rowIndex}-${column}`}>
                    <input
                      aria-label={`${fieldLabel} ${column} row ${rowIndex + 1}`}
                      className="w-full min-w-[7rem]"
                      value={row[column] ?? ""}
                      onChange={(event) =>
                        updateCell(rowIndex, column, event.target.value)
                      }
                    />
                  </TableDataCell>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-[0.85rem] underline"
          onClick={addRow}
        >
          Add row
        </button>
        <button
          type="button"
          className="text-[0.85rem] underline"
          onClick={addColumn}
        >
          Add column
        </button>
      </div>
      {error ? (
        <SupportingText as="span" size="sm" className="text-[#b42318]">
          {error}
        </SupportingText>
      ) : (
        <SupportingText as="span" size="sm">
          Edit table rows inline. Values are saved as a JSON array.
        </SupportingText>
      )}
    </div>
  );
}
