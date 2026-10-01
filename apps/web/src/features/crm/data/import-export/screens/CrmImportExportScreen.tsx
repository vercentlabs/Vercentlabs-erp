"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, PageHeader } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ImportStepper } from "@/features/crm/data/import-export/components/ImportStepper";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import {
  getLeadExportJobRequest,
  ImportExportApiError,
  listLeadImportBatchesRequest,
  rollbackLeadImportRequest,
  startLeadExportRequest,
} from "../api/import-export-api";
import { type LeadImportBatch } from "../types";
import { useLeadImportWizard, type Step } from "../hooks/useLeadImportWizard";
import { LeadExportPanel } from "../components/LeadExportPanel";
import { UploadStep } from "../components/UploadStep";
import { ImportHistory } from "../components/ImportHistory";
import { MappingStep } from "../components/MappingStep";
import { DuplicateStrategyStep } from "../components/DuplicateStrategyStep";
import { ValidationStep } from "../components/ValidationStep";
import { ResultsStep } from "../components/ResultsStep";

const STEPS = [
  "Upload",
  "Map fields",
  "Duplicates",
  "Validate",
  "Import",
  "Results",
];

const stepIndex: Record<Step, number> = {
  upload: 0,
  map: 1,
  duplicates: 2,
  validate: 3,
  results: 5,
};

