"use client";

// Print, preview and reprint for one finalized document (a sale or a return). The receipt comes from the server's snapshot, so preview and
// print are always the same document. The first print of the cashier's own sale is the original; everything else is a copy (RECEIPT_REPRINT),
// marked COPY — REPRINTED with its own time, and may need a reason. A print failure never touches the sale: the cashier is told, can try
// again, choose another printer, or use the preview. Each click has its own idempotency key, reused if the same click is retried after a lost
// answer — so a double click or a timeout never creates two jobs. autoPrint asks the counter's automatic print once per document.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, Printer } from "lucide-react";
import { Button, Dialog, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosReceiptPrintJob, PosReceiptReprintReason, PosReceiptWidth } from "@vercentlabs/api";

import { previewReceipt, printHtml, printReceipt, receiptPrintHistory, reportPrintJob, reprintEligibility, retryPrintJob, type ReceiptSource } from "@/features/pos/receipts/api/printing-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime } from "@/features/pos/shared/format";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const STATUS_LABEL: Record<string, string> = {
  READY: "Ready", DISPATCHED: "Sent to printer", FAILED: "Failed", OUTCOME_UNKNOWN: "Unknown", CANCELLED: "Cancelled", ACKNOWLEDGED: "Printer confirmed", QUEUED: "Queued", RENDERING: "Preparing",
};
const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  DISPATCHED: "success", ACKNOWLEDGED: "success", FAILED: "danger", OUTCOME_UNKNOWN: "warning", CANCELLED: "neutral", READY: "neutral", QUEUED: "neutral", RENDERING: "neutral",
};
const BROWSER = "browser";

