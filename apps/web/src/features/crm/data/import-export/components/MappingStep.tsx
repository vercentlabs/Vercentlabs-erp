"use client";

import {
  Button,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { LEAD_IMPORT_FIELDS } from "../types";
import type { LeadImportWizard } from "../hooks/useLeadImportWizard";

// Mapping step: match each Lead field to a column of the file.
export function MappingStep({
  fileName,
  rowCount,
  headers,
  mapping,
  setMapping,
  sampleFor,
  reset,
  setStep,
}: {
  fileName: string;
  rowCount: number;
  headers: string[];
  mapping: LeadImportWizard["mapping"];
  setMapping: LeadImportWizard["setMapping"];
  sampleFor: LeadImportWizard["sampleFor"];
  reset: LeadImportWizard["reset"];
  setStep: LeadImportWizard["setStep"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">{`${fileName}: ${rowCount} row${rowCount === 1 ? "" : "s"}. Match each lead field to a column in your file. First name is required.`}</p>
      <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
        <Table className="w-full text-sm">
          <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-secondary">
            <TableRow>
              <TableHeaderCell className="px-3 py-2">
                Lead field
              </TableHeaderCell>
              <TableHeaderCell className="px-3 py-2">
                Column in your file
              </TableHeaderCell>
              <TableHeaderCell className="px-3 py-2">
                Example from your file
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {LEAD_IMPORT_FIELDS.map((field) => (
              <TableRow key={field.target} className="border-t border-border">
                <TableCell className="px-3 py-2 font-medium text-text">
                  {field.label}
                  {field.required ? (
                    <span className="text-danger"> *</span>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Select
                    aria-label={`Column for ${field.label}`}
                    size="compact"
                    options={[
                      { value: "", label: "Do not import" },
                      ...headers.map((h) => ({ value: h, label: h })),
                    ]}
                    selectedKey={mapping[field.target] ?? ""}
                    onSelectionChange={(key) =>
                      setMapping((c) => ({
                        ...c,
                        [field.target]: String(key ?? ""),
                      }))
                    }
                  />
                </TableCell>
                <TableCell className="max-w-xs truncate px-3 py-2 text-text-muted">
                  {mapping[field.target]
                    ? sampleFor(mapping[field.target])
                    : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onPress={reset}>
          Start over
        </Button>
        <Button
          variant="primary"
          isDisabled={!mapping.firstName}
          onPress={() => setStep("duplicates")}
        >
          Continue
        </Button>
      </div>
      {!mapping.firstName && (
        <p className="text-xs text-text-muted">
          Map the First name column to continue.
        </p>
      )}
    </div>
  );
}