// Import is a real two-stage flow: nothing is written until the final commit, and a committed batch can be rolled
// back. Export is a background job on the server. The steps below only present that; the rules stay server-side.
export function CrmImportExportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  // Mirrors the routes: import needs crm.import + crm.leads.manage, export needs crm.export.
  const canImport =
    workspace.permissions.includes(CRM_PERMISSIONS.import) &&
    workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);
  const canExport = workspace.permissions.includes(CRM_PERMISSIONS.export);

  const [chosenTab, setTab] = useState<"import" | "export">("import");
  const tab =
    canImport && canExport ? chosenTab : canImport ? "import" : "export";
  const {
    fileInputRef,
    step,
    setStep,
    fileName,
    headers,
    rowCount,
    mapping,
    setMapping,
    duplicateStrategy,
    setDuplicateStrategy,
    preview,
    error,
    setError,
    dragging,
    setDragging,
    confirmRollback,
    setConfirmRollback,
    rollbackResult,
    reset,
    handleFile,
    previewMutation,
    commitMutation,
    progressQuery,
    resultBatch,
    running,
    rollbackMutation,
    invalidRows,
    sampleFor,
  } = useLeadImportWizard();
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // F021 gap-closure — a completed batch used to be reachable only through
  // this component's own state; History lists every past batch (via
  // listCrmLeadImportBatches) so an import from an earlier visit can still
  // be found and, if still rollbackable, undone.
  const historyKey = scopedQueryKey(
    workspace,
    "crm",
    "leads",
    "import-batches",
  );
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: listLeadImportBatchesRequest,
    enabled: tab === "import",
  });
  const [historyRollbackTarget, setHistoryRollbackTarget] =
    useState<LeadImportBatch | null>(null);
  const historyRollbackMutation = useMutation({
    mutationFn: (batchId: string) => rollbackLeadImportRequest(batchId),
    onSuccess: () => {
      setHistoryRollbackTarget(null);
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (err) => {
      setHistoryRollbackTarget(null);
      setError(
        err instanceof ImportExportApiError
          ? err.message
          : "The import could not be rolled back.",
      );
    },
  });

  const exportStartMutation = useMutation({
    mutationFn: () => startLeadExportRequest({}),
    onSuccess: ({ job }) => {
      setExportJobId(job.id);
      setExportError(null);
    },
    onError: (err) =>
      setExportError(
        err instanceof ImportExportApiError
          ? err.message
          : "Could not start the export.",
      ),
  });
  const exportJobQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "leads",
      "export",
      exportJobId ?? "",
    ),
    queryFn: () => getLeadExportJobRequest(exportJobId!),
    enabled: Boolean(exportJobId),
    refetchInterval: (query) =>
      ["pending", "processing"].includes(query.state.data?.job.status ?? "")
        ? 2000
        : false,
  });
  const exportJob = exportJobQuery.data?.job;
  const exportFailure =
    exportJob?.status === "dead"
      ? exportJob.lastError || "The export failed."
      : null;
  const exportRunning =
    Boolean(exportJobId) &&
    !(
      exportJob && ["completed", "dead", "cancelled"].includes(exportJob.status)
    );

  if (!canImport && !canExport) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Import and export"
          description="Bring leads in from a CSV file, or export what you can see."
        />
        <p className="text-sm text-text-muted">
          You need permission to import or export CRM data to use this page. Ask
          an administrator to grant it.
        </p>
      </div>
    );
  }

  const validCount = preview?.batch.valid_rows ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <PageHeader
        title="Import and export"
        description="Bring leads in from a CSV file in a few checked steps, or export the leads you can see."
        secondaryActions={
          canImport && canExport ? (
            <ViewToggle
              label="Mode"
              options={[
                { id: "import", label: "Import" },
                { id: "export", label: "Export" },
              ]}
              value={tab}
              onChange={(id) => setTab(id as "import" | "export")}
            />
          ) : undefined
        }
      />

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {tab === "export" ? (
        <LeadExportPanel
          exportError={exportError}
          exportFailure={exportFailure}
          exportJob={exportJob}
          exportJobId={exportJobId}
          exportRunning={exportRunning}
          exportStartMutation={exportStartMutation}
          setExportJobId={setExportJobId}
        />
      ) : (
        <section
          className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-5"
          aria-label="Import leads"
        >
          <ImportStepper steps={STEPS} current={stepIndex[step]} />

          {step === "upload" && (
            <UploadStep
              fileInputRef={fileInputRef}
              dragging={dragging}
              setDragging={setDragging}
              handleFile={handleFile}
            >
              <ImportHistory
                historyQuery={historyQuery}
                setHistoryRollbackTarget={setHistoryRollbackTarget}
              />
            </UploadStep>
          )}

          {step === "map" && (
            <MappingStep
              fileName={fileName}
              rowCount={rowCount}
              headers={headers}
              mapping={mapping}
              setMapping={setMapping}
              sampleFor={sampleFor}
              reset={reset}
              setStep={setStep}
            />
          )}

          {step === "duplicates" && (
            <DuplicateStrategyStep
              duplicateStrategy={duplicateStrategy}
              setDuplicateStrategy={setDuplicateStrategy}
              setStep={setStep}
              previewMutation={previewMutation}
            />
          )}

          {step === "validate" && preview && (
            <ValidationStep
              preview={preview}
              invalidRows={invalidRows}
              validCount={validCount}
              setStep={setStep}
              commitMutation={commitMutation}
            />
          )}

          {step === "results" && preview && (
            <ResultsStep
              resultBatch={resultBatch}
              running={running}
              progressQuery={progressQuery}
              rollbackResult={rollbackResult}
              reset={reset}
              setConfirmRollback={setConfirmRollback}
            />
          )}
        </section>
      )}

      {confirmRollback && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setConfirmRollback(false);
          }}
          title="Undo this import?"
          description="The leads it created are removed. Any lead that already has calls, meetings or other activity stays, so nothing you have worked on is lost."
          confirmLabel="Undo import"
          isConfirming={rollbackMutation.isPending}
          onConfirm={() => rollbackMutation.mutate()}
        />
      )}

      {historyRollbackTarget && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setHistoryRollbackTarget(null);
          }}
          title={`Undo "${historyRollbackTarget.file_name}"?`}
          description="The leads it created are removed. Any lead that already has calls, meetings or other activity stays, so nothing you have worked on is lost."
          confirmLabel="Undo import"
          isConfirming={historyRollbackMutation.isPending}
          onConfirm={() =>
            historyRollbackMutation.mutate(historyRollbackTarget.id)
          }
        />
      )}
    </div>
  );
}
