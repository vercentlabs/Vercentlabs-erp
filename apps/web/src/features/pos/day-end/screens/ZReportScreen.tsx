"use client";

// A finalized Z report exactly as frozen (checked against its hash): print it on the receipt printer or as A4, see what was learned after the
// close (late refund and payment outcomes, settled differences, Finance corrections — linked, never written into the report), and hand it to
// payment reconciliation and accounting posting.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { postPosDayEndReportToAccounting } from "@/features/pos/accounting/api/accounting-api";
import { printZReport, recordAdjustment, syncAdjustments, zReport, type Adjustment } from "@/features/pos/day-end/api/day-end-api";
import { DaySections } from "@/features/pos/day-end/components/DaySections";
import { startRun } from "@/features/pos/payment-reconciliation/api/reconciliation-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosBackLink, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const CATEGORY: Record<string, string> = {
  LATE_PAYMENT_OUTCOME: "Late payment outcome", LATE_REFUND_OUTCOME: "Late refund outcome", CASH_DIFFERENCE_RESOLVED: "Cash difference resolved", INVOICE_CORRECTION: "Invoice correction",
  INVENTORY_CORRECTION: "Inventory correction", FINANCE_CORRECTION: "Finance correction", OTHER: "Other",
};

export function ZReportScreen({ reportId }: { reportId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "z-report", reportId);
  const query = useQuery({ queryKey: key, queryFn: () => zReport(reportId), retry: false });
  const [adjustments, setAdjustments] = useState<Adjustment[] | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({ category: "FINANCE_CORRECTION", description: "", monetaryEffect: "", financeReference: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const has = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  useEffect(() => { void syncAdjustments(reportId).then(setAdjustments).catch(() => setAdjustments([])); }, [reportId]);
  if (query.isLoading) return <PosLoading label="Loading the Z report…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 403) return <PermissionState title="You cannot view this Z report" description="Ask an outlet manager for access." />;
    return <PosAlert>{query.error instanceof PosApiError ? query.error.message : "Could not load the Z report."}</PosAlert>;
  }
  const report = query.data;
  const c = report.snapshot.identity.currency || "INR";
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try { await work(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  const print = (format: "THERMAL" | "A4") => run(async () => {
    queryClient.setQueryData(key, await printZReport(reportId, { format, reason: reason.trim() || undefined }));
    setReason("");
    window.print();
  });
  return (
    <div className="flex flex-col gap-4">
      <PosBackLink href="/pos/day-end">Day-End</PosBackLink>
      <PosPanel title={`Z report ${report.number}`} description={`${report.snapshot.identity.outlet} · business date ${report.businessDate} · finalized ${dateTime(report.finalizedAt)}`}
        actions={<StatusBadge tone={report.verified ? "success" : "danger"}>{report.verified ? "Snapshot verified" : "Snapshot mismatch"}</StatusBadge>}>
        <div className="flex flex-wrap items-end gap-2">
          {report.prints > 0 && <TextField label="Reason for reprint" size="compact" value={reason} onChange={setReason} maxLength={300} />}
          <Button size="compact" variant="secondary" isLoading={busy} onPress={() => print("THERMAL")}>{report.prints ? "Reprint receipt" : "Print receipt"}</Button>
          <Button size="compact" variant="secondary" isLoading={busy} onPress={() => print("A4")}>{report.prints ? "Reprint / download A4" : "Print / download A4"}</Button>
          {report.variant === "SUMMARY" && <span className="text-xs text-text-muted">Summary copy — per-drawer cash details are for managers.</span>}
        </div>
        <DaySections snapshot={report.snapshot} />
      </PosPanel>

      <PosPanel title="After the close" description="Late events and corrections linked to this report. The report itself never changes.">
        {adjustments === null ? <p className="text-sm text-text-muted">Checking for late events…</p> : adjustments.length ? (
          <ul className="flex flex-col divide-y divide-border text-sm">{adjustments.map((row) => (
            <li key={row.id} className="py-1.5">
              <span className="font-medium">{CATEGORY[row.category] ?? row.category}</span>{row.automatic ? " (automatic)" : ""}: {row.description}
              {row.monetaryEffect ? ` · ${money(c, row.monetaryEffect)}` : ""}{row.financeReference ? ` · ${row.financeReference}` : ""} · {dateTime(row.discoveredAt)}{row.recordedBy ? ` · ${row.recordedBy}` : ""}
            </li>
          ))}</ul>
        ) : <p className="text-sm text-text-muted">Nothing has changed since the close.</p>}
        {(has(POS_PERMISSIONS.reportFinalize) || has(POS_PERMISSIONS.reconciliationApprove)) && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <Select label="Correction" size="compact" selectedKey={form.category} onSelectionChange={(value) => setForm({ ...form, category: String(value) })}
              options={["FINANCE_CORRECTION", "INVOICE_CORRECTION", "INVENTORY_CORRECTION", "OTHER"].map((value) => ({ value, label: CATEGORY[value] }))} />
            <TextField label="What changed" size="compact" value={form.description} onChange={(value) => setForm({ ...form, description: value })} maxLength={500} className="sm:min-w-[18rem]" />
            <TextField label="Money effect (₹)" size="compact" value={form.monetaryEffect} onChange={(value) => setForm({ ...form, monetaryEffect: value })} className="sm:max-w-[9rem]" />
            <TextField label="Finance reference" size="compact" value={form.financeReference} onChange={(value) => setForm({ ...form, financeReference: value })} maxLength={120} />
            <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!form.description.trim()}
              onPress={() => run(async () => {
                const row = await recordAdjustment(reportId, { category: form.category, sourceType: "manual", description: form.description.trim(),
                  monetaryEffect: form.monetaryEffect.trim() || undefined, financeReference: form.financeReference.trim() || undefined });
                setAdjustments((list) => [...(list ?? []), row]);
                setForm({ category: form.category, description: "", monetaryEffect: "", financeReference: "" });
              })}>Record correction</Button>
          </div>
        )}
      </PosPanel>

      {(has(POS_PERMISSIONS.reconciliationManage) || has(POS_PERMISSIONS.accountingPost)) && (
        <PosPanel title="Finance" description={`Payment reconciliation: ${report.reconciliationStatus}. Card / UPI settlement is matched here, after Day-End.`}>
          <div className="flex flex-wrap gap-2">
            {has(POS_PERMISSIONS.reconciliationManage) && <Button size="compact" variant="secondary" isLoading={busy}
              onPress={() => run(async () => { const result = await startRun({ runType: "ALL", idempotencyKey: crypto.randomUUID() }); setMessage(`Reconciliation run ${result.status.toLowerCase()} — see Payment Reconciliation.`); await queryClient.invalidateQueries({ queryKey: key }); })}>Run payment reconciliation</Button>}
            {has(POS_PERMISSIONS.accountingPost) && <Button size="compact" variant="secondary" isLoading={busy}
              onPress={() => run(async () => { const result = await postPosDayEndReportToAccounting(reportId); setMessage(`Posted ${result.posted.length}, already posted ${result.alreadyPosted.length}, failed ${result.failed.length}.`); })}>Post to accounting</Button>}
          </div>
        </PosPanel>
      )}
      {message && <PosAlert tone="success">{message}</PosAlert>}
      {error && <PosAlert>{error}</PosAlert>}
    </div>
  );
}
