"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, IconButton, PageHeader, Select, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@vercentlabs/design-system";
import { RotateCcw } from "lucide-react";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDateTime, humanize } from "@/shared/format/human";
import { ImportStepper } from "@/features/crm/shared/ui/ImportStepper";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import {
  commitLeadImportRequest,
  getLeadExportJobRequest,
  ImportExportApiError,
  leadExportDownloadUrl,
  listLeadImportBatchesRequest,
  analyzeLeadImportRequest,
  previewLeadImportRequest,
  rollbackLeadImportRequest,
  startLeadExportRequest,
} from "../api/import-export-api";
import { LEAD_IMPORT_FIELDS, type LeadImportBatch, type LeadImportPreviewResult } from "../types";

const ROLLBACKABLE_STATUSES = new Set(["completed", "completed_with_errors"]);

const STRATEGIES = [
  { value: "skip", label: "Skip duplicates", help: "A row that matches an existing lead is left out. Safest choice." },
  { value: "update", label: "Update the existing lead", help: "A matching row fills in the existing lead instead of creating a new one." },
  { value: "warn", label: "Import anyway and flag it", help: "The row is created and marked as a possible duplicate for review." },
  { value: "block", label: "Stop on the first duplicate", help: "The whole row is rejected so you can fix the file." },
];

const STEPS = ["Upload", "Map fields", "Duplicates", "Validate", "Import", "Results"];
type Step = "upload" | "map" | "duplicates" | "validate" | "results";
const stepIndex: Record<Step, number> = { upload: 0, map: 1, duplicates: 2, validate: 3, results: 5 };

