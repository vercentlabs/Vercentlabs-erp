"use client";

// One layout for every CRM report: Group by and three or four key filters in a row, a "More filters" button for the rest (with how many of
// them are set), and Export of the table as shown.
import { useState, type ReactNode } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import { Button } from "@vercentlabs/design-system";

export function ReportToolbar({ primary, more, moreActive = 0, onExport }: { primary: ReactNode; more?: ReactNode; moreActive?: number; onExport?: () => void }) {
  const [open, setOpen] = useState(moreActive > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{primary}</div>
        <div className="flex gap-2">
          {more && (
            <Button variant="outline" aria-expanded={open} onPress={() => setOpen((value) => !value)}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />More filters{moreActive ? ` (${moreActive})` : ""}
            </Button>
          )}
          {onExport && <Button variant="outline" onPress={onExport}><Download className="size-4" aria-hidden="true" />Export</Button>}
        </div>
      </div>
      {more && open && <div className="grid gap-3 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3 sm:grid-cols-2 lg:grid-cols-4">{more}</div>}
    </div>
  );
}

// The table as shown, as a CSV download (formula-safe).
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    const raw = value === null || value === undefined ? "" : String(value);
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r]/.test(safe) || safe !== raw ? `"${safe.replace(/"/g, "\"\"")}"` : safe;
  };
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
