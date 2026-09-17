"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, PageHeader, Select, StatusBadge, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { parseCsv, rowsToObjects } from "../csv";
import {
  commitLeadImportRequest,
  getLeadExportJobRequest,
  ImportExportApiError,
  leadExportDownloadUrl,
  previewLeadImportRequest,
  rollbackLeadImportRequest,
  startLeadExportRequest,
} from "../api/import-export-api";
import { LEAD_IMPORT_FIELDS, type LeadImportPreviewResult } from "../types";

const DUPLICATE_STRATEGY_OPTIONS: SelectOption[] = [
  { value: "skip", label: "Skip duplicates" },
  { value: "update", label: "Update existing" },
  { value: "warn", label: "Import anyway (flagged)" },
  { value: "block", label: "Block the whole row" },
];

type Step = "upload" | "map" | "preview" | "done";

// F021 Import/Export. Import is a real 2-stage workflow against
// lead-acquisition.js's own previewLeadImport/commitLeadImport/
// rollbackLeadImport (nothing is written to crm_leads until commit, and
// a committed batch can be rolled back). Export is a real async,
// server-side job (tenant.background_jobs, job_type='crm.leads.export')
// — see lead-export.js. Replaces the prior client-side "fetch every page
// then build CSV in the browser" approach, which used a local CSV writer
// with no formula-injection protection at all (a real, now-fixed gap;
// see the register's Stage A2 §9 entry).
export function CrmImportExportScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState("skip");
  const [preview, setPreview] = useState<LeadImportPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  function handleFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = parseCsv(text);
      const { headers: parsedHeaders, records: parsedRecords } = rowsToObjects(parsed);
      setFileName(file.name);
      setHeaders(parsedHeaders);
      setRecords(parsedRecords);
      const autoMapping: Record<string, string> = {};
      for (const field of LEAD_IMPORT_FIELDS) {
        const match = parsedHeaders.find((header) => header.toLowerCase().replace(/[^a-z0-9]/g, "") === field.target.toLowerCase());
        if (match) autoMapping[field.target] = match;
      }
      setMapping(autoMapping);
      setStep("map");
    };
    reader.readAsText(file);
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      previewLeadImportRequest({
        rows: records,
        fieldMapping: mapping,
        fileName,
        duplicateStrategy,
      }),
    onSuccess: (result) => {
      setPreview(result);
      setStep("preview");
      setError(null);
    },
    onError: (err) => setError(err instanceof ImportExportApiError ? err.message : "Preview failed."),
  });

  const commitMutation = useMutation({
    mutationFn: () => commitLeadImportRequest(preview!.batch.id),
    onSuccess: ({ batch }) => {
      setPreview((current) => (current ? { ...current, batch } : current));
      setStep("done");
      setError(null);
    },
    onError: (err) => setError(err instanceof ImportExportApiError ? err.message : "Commit failed."),
  });

  const rollbackMutation = useMutation({
    mutationFn: () => rollbackLeadImportRequest(preview!.batch.id),
    onSuccess: (result) => {
      setError(null);
      setStep("upload");
      setPreview(null);
      setRecords([]);
      setHeaders([]);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.alert(`Rolled back ${result.rolledBack} lead(s). ${result.protected} were protected because they already have recorded activity.`);
    },
    onError: (err) => setError(err instanceof ImportExportApiError ? err.message : "Rollback failed."),
  });

  const invalidRows = useMemo(() => preview?.rows.filter((row) => !row.valid) ?? [], [preview]);

  const exportStartMutation = useMutation({
    mutationFn: () => startLeadExportRequest({}),
    onSuccess: ({ job }) => {
      setExportJobId(job.id);
      setExportError(null);
    },
    onError: (err) => setExportError(err instanceof ImportExportApiError ? err.message : "Could not start the export."),
  });

  const exportJobQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "export", exportJobId ?? ""),
    queryFn: () => getLeadExportJobRequest(exportJobId!),
    enabled: Boolean(exportJobId),
    refetchInterval: (query) => (["pending", "processing"].includes(query.state.data?.job.status ?? "") ? 2000 : false),
  });
  const exportJob = exportJobQuery.data?.job;
  const exportFailureMessage = exportJob?.status === "dead" ? exportJob.lastError || "The export failed." : null;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Import & Export" description="Bring Leads in from a CSV file, or export what you can see." />
        <p className="text-sm text-text-muted">Ask an administrator to grant crm.leads.manage.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Import & Export" description="Bring Leads in from a CSV file, or export what you can see." />

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Export leads</h2>
        <p className="text-sm text-text-muted">Exports every Lead you have access to (up to 10,000 rows) as a CSV file. Runs as a background job — this page will show a download link when it&apos;s ready.</p>
        {(exportError || exportFailureMessage) && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {exportError || exportFailureMessage}
          </p>
        )}
        {!exportJobId || (exportJob && ["completed", "dead", "cancelled"].includes(exportJob.status)) ? (
          <div>
            <Button
              variant="secondary"
              onPress={() => {
                setExportJobId(null);
                exportStartMutation.mutate();
              }}
              isLoading={exportStartMutation.isPending}
            >
              Start export
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <StatusBadge tone="info">{exportJob?.status ?? "starting"}</StatusBadge>
            <span className="text-sm text-text-muted">Generating your export…</span>
          </div>
        )}
        {exportJob?.status === "completed" && (
          <div className="flex items-center gap-3 text-sm text-text">
            <span>{exportJob.manifest.rowCount ?? 0} row(s) ready{exportJob.manifest.truncated ? " (truncated at 10,000)" : ""}.</span>
            <a href={leadExportDownloadUrl(exportJobId!)} className="font-medium text-accent underline">
              Download CSV
            </a>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Import leads</h2>

        {step === "upload" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-muted">Choose a CSV file with a header row. Up to 5,000 rows.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="text-sm text-text"
            />
          </div>
        )}

        {step === "map" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">{fileName} · {records.length} row(s). Map your columns to Lead fields.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LEAD_IMPORT_FIELDS.map((field) => (
                <Select
                  key={field.target}
                  label={`${field.label}${field.required ? " (required)" : ""}`}
                  options={[{ value: "", label: "— not mapped —" }, ...headers.map((header) => ({ value: header, label: header }))]}
                  selectedKey={mapping[field.target] ?? ""}
                  onSelectionChange={(key) => setMapping((current) => ({ ...current, [field.target]: String(key ?? "") }))}
                />
              ))}
            </div>
            <Select label="If a duplicate is found" options={DUPLICATE_STRATEGY_OPTIONS} selectedKey={duplicateStrategy} onSelectionChange={(key) => setDuplicateStrategy(String(key ?? "skip"))} />
            <div className="flex gap-2">
              <Button variant="secondary" onPress={() => setStep("upload")}>Back</Button>
              <Button variant="primary" onPress={() => previewMutation.mutate()} isLoading={previewMutation.isPending} isDisabled={!mapping.firstName}>
                Preview import
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 text-sm text-text">
              <span>Total rows: <strong>{preview.batch.total_rows}</strong></span>
              <span className="text-success">Valid: <strong>{preview.batch.valid_rows}</strong></span>
              <span className="text-danger">Invalid: <strong>{preview.batch.invalid_rows}</strong></span>
              {preview.idempotent && <StatusBadge tone="warning">Matches a previous preview</StatusBadge>}
            </div>
            {invalidRows.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-text">Rows that will be skipped</p>
                <div className="max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-text-muted">
                        <th className="px-2 py-1 font-medium">Row</th>
                        <th className="px-2 py-1 font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invalidRows.map((row) => (
                        <tr key={row.rowNumber} className="border-b border-border last:border-0">
                          <td className="px-2 py-1 tabular-nums">{row.rowNumber}</td>
                          <td className="px-2 py-1 text-danger">{row.errors.map((e) => e.message).join("; ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onPress={() => setStep("map")}>Back</Button>
              <Button variant="primary" onPress={() => commitMutation.mutate()} isLoading={commitMutation.isPending} isDisabled={preview.batch.valid_rows === 0}>
                Commit {preview.batch.valid_rows} lead(s)
              </Button>
            </div>
          </div>
        )}

        {step === "done" && preview && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-4 text-sm text-text">
              <span>Created: <strong>{preview.batch.created_rows ?? 0}</strong></span>
              <span>Updated: <strong>{preview.batch.updated_rows ?? 0}</strong></span>
              <span>Skipped: <strong>{preview.batch.skipped_rows ?? 0}</strong></span>
              <StatusBadge tone={preview.batch.status === "completed" ? "success" : "warning"}>{preview.batch.status}</StatusBadge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onPress={() => {
                  setStep("upload");
                  setPreview(null);
                  setRecords([]);
                  setHeaders([]);
                  setFileName("");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Import another file
              </Button>
              <Button variant="danger" onPress={() => rollbackMutation.mutate()} isLoading={rollbackMutation.isPending}>
                Roll back this import
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
