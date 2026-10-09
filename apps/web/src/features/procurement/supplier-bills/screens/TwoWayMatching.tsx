"use client";

// 2-Way Matching of a supplier bill against its purchase order: the header checks, each line side by side (what the order allows, what the
// supplier invoiced, the difference), every discrepancy with what to do about it, accepted exceptions — and, for a posted bill, the
// evaluation it was posted with (never recalculated). Matching is commercial only: goods receipt, tax and payment are checked separately.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, LinkButton, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { dateTime, money, quantity, statusLabel } from "@/features/procurement/shared/format";

import { MATCH_LABELS, MATCH_TONES, approveMatchException, errorMessage, getBillMatching, issuesOf, recheckBillMatching, type MatchEvaluation, type MatchResult } from "../api/supplier-bills-api";
import { Notice, Panel } from "@/shared/ui/Panel";

export const MatchBadge = ({ result }: { result: MatchResult }) => <StatusBadge tone={MATCH_TONES[result] ?? "neutral"}>{MATCH_LABELS[result] ?? result}</StatusBadge>;

const LINE_HEADS = ["Line", "Eligible", "Bill qty", "PO price", "Invoice price", "Expected", "Invoiced", "Difference", "PO tax / invoice tax", "Result"];
const BASIS_LABELS: Record<string, string> = { three_way_accepted: "3-Way · accepted goods", three_way_received: "3-Way · received goods", two_way: "2-Way" };

