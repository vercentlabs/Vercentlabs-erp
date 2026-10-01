"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  analyzeLeadImportRequest,
  commitLeadImportRequest,
  getLeadImportBatchRequest,
  ImportExportApiError,
  previewLeadImportRequest,
  rollbackLeadImportRequest,
} from "../api/import-export-api";
import { LEAD_IMPORT_FIELDS, type LeadImportPreviewResult } from "../types";

export type Step = "upload" | "map" | "duplicates" | "validate" | "results";

// The Lead import wizard's state machine: the chosen file (kept in the
// browser, parsed by the server), the field mapping and duplicate strategy,
// the server preview, the commit with background progress, and rollback.
// Nothing is written before commit. Called by the screen so the state
// survives moving between steps.
export function useLeadImportWizard() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [rollbackResult, setRollbackResult] = useState<{
    rolledBack: number;
    protected: number;
  } | null>(null);

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
      setError(
        "That does not look like a CSV file. Export your sheet as CSV and try again.",
      );
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
          const match = analyzed.headers.find(
            (h) =>
              h.toLowerCase().replace(/[^a-z0-9]/g, "") ===
              field.target.toLowerCase(),
          );
          if (match) auto[field.target] = match;
        }
        setMapping(auto);
        setStep("map");
      })
      .catch((err) =>
        setError(
          err instanceof ImportExportApiError
            ? err.message
            : "The file could not be read. Check it is a UTF-8 CSV and try again.",
        ),
      );
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      previewLeadImportRequest({
        file: uploadFile!,
        fieldMapping: mapping,
        duplicateStrategy,
      }),
    onSuccess: (result) => {
      setPreview(result);
      setStep("validate");
      setError(null);
    },
    onError: (err) =>
      setError(
        err instanceof ImportExportApiError
          ? err.message
          : "The file could not be checked. Try again.",
      ),
  });

  const commitMutation = useMutation({
    mutationFn: () => commitLeadImportRequest(preview!.batch.id),
    onSuccess: ({ batch }) => {
      setPreview((c) => (c ? { ...c, batch } : c));
      setStep("results");
      setError(null);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "leads", "import-batches"),
      });
    },
    onError: (err) =>
      setError(
        err instanceof ImportExportApiError
          ? err.message
          : "The import could not be completed. Nothing further was changed.",
      ),
  });

  // F021: a large import runs in the background; follow it until it ends.
  const TERMINAL = [
    "completed",
    "completed_with_errors",
    "failed",
    "rolled_back",
  ];
  const progressQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "leads",
      "import-progress",
      preview?.batch.id ?? "",
    ),
    queryFn: () => getLeadImportBatchRequest(preview!.batch.id),
    enabled:
      step === "results" &&
      Boolean(preview) &&
      ["queued", "processing", "committing"].includes(
        preview?.batch.status ?? "",
      ),
    refetchInterval: (current) =>
      TERMINAL.includes(current.state.data?.batch.status ?? "") ? false : 2000,
  });
  const resultBatch =
    progressQuery.data?.batch &&
    progressQuery.data.batch.id === preview?.batch.id
      ? progressQuery.data.batch
      : preview?.batch;
  const running =
    step === "results" &&
    Boolean(resultBatch) &&
    !TERMINAL.includes(resultBatch?.status ?? "");

  const rollbackMutation = useMutation({
    mutationFn: () => rollbackLeadImportRequest(preview!.batch.id),
    onSuccess: (result) => {
      setRollbackResult(result);
      setConfirmRollback(false);
      setError(null);
    },
    onError: (err) => {
      setConfirmRollback(false);
      setError(
        err instanceof ImportExportApiError
          ? err.message
          : "The import could not be rolled back.",
      );
    },
  });

  const invalidRows = useMemo(
    () => preview?.rows.filter((row) => !row.valid) ?? [],
    [preview],
  );
  const sampleFor = (header: string) =>
    records
      .slice(0, 3)
      .map((r) => r[header])
      .filter(Boolean)
      .join(", ");

  return {
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
  };
}

export type LeadImportWizard = ReturnType<typeof useLeadImportWizard>;