const csvEscape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Import is a real two-stage flow: nothing is written until the final commit, and a committed batch can be rolled
// back. Export is a background job on the server. The steps below only present that; the rules stay server-side.
export function CrmImportExportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  // Mirrors the routes: import needs crm.import + crm.leads.manage, export needs crm.export.
  const canImport = workspace.permissions.includes(CRM_PERMISSIONS.import) && workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);
  const canExport = workspace.permissions.includes(CRM_PERMISSIONS.export);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chosenTab, setTab] = useState<"import" | "export">("import");
  const tab = canImport && canExport ? chosenTab : canImport ? "import" : "export";
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  // The server parses the file; the browser keeps only the File itself, a
  // short sample for mapping, and the server's row count.
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState("skip");
  const [preview, setPreview] = useState<LeadImportPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<{ rolledBack: number; protected: number } | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  function reset() {
    setStep("upload");
    setPreview(null);
    setRecords([]);
    setUploadFile(null);
    setRowCount(0);
    setHeaders([]);
    setFileName("");
    setError(null);
    setRollbackResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFile(file: File) {
    setError(null);
    if (!/\.csv$/i.test(file.name) && !/csv/.test(file.type)) {
      setError("That does not look like a CSV file. Export your sheet as CSV and try again.");
      return;
    }
    analyzeLeadImportRequest(file)
      .then((analyzed) => {
        if (analyzed.rowCount === 0) {
          setError("The file has a header row but no data rows.");
          return;
        }
        setUploadFile(file);
        setFileName(analyzed.fileName);
        setHeaders(analyzed.headers);
        setRecords(analyzed.sample);
        setRowCount(analyzed.rowCount);
        const auto: Record<string, string> = {};
        for (const field of LEAD_IMPORT_FIELDS) {
          const match = analyzed.headers.find((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === field.target.toLowerCase());
          if (match) auto[field.target] = match;
        }
        setMapping(auto);
        setStep("map");
      })
      .catch((err) => setError(err instanceof ImportExportApiError ? err.message : "The file could not be read. Check it is a UTF-8 CSV and try again."));
  }

  const previewMutation = useMutation({
    mutationFn: () => previewLeadImportRequest({ file: uploadFile!, fieldMapping: mapping, duplicateStrategy }),
    onSuccess: (result) => { setPreview(result); setStep("validate"); setError(null); },
    onError: (err) => setError(err instanceof ImportExportApiError ? err.message : "The file could not be checked. Try again."),
  });

  const commitMutation = useMutation({
    mutationFn: () => commitLeadImportRequest(preview!.batch.id),
    onSuccess: ({ batch }) => { setPreview((c) => (c ? { ...c, batch } : c)); setStep("results"); setError(null); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", "import-batches") }); },
    onError: (err) => setError(err instanceof ImportExportApiError ? err.message : "The import could not be completed. Nothing further was changed."),
  });

  const rollbackMutation = useMutation({
    mutationFn: () => rollbackLeadImportRequest(preview!.batch.id),
    onSuccess: (result) => { setRollbackResult(result); setConfirmRollback(false); setError(null); },
    onError: (err) => { setConfirmRollback(false); setError(err instanceof ImportExportApiError ? err.message : "The import could not be rolled back."); },
  });

  // F021 gap-closure — a completed batch used to be reachable only through
  // this component's own state; History lists every past batch (via
  // listCrmLeadImportBatches) so an import from an earlier visit can still
  // be found and, if still rollbackable, undone.
  const historyKey = scopedQueryKey(workspace, "crm", "leads", "import-batches");
  const historyQuery = useQuery({ queryKey: historyKey, queryFn: listLeadImportBatchesRequest, enabled: tab === "import" });
  const [historyRollbackTarget, setHistoryRollbackTarget] = useState<LeadImportBatch | null>(null);
  const historyRollbackMutation = useMutation({
    mutationFn: (batchId: string) => rollbackLeadImportRequest(batchId),
    onSuccess: () => { setHistoryRollbackTarget(null); queryClient.invalidateQueries({ queryKey: historyKey }); },
    onError: (err) => { setHistoryRollbackTarget(null); setError(err instanceof ImportExportApiError ? err.message : "The import could not be rolled back."); },
  });

  const invalidRows = useMemo(() => preview?.rows.filter((row) => !row.valid) ?? [], [preview]);
  const sampleFor = (header: string) => records.slice(0, 3).map((r) => r[header]).filter(Boolean).join(", ");

  const exportStartMutation = useMutation({
    mutationFn: () => startLeadExportRequest({}),
    onSuccess: ({ job }) => { setExportJobId(job.id); setExportError(null); },
    onError: (err) => setExportError(err instanceof ImportExportApiError ? err.message : "Could not start the export."),
  });
  const exportJobQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "export", exportJobId ?? ""),
    queryFn: () => getLeadExportJobRequest(exportJobId!),
    enabled: Boolean(exportJobId),
    refetchInterval: (query) => (["pending", "processing"].includes(query.state.data?.job.status ?? "") ? 2000 : false),
  });
  const exportJob = exportJobQuery.data?.job;
  const exportFailure = exportJob?.status === "dead" ? exportJob.lastError || "The export failed." : null;
  const exportRunning = Boolean(exportJobId) && !(exportJob && ["completed", "dead", "cancelled"].includes(exportJob.status));

  if (!canImport && !canExport) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Import and export" description="Bring leads in from a CSV file, or export what you can see." />
        <p className="text-sm text-text-muted">You need permission to import or export CRM data to use this page. Ask an administrator to grant it.</p>
      </div>
    );
  }

  const validCount = preview?.batch.valid_rows ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <PageHeader
        title="Import and export"
        description="Bring leads in from a CSV file in a few checked steps, or export the leads you can see."
        secondaryActions={canImport && canExport ? <ViewToggle label="Mode" options={[{ id: "import", label: "Import" }, { id: "export", label: "Export" }]} value={tab} onChange={(id) => setTab(id as "import" | "export")} /> : undefined}
      />

      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {tab === "export" ? (
        <section className="flex max-w-2xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5" aria-label="Export leads">
          <div>
            <h2 className="text-sm font-semibold text-text">Export leads</h2>
            <p className="text-sm text-text-secondary">Choose what to export, then start. It runs in the background and gives you a download when it is ready.</p>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-text-muted">What</dt><dd className="text-sm font-medium text-text">Leads</dd></div>
            <div><dt className="text-xs text-text-muted">Which ones</dt><dd className="text-sm font-medium text-text">Every lead you can see, up to 10,000</dd></div>
            <div><dt className="text-xs text-text-muted">Format</dt><dd className="text-sm font-medium text-text">CSV (opens in Excel and Sheets)</dd></div>
          </dl>
          {(exportError || exportFailure) && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{exportError || exportFailure}</p>}
          {exportRunning ? (
            <div className="flex items-center gap-3" role="status">
              <StatusBadge tone="info">{humanize(exportJob?.status ?? "starting")}</StatusBadge>
              <span className="text-sm text-text-secondary">Preparing your file…</span>
            </div>
          ) : (
            <div><Button variant="primary" onPress={() => { setExportJobId(null); exportStartMutation.mutate(); }} isLoading={exportStartMutation.isPending}>Start export</Button></div>
          )}
          {exportJob?.status === "completed" && (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm">
              <span className="text-text">{`${exportJob.manifest.rowCount ?? 0} lead${(exportJob.manifest.rowCount ?? 0) === 1 ? "" : "s"} ready${exportJob.manifest.truncated ? " (limited to the first 10,000)" : ""}.`}</span>
              <a href={leadExportDownloadUrl(exportJobId!)} className="font-medium text-brand underline">Download CSV</a>
              {exportJob.manifest.expiresAt && <span className="text-xs text-text-muted">{`Available until ${formatDateTime(exportJob.manifest.expiresAt)}`}</span>}
            </div>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-5" aria-label="Import leads">
          <ImportStepper steps={STEPS} current={stepIndex[step]} />

          {step === "upload" && (
            <div className="flex flex-col gap-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) handleFile(file); }}
                className={`flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center ${dragging ? "border-brand bg-brand-soft" : "border-border-strong"}`}
              >
                <p className="text-sm font-medium text-text">Drop a CSV file here</p>
                <p className="text-xs text-text-muted">The first row must be column names. Up to 5,000 rows.</p>
                <input ref={fileInputRef} id="import-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }} />
                <label htmlFor="import-file" className="inline-flex min-h-10 cursor-pointer items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover focus-within:ring-2 focus-within:ring-brand">Choose a file</label>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                <span>Not sure of the layout?</span>
                <Button variant="ghost" size="compact" onPress={() => download("lead-import-template.csv", LEAD_IMPORT_FIELDS.map((f) => csvEscape(f.label)).join(",") + "\n")}>Download a blank template</Button>
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-text">Import history</h3>
                {historyQuery.isLoading ? (
                  <p className="text-sm text-text-secondary">Loading past imports…</p>
                ) : (historyQuery.data?.batches.length ?? 0) === 0 ? (
                  <p className="text-sm text-text-muted">No imports yet. Once you import a file, it appears here so you can find and undo it later.</p>
                ) : (
                  <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
                    <Table className="w-full text-sm">
                      <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-muted">
                        <TableRow>
                          <TableHeaderCell className="px-3 py-2">File</TableHeaderCell>
                          <TableHeaderCell className="px-3 py-2">When</TableHeaderCell>
                          <TableHeaderCell className="px-3 py-2">Status</TableHeaderCell>
                          <TableHeaderCell className="px-3 py-2">Created</TableHeaderCell>
                          <TableHeaderCell className="px-3 py-2" />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(historyQuery.data?.batches ?? []).map((batch) => (
                          <TableRow key={batch.id} className="border-t border-border">
                            <TableCell className="px-3 py-2 text-text">{batch.file_name}</TableCell>
                            <TableCell className="px-3 py-2 text-text-secondary">{formatDateTime(batch.created_at)}</TableCell>
                            <TableCell className="px-3 py-2"><StatusBadge tone={batch.status === "completed" ? "success" : batch.status === "rolled_back" ? "neutral" : "warning"}>{humanize(batch.status)}</StatusBadge></TableCell>
                            <TableCell className="px-3 py-2 tabular-nums text-text-secondary">{batch.created_rows ?? 0}</TableCell>
                            <TableCell className="px-3 py-2 text-right">
                              {ROLLBACKABLE_STATUSES.has(batch.status) && (
                                <IconButton aria-label={`Undo import of ${batch.file_name}`} size="compact" variant="outline" onPress={() => setHistoryRollbackTarget(batch)}>
                                  <RotateCcw className="size-4" aria-hidden="true" />
                                </IconButton>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "map" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-secondary">{`${fileName}: ${rowCount} row${rowCount === 1 ? "" : "s"}. Match each lead field to a column in your file. First name is required.`}</p>
              <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
                <Table className="w-full text-sm">
                  <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-muted"><TableRow><TableHeaderCell className="px-3 py-2">Lead field</TableHeaderCell><TableHeaderCell className="px-3 py-2">Column in your file</TableHeaderCell><TableHeaderCell className="px-3 py-2">Example from your file</TableHeaderCell></TableRow></TableHead>
                  <TableBody>
                    {LEAD_IMPORT_FIELDS.map((field) => (
                      <TableRow key={field.target} className="border-t border-border">
                        <TableCell className="px-3 py-2 font-medium text-text">{field.label}{field.required ? <span className="text-danger"> *</span> : null}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Select aria-label={`Column for ${field.label}`} size="compact" options={[{ value: "", label: "Do not import" }, ...headers.map((h) => ({ value: h, label: h }))]} selectedKey={mapping[field.target] ?? ""} onSelectionChange={(key) => setMapping((c) => ({ ...c, [field.target]: String(key ?? "") }))} />
                        </TableCell>
                        <TableCell className="max-w-xs truncate px-3 py-2 text-text-muted">{mapping[field.target] ? sampleFor(mapping[field.target]) : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onPress={reset}>Start over</Button>
                <Button variant="primary" isDisabled={!mapping.firstName} onPress={() => setStep("duplicates")}>Continue</Button>
              </div>
              {!mapping.firstName && <p className="text-xs text-text-muted">Map the First name column to continue.</p>}
            </div>
          )}

          {step === "duplicates" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-secondary">Some rows may match leads you already have. Choose what should happen when one does.</p>
              <div role="radiogroup" aria-label="If a duplicate is found" className="flex flex-col gap-2">
                {STRATEGIES.map((s) => (
                  <button key={s.value} type="button" role="radio" aria-checked={duplicateStrategy === s.value} onClick={() => setDuplicateStrategy(s.value)} className={`flex flex-col rounded-[var(--radius-control)] border px-4 py-3 text-left ${duplicateStrategy === s.value ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-muted"}`}>
                    <span className="text-sm font-medium text-text">{s.label}</span>
                    <span className="text-xs text-text-secondary">{s.help}</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onPress={() => setStep("map")}>Back</Button>
                <Button variant="primary" isLoading={previewMutation.isPending} onPress={() => previewMutation.mutate()}>Check the file</Button>
              </div>
            </div>
          )}

          {step === "validate" && preview && (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-3 gap-3">
                <div className="rounded-[var(--radius-control)] border border-border p-3"><dt className="text-xs text-text-muted">Rows in file</dt><dd className="text-xl font-semibold tabular-nums text-text">{preview.batch.total_rows}</dd></div>
                <div className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft p-3"><dt className="text-xs text-success">Ready to import</dt><dd className="text-xl font-semibold tabular-nums text-success">{preview.batch.valid_rows}</dd></div>
                <div className={`rounded-[var(--radius-control)] border p-3 ${preview.batch.invalid_rows ? "border-danger-emphasis/30 bg-danger-soft" : "border-border"}`}><dt className={`text-xs ${preview.batch.invalid_rows ? "text-danger" : "text-text-muted"}`}>Need fixing</dt><dd className={`text-xl font-semibold tabular-nums ${preview.batch.invalid_rows ? "text-danger" : "text-text"}`}>{preview.batch.invalid_rows}</dd></div>
              </dl>
              {preview.idempotent && <p className="text-xs text-text-muted">This file matches a check you already ran, so the earlier result is shown.</p>}
              {invalidRows.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-text">Rows that will be left out</p>
                    <Button variant="ghost" size="compact" onPress={() => download("rows-to-fix.csv", ["Row,Problem", ...invalidRows.map((r) => `${r.rowNumber},${csvEscape(r.errors.map((e) => e.message).join("; "))}`)].join("\n"))}>Download this list</Button>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-border">
                    <Table className="w-full text-xs">
                      <TableHead><TableRow className="border-b border-border text-left text-text-muted"><TableHeaderCell className="px-2 py-1 font-medium">Row</TableHeaderCell><TableHeaderCell className="px-2 py-1 font-medium">What is wrong</TableHeaderCell></TableRow></TableHead>
                      <TableBody>{invalidRows.map((row) => <TableRow key={row.rowNumber} className="border-b border-border last:border-0"><TableCell className="px-2 py-1 tabular-nums">{row.rowNumber}</TableCell><TableCell className="px-2 py-1 text-danger">{row.errors.map((e) => e.message).join("; ")}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onPress={() => setStep("duplicates")}>Back</Button>
                <Button variant="primary" isDisabled={validCount === 0} isLoading={commitMutation.isPending} onPress={() => commitMutation.mutate()}>{`Import ${validCount} lead${validCount === 1 ? "" : "s"}`}</Button>
              </div>
            </div>
          )}

          {step === "results" && preview && (
            <div className="flex flex-col gap-4">
              {rollbackResult ? (
                <p role="status" className="rounded-[var(--radius-control)] border border-border bg-canvas-strong px-3 py-2 text-sm text-text">{`Rolled back ${rollbackResult.rolledBack} lead${rollbackResult.rolledBack === 1 ? "" : "s"}. ${rollbackResult.protected} stayed because they already have recorded activity.`}</p>
              ) : (
                <div role="status" className="flex flex-col gap-3">
                  <div className="flex items-center gap-2"><StatusBadge tone={preview.batch.status === "completed" ? "success" : "warning"}>{preview.batch.status}</StatusBadge><span className="text-sm text-text">Import finished.</span></div>
                  <dl className="grid grid-cols-3 gap-3">
                    <div className="rounded-[var(--radius-control)] border border-border p-3"><dt className="text-xs text-text-muted">Created</dt><dd className="text-xl font-semibold tabular-nums text-text">{preview.batch.created_rows ?? 0}</dd></div>
                    <div className="rounded-[var(--radius-control)] border border-border p-3"><dt className="text-xs text-text-muted">Updated</dt><dd className="text-xl font-semibold tabular-nums text-text">{preview.batch.updated_rows ?? 0}</dd></div>
                    <div className="rounded-[var(--radius-control)] border border-border p-3"><dt className="text-xs text-text-muted">Skipped</dt><dd className="text-xl font-semibold tabular-nums text-text">{preview.batch.skipped_rows ?? 0}</dd></div>
                  </dl>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onPress={reset}>Import another file</Button>
                {!rollbackResult && <Button variant="secondary" onPress={() => setConfirmRollback(true)}>Undo this import</Button>}
              </div>
            </div>
          )}
        </section>
      )}

      {confirmRollback && (
        <AlertDialog isOpen onOpenChange={(open) => { if (!open) setConfirmRollback(false); }} title="Undo this import?" description="The leads it created are removed. Any lead that already has calls, meetings or other activity stays, so nothing you have worked on is lost." confirmLabel="Undo import" isConfirming={rollbackMutation.isPending} onConfirm={() => rollbackMutation.mutate()} />
      )}

      {historyRollbackTarget && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setHistoryRollbackTarget(null); }}
          title={`Undo "${historyRollbackTarget.file_name}"?`}
          description="The leads it created are removed. Any lead that already has calls, meetings or other activity stays, so nothing you have worked on is lost."
          confirmLabel="Undo import"
          isConfirming={historyRollbackMutation.isPending}
          onConfirm={() => historyRollbackMutation.mutate(historyRollbackTarget.id)}
        />
      )}
    </div>
  );
}
