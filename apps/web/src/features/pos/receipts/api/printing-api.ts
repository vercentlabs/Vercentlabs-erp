"use client";

// Receipt Printing (0096): the server renders the finalized document; the browser only prints that HTML (in a hidden frame, so the POS screen
// stays put) and reports what it saw. A browser cannot see paper, so a print sent to the dialog is "sent", never "printed".
import type { PosReceiptBranding, PosReceiptLifecycle, PosReceiptPrintJob, PosReceiptPrintResult, PosReceiptPrinter, PosReceiptReprintEligibility, PosReceiptReprintReason, PosReprintSummary, PosReceiptWidth } from "@vercentlabs/api";

import { post, request } from "@/features/pos/shared/http";

export type ReceiptSource = "pos_sale" | "pos_return";
const base = (source: ReceiptSource, id: string) => `/${source === "pos_sale" ? "sales" : "returns"}/${id}/receipt`;

export type ReceiptPreview = { document: { id: string; type: string; number: string; version: number; issuedAt: string; lookupReference: string; hash: string }; lifecycle: PosReceiptLifecycle; width: PosReceiptWidth; html: string };
export const previewReceipt = (source: ReceiptSource, id: string, width: PosReceiptWidth = 80, asCopy = false) =>
  request<{ preview: ReceiptPreview }>(`${base(source, id)}/preview?width=${width}${asCopy ? "&copy=1" : ""}`).then((result) => result.preview);
export const reprintEligibility = (source: ReceiptSource, id: string, terminalId?: string | null) =>
  request<{ eligibility: PosReceiptReprintEligibility }>(`${base(source, id)}/reprint-eligibility${terminalId ? `?terminalId=${terminalId}` : ""}`).then((result) => result.eligibility);
export const reprintSummary = () => request<{ summary: PosReprintSummary }>("/reports/reprints").then((result) => result.summary);
// One idempotency key per deliberate action: pass the same key again when retrying the same click after a lost answer.
export const printReceipt = (source: ReceiptSource, id: string, input: { requestType?: "auto" | "manual" | "reprint"; width?: PosReceiptWidth; printerId?: string; terminalId?: string;
  documentVersion?: number; reasonCode?: PosReceiptReprintReason; reasonNote?: string; idempotencyKey?: string } = {}) =>
  post<PosReceiptPrintResult>(`${base(source, id)}/print`, { ...input, idempotencyKey: input.requestType === "auto" ? undefined : input.idempotencyKey ?? crypto.randomUUID() });
export const receiptPrintHistory = (source: ReceiptSource, id: string) =>
  request<{ history: { document: { number: string; version: number; lookupReference: string }; jobs: PosReceiptPrintJob[] } }>(`${base(source, id)}/print-history`).then((result) => result.history);
export const reportPrintJob = (jobId: string, outcome: "dialog_opened" | "cancelled" | "failed" | "unknown", errorCode?: string) =>
  post<{ job: PosReceiptPrintJob }>(`/receipt-print-jobs/${jobId}/report`, { outcome, errorCode }).then((result) => result.job);
export const retryPrintJob = (jobId: string, confirmNotPrinted = false) =>
  post<{ job: PosReceiptPrintJob; html: string }>(`/receipt-print-jobs/${jobId}/retry`, { confirmNotPrinted });

export const listReceiptPrinters = (terminalId: string) => request<{ printers: PosReceiptPrinter[] }>(`/terminals/${terminalId}/receipt-printers`).then((result) => result.printers);
export const addReceiptPrinter = (terminalId: string, input: Record<string, unknown>) =>
  post<{ printer: PosReceiptPrinter }>(`/terminals/${terminalId}/receipt-printers`, input).then((result) => result.printer);
export const updateReceiptPrinter = (printerId: string, input: Record<string, unknown>) =>
  request<{ printer: PosReceiptPrinter }>(`/receipt-printers/${printerId}`, { method: "PUT", body: JSON.stringify(input) }).then((result) => result.printer);
export const testReceiptPrinter = (printerId: string) => post<{ job: PosReceiptPrintJob; html: string }>(`/receipt-printers/${printerId}/test`, {});
export const saveReceiptBranding = (outletId: string, input: Record<string, unknown>) =>
  request<{ branding: PosReceiptBranding }>(`/outlets/${outletId}/receipt-branding`, { method: "PUT", body: JSON.stringify(input) }).then((result) => result.branding);
export const lookupReceipt = (code: string) =>
  request<{ match: { sourceType: ReceiptSource; sourceId: string; documentNumber: string; documentType: string } }>(`/receipts/lookup?code=${encodeURIComponent(code)}`).then((result) => result.match);

// Print server-rendered HTML through the browser's print dialog from a hidden frame. Resolves once the dialog was opened — which is all a
// browser can know. The frame is sandboxed apart from what printing needs (the HTML has no script of its own).
export function printHtml(html: string): Promise<"dialog_opened" | "failed"> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-modals allow-same-origin");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    let settled = false;
    const finish = (outcome: "dialog_opened" | "failed") => {
      if (settled) return;
      settled = true;
      resolve(outcome);
      window.setTimeout(() => frame.remove(), 60_000);
    };
    frame.onload = () => {
      try {
        const target = frame.contentWindow;
        if (!target) return finish("failed");
        target.focus();
        target.print();
        finish("dialog_opened");
      } catch {
        finish("failed");
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
    window.setTimeout(() => finish("failed"), 10_000);
  });
}