export function TwoWayMatching({ billId, currencyCode, editHref }: { billId: string; currencyCode: string; editHref?: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-matching", billId), queryFn: () => getBillMatching(billId) });
  const [approving, setApproving] = useState(false);
  const [reason, setReason] = useState("");
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); };
  const recheck = useMutation({ mutationFn: () => recheckBillMatching(billId), onSuccess: refresh });
  const approve = useMutation({ mutationFn: () => approveMatchException(billId, reason), onSuccess: () => { setApproving(false); setReason(""); refresh(); } });
  if (query.isLoading) return <LoadingState label="Checking the bill against its order" />;
  if (!query.data) return <Notice>{errorMessage(query.error)}</Notice>;
  const matching = query.data;
  const c = (value: string | null | undefined) => (value === null || value === undefined ? "—" : money(currencyCode, value));
  if (matching.result === "not_applicable")
    return <Panel title="Matching"><p className="text-sm text-text-muted">Not applicable: a direct bill without a purchase order is checked by its own financial and tax validation.</p></Panel>;
  const evaluation: MatchEvaluation | null = matching.evidence ?? matching.evaluation;
  const title = evaluation?.matchingType === "three_way" ? "3-Way Matching" : "2-Way Matching";
  const receiptLines = (evaluation?.lines ?? []).filter((line) => line.matchingBasis?.startsWith("three_way"));
  const open = (evaluation?.discrepancies ?? []).filter((entry) => !entry.approved);
  const description = matching.evidence
    ? `The evaluation this bill was posted with (${dateTime(matching.evidence.evaluatedAt ?? null)}, order revision ${matching.evidence.purchaseOrderRevision}). It is never recalculated.`
    : "The bill against its purchase order as it stands now; posting checks it again. A match is commercial only — not that goods arrived, the tax is right or the bill may be paid.";
  return (
    <div className="flex flex-col gap-4">
      <Panel title={title} description={evaluation?.matchingType === "three_way"
        ? `${description} Goods are checked against posted goods receipts (${evaluation.receiptBasis === "physical_received" ? "physically received" : "accepted"} quantities).` : description}
        actions={
          <div className="flex flex-wrap gap-2">
            {matching.actions.recheck && <Button size="compact" variant="secondary" isLoading={recheck.isPending} onPress={() => recheck.mutate()}>Check Matching</Button>}
            {matching.actions.approveException && <Button size="compact" variant="secondary" onPress={() => setApproving(true)}>Accept variance</Button>}
            {editHref && <LinkButton size="compact" variant="ghost" href={editHref}>Edit draft</LinkButton>}
            {matching.purchaseOrderId && <LinkButton size="compact" variant="ghost" href={`/procurement/purchase-orders/${matching.purchaseOrderId}`}>Open {matching.purchaseOrderNumber}</LinkButton>}
          </div>
        }>
        <div className="flex flex-wrap items-center gap-2">
          <MatchBadge result={evaluation?.result ?? matching.result} />
          {matching.stale && !matching.evidence && <StatusBadge tone="info">Not checked since the order changed</StatusBadge>}
          {evaluation && <span className="text-sm text-text-secondary">Expected {c(evaluation.expectedAmount)} · invoiced {c(evaluation.actualAmount)} · difference {c(evaluation.varianceAmount)} (before tax)</span>}
        </div>
        {recheck.error && <Notice>{errorMessage(recheck.error)}</Notice>}
        {evaluation && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted"><th className="py-1 pr-3 font-normal">Check</th><th className="py-1 pr-3 font-normal">Purchase order</th><th className="py-1 pr-3 font-normal">Bill</th><th className="py-1 font-normal">Result</th></tr></thead>
              <tbody className="divide-y divide-border">
                {evaluation.header.map((check) => (
                  <tr key={check.check}>
                    <td className="py-2 pr-3">{check.label}</td>
                    <td className="py-2 pr-3">{check.expected}</td>
                    <td className="py-2 pr-3">{check.check === "purchase_order" ? statusLabel(check.actual) : check.actual}</td>
                    <td className="py-2">{check.passed ? <StatusBadge tone="success">Matched</StatusBadge> : <StatusBadge tone="danger">Mismatch</StatusBadge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {evaluation && (
        <Panel title="Lines against the order" description="Per line: what the order still allows, what was invoiced, and the net value after discounts (agreed against invoiced).">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted">
                {LINE_HEADS.map((name, index) => <th key={name} className={index > 0 && index < 9 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {evaluation.lines.map((line) => (
                  <tr key={line.sequence}>
                    <td className="py-2 pr-3">{line.orderLineNumber ? `PO line ${line.orderLineNumber}` : "Not on the order"}<span className="block text-xs text-text-muted">{line.description}</span>
                      {line.matchingBasis && <span className="block text-xs text-text-muted">{BASIS_LABELS[line.matchingBasis]}</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.billingBasis === "amount" ? c(line.remainingAmount) : line.remaining === null ? "—" : quantity(line.remaining)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line.billingBasis === "amount" ? c(line.billedAmount) : quantity(line.quantity ?? "0")}
                      {line.invoicedQuantity && <span className="block text-xs text-text-muted">invoiced {quantity(line.invoicedQuantity)}</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c(line.expectedUnitPrice)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c(line.actualUnitPrice)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c(line.expectedNet)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c(line.actualNet)}</td>
                    <td className={Number(line.variance) !== 0 ? "py-2 pr-3 text-right tabular-nums text-danger" : "py-2 pr-3 text-right tabular-nums"}>{c(line.variance)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c(line.expectedTax)} / {c(line.actualTax)}</td>
                    <td className="py-2">{line.result === "matched" ? <StatusBadge tone="success">Matched</StatusBadge>
                      : line.result === "approved_exception" ? <StatusBadge tone="warning">Approved exception</StatusBadge> : <StatusBadge tone="danger">Mismatch</StatusBadge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-muted">Tax is shown for comparison only: the invoice&apos;s tax is validated separately by the tax engine.</p>
        </Panel>
      )}

      {receiptLines.length > 0 && (
        <Panel title="Goods receipts" description="Per line: received, eligible under the order's policy, already billed by posted bills, eligible now — and the receipts this bill draws on.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted">{["Line", "Received", "Eligible", "Billed by others", "Eligible now", "Bill qty", "Receipts"].map((name, index) =>
                <th key={name} className={index > 0 && index < 6 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {receiptLines.map((line) => (
                  <tr key={line.sequence}>
                    <td className="py-2 pr-3">PO line {line.orderLineNumber}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.received ?? "0")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.eligibleReceipt ?? "0")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.previouslyAllocated ?? "0")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.currentlyEligible ?? "0")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.quantity ?? "0")}</td>
                    <td className="py-2 pr-3">{line.allocations.length ? line.allocations.map((entry) => `${entry.receiptNumber ?? "GRN"} × ${quantity(entry.quantity)}`).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {evaluation && evaluation.discrepancies.length > 0 && (
        <Panel title={`Discrepancies (${evaluation.discrepancies.length})`}
          description={open.length ? "Posting is blocked until each is resolved: correct the draft, amend the order, ask for a corrected invoice, or — for a price, discount or charge — have an authorised approver accept it." : "Every discrepancy was accepted as an exception."}>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {evaluation.discrepancies.map((entry, index) => (
              <li key={`${entry.code}-${entry.lineSequence}-${index}`} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2"><StatusBadge tone={entry.approved ? "warning" : "danger"}>{entry.label}</StatusBadge>
                  {entry.approved && <span className="text-xs text-text-muted">Accepted: {entry.reason}</span>}
                  {!entry.approvable && <span className="text-xs text-text-muted">Cannot be accepted as an exception</span>}</span>
                <span>{entry.message}</span>
                {!entry.approved && <span className="text-xs text-text-secondary">{entry.guidance}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {matching.exceptions.length > 0 && (
        <Panel title="Accepted exceptions" description="Who accepted which variance, why, and how it is accounted. An exception expires when its line changes.">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {matching.exceptions.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2"><StatusBadge tone={entry.status === "approved" ? "warning" : "neutral"}>{entry.status === "approved" ? "Approved" : "Expired"}</StatusBadge>
                  {statusLabel(entry.code.toLowerCase())}{entry.lineSequence ? ` · line ${entry.lineSequence}` : ""} · expected {c(entry.expected)}, actual {c(entry.actual)}, difference {c(entry.variance)}</span>
                <span className="text-text-secondary">{entry.reason} — {entry.approvedBy ?? "—"}, {dateTime(entry.approvedAt)} · {statusLabel(entry.accountingTreatment)}{entry.expiredAt ? ` · expired ${dateTime(entry.expiredAt)}` : ""}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {approving && (
        <Dialog isOpen onOpenChange={(value) => !value && setApproving(false)} title="Accept the variance"
          description="Accepts the bill's open price, discount and charge differences as an approved exception, kept with your name and reason. It expires if the line changes." size="lg">
          <div className="flex flex-col gap-3">
            {approve.error && <Notice>{errorMessage(approve.error)}{issuesOf(approve.error).length > 1 && <ul className="mt-1 list-disc pl-5">{issuesOf(approve.error).map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
            <ul className="list-disc pl-5 text-sm">{open.map((entry, index) => <li key={index}>{entry.message}</li>)}</ul>
            <TextArea label="Reason (at least a sentence)" value={reason} onChange={setReason} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setApproving(false)}>Close</Button>
              <Button variant="primary" isLoading={approve.isPending} isDisabled={reason.trim().length < 10} onPress={() => approve.mutate()}>Accept variance</Button>
            </div>
          </div>
        </Dialog>
      )}
      {matching.purchaseOrderId && <p className="text-xs text-text-muted">Order: <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${matching.purchaseOrderId}`}>{matching.purchaseOrderNumber}</Link> (revision {matching.purchaseOrderRevision})</p>}
    </div>
  );
}
