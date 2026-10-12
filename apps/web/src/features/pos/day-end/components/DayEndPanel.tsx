"use client";

// Close a business day in four steps: 1 review the day's sales and collections (the X report — read-only, any number of times), 2 check shifts,
// cash and exceptions (blocking first, then those needing approval, then what is tracked with an owner), 3 approval of the approvable ones
// by someone else, for exactly the figures reviewed, 4 finalize the Z report. A lost answer is recovered by asking whether the day closed —
// never by finalizing again.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge, TextField } from "@vercentlabs/design-system";

import {
  approveExceptions, beginClosing, dayOutcome, finalizeDay, requestApproval, xReport, type BusinessDay, type DayEndContext, type DayException, type ReadinessResult,
} from "@/features/pos/day-end/api/day-end-api";
import { DaySections } from "@/features/pos/day-end/components/DaySections";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const STEPS = ["Review today's sales and collections", "Check shifts, cash and exceptions", "Review reconciliation and approve", "Generate and finalize Z Report"];
const TONE: Record<string, "danger" | "warning" | "info"> = { BLOCKING: "danger", APPROVABLE: "warning", TRACKED: "info" };

export function DayEndPanel({ context, day }: { context: DayEndContext; day: BusinessDay }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "day-end-preview", day.id);
  const preview = useQuery({ queryKey: key, queryFn: () => xReport(day.id), retry: false });
  const [checked, setChecked] = useState<ReadinessResult | null>(null);
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closedId, setClosedId] = useState<string | null>(null);
  const data = preview.data;
  const previewHash = checked?.previewHash ?? (data?.kind === "X" ? data.previewHash : null);
  // One request key per reviewed figures: pressing Finalize twice, or retrying after a lost answer, is the same request.
  const finalizeKey = useMemo(() => crypto.randomUUID(), [previewHash]); // eslint-disable-line react-hooks/exhaustive-deps
  if (preview.isLoading) return <PosLoading label="Preparing the day's figures…" />;
  if (preview.isError || !data) return <PosAlert>{preview.error instanceof PosApiError ? preview.error.message : "Could not prepare the report."}</PosAlert>;
  const zId = closedId ?? (data.kind === "Z" ? data.zReportId : null);
  if (zId) {
    return (
      <PosPanel title={`Business day ${day.businessDate} is closed`} description={`${context.outlet.name}`}>
        <p className="text-sm">The Z report is final. <Link href={`/pos/day-end/z-reports/${zId}`} className="font-medium text-brand hover:underline">Open, print or download it</Link>.</p>
      </PosPanel>
    );
  }
  if (data.kind !== "X") return null;
  const s = data.report;
  const c = s.identity.currency || "INR";
  const readiness = checked?.readiness ?? data.readiness;
  const status = checked?.day.status ?? day.status;
  const closing = ["CLOSING", "BLOCKED", "READY_TO_FINALIZE"].includes(status);
  const step = !closing ? 0 : readiness.blocking ? 1 : readiness.awaitingApproval ? 2 : 3;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong. Check the connection and try again."); } finally { setBusy(false); }
  };
  const refresh = async (next: ReadinessResult) => { setChecked(next); await queryClient.invalidateQueries({ queryKey: key }); };
  const group = (severity: DayException["severity"]) => readiness.items.filter((item) => item.severity === severity);
  const requested = readiness.items.some((item) => item.severity === "APPROVABLE" && item.status === "APPROVAL_REQUESTED");
  const finalize = () => run(async () => {
    try {
      const result = await finalizeDay(day.id, { expectedVersion: checked?.day.version, expectedPreviewHash: previewHash!, idempotencyKey: finalizeKey });
      setClosedId(result.zReportId);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end") });
    } catch (failure) {
      if (failure instanceof PosApiError) throw failure;
      setError("Checking whether Day-End completed. Do not finalize again.");
      const outcome = await dayOutcome(day.id);
      if (outcome.closed && outcome.result) { setClosedId(outcome.result.zReportId); setError(null); } else setError("Day-End did not complete. Try again.");
    }
  });
  return (
    <PosPanel title={`Close business day · ${context.outlet.name} · ${day.businessDate}`}
      description={`${dateTime(s.identity.periodStart)} – ${dateTime(s.identity.periodEnd)} (${s.identity.timezone}, cut-off ${s.identity.cutoff}). Figures as at ${dateTime(data.asOf)}.`}>
      <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {STEPS.map((text, index) => (
          <li key={text} className={`rounded-[var(--radius-control)] px-2 py-1.5 ${index === step ? "bg-info-soft font-semibold text-info" : index < step ? "text-text-secondary" : "text-text-muted"}`}>{index + 1} · {text}</li>
        ))}
      </ol>
      {/* Step 1 — the day's figures */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Completed sales", String(s.sales.count)], ["Gross sales", money(c, s.sales.gross)], ["Discounts", money(c, s.sales.totalDiscounts)], ["Returns", money(c, s.sales.returns)],
          ["Net sales after returns", money(c, s.sales.netAfterReturns)], ["Collections", money(c, s.collections.total)], ["Refunds paid", money(c, s.refunds.paid)],
          ["Closed shifts", `${s.shifts.closed} / ${s.shifts.total}`]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="compact" variant="ghost" onPress={() => setShowAll((value) => !value)}>{showAll ? "Hide the full X report" : "Show the full X report"}</Button>
        <Button size="compact" variant="ghost" onPress={() => { setChecked(null); void preview.refetch(); }}>Refresh figures</Button>
      </div>
      {showAll && <div className="rounded-[var(--radius-control)] border border-border p-3"><DaySections snapshot={s} /></div>}

      {/* Step 2 — exceptions */}
      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-sm font-medium">Reconciliation checks</p>
        {(["BLOCKING", "APPROVABLE", "TRACKED"] as const).map((severity) => group(severity).length > 0 && (
          <div key={severity} className="flex flex-col gap-1">
            <p className="text-xs uppercase text-text-muted">{severity === "BLOCKING" ? "Must be resolved" : severity === "APPROVABLE" ? "Needs approval" : "Tracked — continues after Day-End"}</p>
            <ul className="flex flex-col gap-1 text-sm">{group(severity).map((item) => (
              <li key={`${item.code}:${item.sourceId}`} className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={TONE[severity]}>{severity === "APPROVABLE" ? (item.approvalCurrent ? "Approved" : item.status === "APPROVAL_REQUESTED" ? "Requested" : item.status === "APPROVED" ? "Approval outdated" : "Needs approval") : severity === "BLOCKING" ? "Blocking" : "Tracked"}</StatusBadge>
                <span>{item.label}</span>{item.exposure && <span className="tabular-nums text-text-muted">{money(c, item.exposure)}</span>}
                {item.owner && severity === "TRACKED" && <span className="text-text-muted">· {item.owner}</span>}
              </li>
            ))}</ul>
          </div>
        ))}
        {readiness.ready && <p className="text-sm text-success">No blocking issues. {readiness.tracked ? `${readiness.tracked} item(s) stay tracked with their owners.` : ""}</p>}
        {!closing && context.can.prepare && (
          <div><Button variant="primary" isLoading={busy} onPress={() => run(async () => refresh(await beginClosing(day.id, day.version)))}>Review &amp; finalize Day-End</Button></div>
        )}
        {closing && <div><Button size="compact" variant="ghost" isLoading={busy} onPress={() => run(async () => refresh(await beginClosing(day.id)))}>Check again</Button></div>}
      </section>

      {/* Step 3 — approval of approvable exceptions */}
      {closing && readiness.awaitingApproval > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm">{readiness.awaitingApproval} exception(s) need approval by someone other than the person asking, for exactly these figures.</p>
          {context.can.prepare && !requested && (
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="How each will be handled" value={note} onChange={setNote} maxLength={500} className="sm:min-w-[22rem]" />
              <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!note.trim()} onPress={() => run(async () => { await refresh(await requestApproval(day.id, note.trim())); setNote(""); })}>Ask for approval</Button>
            </div>
          )}
          {context.can.approve && requested && previewHash && (
            <div><Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(async () => refresh(await approveExceptions(day.id, previewHash)))}>Approve exceptions</Button></div>
          )}
        </section>
      )}

      {/* Step 4 — finalize */}
      {closing && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          {context.can.finalize ? (
            <>
              <p className="text-sm">Finalizing freezes this report. Later events are linked to it as adjustments; it is never recalculated.</p>
              <div><Button variant="primary" isLoading={busy} isDisabled={!readiness.ready || !previewHash} onPress={finalize}>Finalize Z Report</Button></div>
            </>
          ) : <p className="text-sm text-text-muted">An outlet manager finalizes the Z report.</p>}
        </section>
      )}
      {error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}