export function ReceiptPrintActions({ source, sourceId, autoPrint = false, showHistory = true, size = "standard", terminalId = null }: {
  source: ReceiptSource; sourceId: string; autoPrint?: boolean; showHistory?: boolean; size?: "standard" | "large"; terminalId?: string | null;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const historyKey = scopedQueryKey(workspace, "pos", "receipt-print-history", source, sourceId);
  const eligibilityKey = scopedQueryKey(workspace, "pos", "receipt-reprint-eligibility", source, sourceId, terminalId);
  const history = useQuery({ queryKey: historyKey, queryFn: () => receiptPrintHistory(source, sourceId), retry: false, enabled: showHistory });
  const eligibility = useQuery({ queryKey: eligibilityKey, queryFn: () => reprintEligibility(source, sourceId, terminalId), retry: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [lastJob, setLastJob] = useState<PosReceiptPrintJob | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [width, setWidth] = useState<PosReceiptWidth>(80);
  const [printerChoice, setPrinterChoice] = useState<string | null>(null);
  const [reason, setReason] = useState<PosReceiptReprintReason | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const pendingKey = useRef<string | null>(null);
  const autoAsked = useRef(false);

  const info = eligibility.data;
  const copy = info?.nextPrint !== "original";
  const preview = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "receipt-preview", source, sourceId, width, copy), queryFn: () => previewReceipt(source, sourceId, width, copy), enabled: previewOpen,
  });
  const printerId = printerChoice ?? info?.defaultPrinterId ?? BROWSER;
  const needsReason = copy && Boolean(info?.reasonRequired);
  const reasonMissing = needsReason && (!reason || (reason === "other" && !reasonNote.trim()));
  const denied = info ? (copy ? !info.canReprint : !info.canPrintOriginal) : false;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: historyKey });
    void queryClient.invalidateQueries({ queryKey: eligibilityKey });
    if (source === "pos_sale") void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "receipt", sourceId) });
  }

  async function dispatch(job: PosReceiptPrintJob, html: string) {
    const outcome = await printHtml(html);
    const reported = await reportPrintJob(job.id, outcome === "dialog_opened" ? "dialog_opened" : "failed", outcome === "failed" ? "POS_RECEIPT_REPRINT_DISPATCH_FAILED" : undefined).catch(() => job);
    setLastJob(reported);
    setNotice(outcome === "dialog_opened"
      ? { tone: "success", text: `${job.copyLabel === "copy" ? "Copy" : "Receipt"} ${job.documentNumber ?? ""} sent to the print dialog. Check the paper — the browser cannot confirm it printed.` }
      : { tone: "danger", text: "The print dialog did not open. Try again, choose another printer, or open the preview and print from there." });
    refresh();
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try { await work(); } catch (failure) {
      setNotice({ tone: "danger", text: failure instanceof PosApiError ? failure.message : "Receipt could not be printed. The sale is not affected." });
    } finally { setBusy(false); }
  }

  const print = () => run(async () => {
    // The same click retried after a lost answer keeps its key, so it can only ever return the job already made.
    pendingKey.current ??= crypto.randomUUID();
    const result = await printReceipt(source, sourceId, {
      requestType: copy ? "reprint" : "manual", idempotencyKey: pendingKey.current, terminalId: terminalId ?? undefined,
      printerId: printerId === BROWSER ? undefined : printerId, documentVersion: info?.document.version,
      reasonCode: copy && reason ? reason : undefined, reasonNote: copy && reason === "other" ? reasonNote.trim() : undefined,
    }).catch((failure) => {
      // A refusal is final for this click; a lost answer (network) keeps the key for the retry.
      if (failure instanceof PosApiError) pendingKey.current = null;
      throw failure;
    });
    pendingKey.current = null;
    if (!result.job || !result.html) return;
    if (result.replayed) setNotice({ tone: "warning", text: "This print request was already sent — showing it again, no new copy was made." });
    if (result.fallback === "browser") setNotice({ tone: "warning", text: "Printer connection is unavailable. Using browser printing." });
    await dispatch(result.job, result.html);
  });

  // The job that may already have printed: retry only once the cashier says it did not.
  const retry = (job: PosReceiptPrintJob) => run(async () => {
    const mayHavePrinted = ["DISPATCHED", "OUTCOME_UNKNOWN"].includes(job.status);
    if (mayHavePrinted && !window.confirm("Printer response was not received. Check whether the receipt printed. Choose OK only if no paper came out — otherwise a second copy may be printed.")) return;
    const result = await retryPrintJob(job.id, mayHavePrinted);
    await dispatch(result.job, result.html);
  });

  useEffect(() => {
    if (!autoPrint || autoAsked.current) return;
    autoAsked.current = true;
    void (async () => {
      try {
        const result = await printReceipt(source, sourceId, { requestType: "auto", terminalId: terminalId ?? undefined });
        // Replayed: already asked for this document (a reload) — never print it twice automatically.
        if (!result.job || !result.html || result.replayed) return;
        if (result.job.status === "FAILED") { setLastJob(result.job); setNotice({ tone: "warning", text: result.job.message ?? "Automatic print failed. Print manually." }); return; }
        await dispatch(result.job, result.html);
      } catch {
        setNotice({ tone: "warning", text: "Automatic print did not run. Print the receipt manually." });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, source, sourceId]);

  const jobs = history.data?.jobs ?? [];
  const failedJob = lastJob && ["FAILED", "OUTCOME_UNKNOWN", "DISPATCHED"].includes(lastJob.status) && notice?.tone !== "success" ? lastJob : null;
  const label = copy ? (source === "pos_return" ? "Reprint return receipt" : "Reprint receipt") : "Print receipt";
  const printerOptions = [{ value: BROWSER, label: "Browser printing" }, ...(info?.printers ?? []).map((printer) => ({
    value: printer.id, label: `${printer.name} · ${printer.paperWidthMm === 210 ? "A4" : `${printer.paperWidthMm} mm`}${printer.connectionStatus === "browser" ? "" : " (not connected)"}`,
  }))];
  const warnings = info?.lifecycle.warnings ?? [];

  return (
    <div className="flex flex-col gap-2">
      {warnings.map((warning) => (
        <p key={warning.code} className="flex items-start gap-1.5 text-sm text-warning-emphasis"><AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />{warning.message}</p>
      ))}
      {copy && info && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {printerOptions.length > 1 && <Select label="Printer" selectedKey={printerId} onSelectionChange={(key) => setPrinterChoice(String(key))} options={printerOptions} />}
          <Select label={needsReason ? "Reason" : "Reason (optional)"} selectedKey={reason || undefined} onSelectionChange={(key) => setReason(String(key) as PosReceiptReprintReason)}
            options={info.reasons.map((option) => ({ value: option.code, label: option.label }))} />
          {reason === "other" && <TextField label="Describe the reason" value={reasonNote} onChange={setReasonNote} maxLength={200} />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size={size} onPress={print} isLoading={busy} isDisabled={denied || reasonMissing || eligibility.isLoading}>
          <Printer size={16} aria-hidden /> {label}
        </Button>
        <Button variant="secondary" size={size} onPress={() => setPreviewOpen(true)} isDisabled={eligibility.isError}>
          <Eye size={16} aria-hidden /> Preview
        </Button>
        {failedJob && <Button variant="ghost" size={size} onPress={() => retry(failedJob)} isLoading={busy}>Try again</Button>}
      </div>
      {denied && <p className="text-sm text-text-muted">{copy ? "You do not have permission to reprint this receipt." : "You do not have permission to print this receipt."}</p>}
      {eligibility.isError && <p className="text-sm text-danger-emphasis">{eligibility.error instanceof PosApiError ? eligibility.error.message : "Original receipt is unavailable."}</p>}
      {notice && <p role="status" className={`text-sm ${notice.tone === "danger" ? "text-danger-emphasis" : notice.tone === "warning" ? "text-warning-emphasis" : "text-text-muted"}`}>{notice.text}</p>}
      {showHistory && jobs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-text-muted">Print history ({jobs.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1">
                <span>
                  {dateTime(job.createdAt)} · {job.requestedBy ?? "—"} · {job.copyLabel === "copy" ? "Copy" : job.requestType === "auto" ? "Automatic" : "Original"}
                  {job.terminalCode ? ` · ${job.terminalCode}` : ""} · {job.printerName ?? "Browser"}{job.reasonLabel ? ` · ${job.reasonLabel}` : ""}
                  {job.attempts > 1 ? ` · ${job.attempts} attempts` : ""}
                </span>
                <StatusBadge tone={STATUS_TONE[job.status] ?? "neutral"}>{STATUS_LABEL[job.status] ?? job.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Dialog isOpen={previewOpen} onOpenChange={setPreviewOpen} title={copy ? "Receipt preview — copy" : "Receipt preview"} size="lg">
        <div className="flex flex-col gap-3">
          {info && (
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-text-muted">Original document</dt><dd className="font-medium">{info.document.number}</dd></div>
              <div><dt className="text-xs text-text-muted">Issued</dt><dd>{dateTime(info.document.issuedAt)}</dd></div>
              <div><dt className="text-xs text-text-muted">Status</dt><dd>{info.document.status === "finalized" ? "Finalized" : "Superseded"}</dd></div>
              <div><dt className="text-xs text-text-muted">Printed before</dt><dd>{info.timesPrinted}×</dd></div>
            </dl>
          )}
          <Select label="Paper" className="sm:max-w-xs" selectedKey={String(width)} onSelectionChange={(key) => setWidth(Number(key) as PosReceiptWidth)}
            options={[{ value: "80", label: "80 mm roll" }, { value: "58", label: "58 mm roll" }, { value: "210", label: "A4" }]} />
          {preview.isError && <p className="text-sm text-danger-emphasis">{preview.error instanceof PosApiError ? preview.error.message : "Receipt could not be prepared."}</p>}
          {preview.data && (
            <iframe title="Receipt preview" sandbox="" srcDoc={preview.data.html}
              className="h-[60vh] w-full rounded-[var(--radius-control)] border border-border bg-white" />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="primary" onPress={() => { setPreviewOpen(false); print(); }} isLoading={busy} isDisabled={!preview.data || denied || reasonMissing}>
              <Printer size={16} aria-hidden /> {label}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
