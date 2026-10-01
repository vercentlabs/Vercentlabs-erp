"use client";

import type { ReactNode } from "react";
import { Button } from "@vercentlabs/design-system";
import { LEAD_IMPORT_FIELDS } from "../types";
import { csvEscape, download } from "./csv-download";
import type { LeadImportWizard } from "../hooks/useLeadImportWizard";

// Upload step: drop or choose a CSV, or download a blank template. The
// import history renders below it (children).
export function UploadStep({
  fileInputRef,
  dragging,
  setDragging,
  handleFile,
  children,
}: {
  fileInputRef: LeadImportWizard["fileInputRef"];
  dragging: boolean;
  setDragging: LeadImportWizard["setDragging"];
  handleFile: LeadImportWizard["handleFile"];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={`flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center ${dragging ? "border-brand bg-brand-soft" : "border-border-strong"}`}
      >
        <p className="text-sm font-medium text-text">Drop a CSV file here</p>
        <p className="text-xs text-text-muted">
          The first row must be column names. Up to 50,000 rows (20 MB); large
          files import in the background.
        </p>
        <input
          ref={fileInputRef}
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <label
          htmlFor="import-file"
          className="inline-flex min-h-10 cursor-pointer items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover focus-within:ring-2 focus-within:ring-brand"
        >
          Choose a file
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
        <span>Not sure of the layout?</span>
        <Button
          variant="ghost"
          size="compact"
          onPress={() =>
            download(
              "lead-import-template.csv",
              LEAD_IMPORT_FIELDS.map((f) => csvEscape(f.label)).join(",") +
                "\n",
            )
          }
        >
          Download a blank template
        </Button>
      </div>

      {children}
    </div>
  );
}
