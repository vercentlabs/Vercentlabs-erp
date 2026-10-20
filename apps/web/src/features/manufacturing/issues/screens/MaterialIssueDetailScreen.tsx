"use client";

// One material issue note: its order, source and destination, each material with the stock it will take (or took — batch, serial unit,
// location, from the order's reservation or free stock), the approval of excess, the posting (Inventory movements and the Finance status),
// reversals and the timeline. The toolbar offers only what the note's state and the person's permissions allow. Posting asks first and
// re-checks everything on the server; a retry finds the posted note.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumb, Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { ISSUE_TONE, MI_BASE, VARIANCE_TYPES, getIssue, issueAction, postingStatus, previewIssue, type IssuePreview, type MaterialIssue, type PostingCheck } from "../api/mi-api";

export function MaterialIssueDetailScreen({ issueId }: { issueId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "manufacturing", "material-issue", issueId);
  const query = useQuery({ queryKey: key, queryFn: () => getIssue(issueId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [preview, setPreview] = useState<IssuePreview | null>(null);
  const [check, setCheck] = useState<PostingCheck | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the issue note" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material issues" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the issue note" description={errorMessage(query.error)} />;
  }
  const issue = query.data;
  const can = issue.can;
  const refresh = async (next?: MaterialIssue) => {
    if (next) queryClient.setQueryData(key, next);
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  // Every action: the note it returns refreshes the page; a refusal shows its reason.
  const perform = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      const result = await work() as { issue?: MaterialIssue };
      await refresh(result?.issue);
      setMessage({ tone: "success", text });
      setPreview(null);
    } catch (failure) {
      setMessage({ tone: "danger", text: errorMessage(failure) });
      throw failure;
    } finally { setBusy(false); }
  };
  const quiet = (work: () => Promise<unknown>, text: string) => perform(work, text).catch(() => undefined);
  const runPreview = async () => {
    setBusy(true);
    try { setPreview(await previewIssue(issue.id)); setMessage(null); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const runCheck = async () => {
    setBusy(true);
    try { setCheck(await postingStatus(issue.id)); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const post = () => setAsk({
    title: `Post ${issue.number}`, confirm: "Post to Inventory",
    description: `${issue.lines.map((line) => `${line.code} ${qty(line.quantity)} ${line.uom}`).join(", ")} leave ${issue.source.warehouse?.code ?? "the warehouse"} for ${issue.order.number}. `
      + "Every line posts or none does; the order's reservation is used first. A posted note is never edited — a mistake is returned or reversed.",
    fields: [], run: () => perform(() => issueAction(issue.id, "post", { expectedVersion: issue.rowVersion, expectedMoVersion: issue.order.version }), "Posted: the stock moved to production."),
  });
  const pendingExcess = issue.approval.excess.filter((row) => !row.withinTolerance);

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" onPress={() => router.push(`${MI_BASE}/${issue.id}/edit`)}>Edit draft</Button>}
      {can.validate && <Button size="compact" variant="secondary" isLoading={busy} onPress={runPreview}>Review</Button>}
      {can.requestApproval && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Ask for approval of the additional material", confirm: "Ask for approval",
        description: `Beyond what ${issue.order.number} may still issue: ${pendingExcess.map((row) => `${row.code} +${qty(row.excess)}`).join(", ")}. The approval covers exactly this note; any edit withdraws it. It changes this order's materials, never the BOM.`,
        fields: [{ name: "varianceType", label: "Kind", kind: "select", required: true, options: VARIANCE_TYPES, initial: "EXCESS_USAGE" }, { name: "reason", label: "Why it is needed", kind: "textarea", required: true }],
        run: (values) => perform(() => issueAction(issue.id, "request-approval", { ...values, expectedVersion: issue.rowVersion }), "Approval requested.") })}>Ask for approval</Button>}
      {can.decideApproval && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quiet(() => issueAction(issue.id, "decide-approval", { decision: "APPROVE", expectedVersion: issue.rowVersion }), "Additional material approved.")}>Approve</Button>}
      {can.decideApproval && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reject the additional material", confirm: "Reject", tone: "danger",
        fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => issueAction(issue.id, "decide-approval", { decision: "REJECT", note: values.note, expectedVersion: issue.rowVersion }), "Rejected: the note is a draft again.") })}>Reject</Button>}
      {can.post && <Button size="compact" variant="primary" isLoading={busy} onPress={post}>Post</Button>}
      {can.reverse && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Reverse ${issue.number}`, confirm: "Reverse", tone: "danger",
        description: "Only for a posting error — the material never left the store, or the wrong batch was booked. The exact stock comes back at its original value and the note stays posted with the reversal beside it. Unused material that did go to production is returned instead.",
        fields: [{ name: "reason", label: "What went wrong", kind: "textarea", required: true }, { name: "evidence", label: "Evidence (gate log, count sheet)", kind: "text" }],
        run: (values, requestKey) => perform(() => issueAction(issue.id, "request-reversal", { ...values, idempotencyKey: requestKey }), "Reversed: the stock is back in the store.") })}>Reverse</Button>}
      {can.print && <Button size="compact" variant="ghost" onPress={() => window.open(`${MI_BASE}/${issue.id}/print`, "_blank")}>{issue.print.count ? "Reprint" : "Print"}</Button>}
      {issue.posting && <Button size="compact" variant="ghost" isLoading={busy} onPress={runCheck}>Check posting</Button>}
      {can.recover && issue.status === "RECOVERY_REQUIRED" && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => quiet(() => issueAction(issue.id, "recover"), "Re-checked against Inventory and Finance.")}>Re-check</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel the note", confirm: "Cancel note", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => issueAction(issue.id, "cancel", { reason: values.reason, expectedVersion: issue.rowVersion }), "Cancelled.") })}>Cancel</Button>}
    </div>
  );

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Breadcrumb href={MI_BASE}>Material Issues</Breadcrumb>,
        title: `${issue.number} · ${issue.order.number}`,
        status: <StatusBadge tone={ISSUE_TONE[issue.status] ?? "neutral"}>{issue.statusLabel}</StatusBadge>,
        fields: [
          { label: "From", value: `${issue.source.warehouse?.code ?? "—"}${issue.source.location ? ` / ${issue.source.location.code}` : ""}` },
          { label: "To", value: `Production · ${issue.production.warehouse?.code ?? "—"}${issue.production.location ? ` / ${issue.production.location.code}` : ""}` },
          { label: "Lines", value: String(issue.lines.length) },
          { label: issue.postedAt ? "Issued" : "Created", value: formatDateTime(issue.postedAt ?? issue.createdAt) },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {issue.status === "RECOVERY_REQUIRED" && <Notice tone="danger">This note disagrees with Inventory or Finance. Do not issue it again: check the posting and re-check once corrected.</Notice>}
        {issue.cancelReason && <Notice tone="neutral">Cancelled by {issue.cancelledBy}: {issue.cancelReason}</Notice>}
        {issue.approval.required && !issue.approval.valid && issue.status !== "POSTED" && issue.status !== "CANCELLED" && (
          <Notice tone="warning">{issue.approval.message ?? "Additional material needs an approval before this note can post."}</Notice>
        )}
        {issue.totals.costStatus === "MISSING" && <Notice tone="danger">Inventory had no valuation for part of this issue: its cost is missing, not zero. Give the item a cost and review the order’s work in progress.</Notice>}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${issue.order.id}?tab=materials`}>{issue.order.number}</Link>],
          ["Product", `${issue.order.finishedItem.code} · ${issue.order.finishedItem.name}`],
          ["Order status", issue.order.statusLabel],
          ["Reason", issue.issueReason.toLowerCase().replace(/_/g, " ")],
          ["Prepared by", issue.createdBy ?? "—"],
          ["Issued by", issue.postedBy ?? "—"],
          ["Received by", issue.receivedBy ?? "—"],
          ["Issue date", formatDate(issue.issueDate)],
          ["Value", issue.totals.cost === null ? "—" : inr(issue.totals.cost)],
        ]} />
        {issue.notes && <p className="text-sm">{issue.notes}</p>}
        <Panel title="Materials" description={issue.status === "POSTED" ? "What Inventory gave, batch by batch and unit by unit." : "Remaining, reserved and free are as of now; posting checks them again."}>
          <LinesTable columns={["#", "Material", { label: "Issue", numeric: true }, { label: "Required", numeric: true }, { label: "Issued so far", numeric: true }, { label: "Remaining", numeric: true },
            { label: "Reserved", numeric: true }, "Stock", ...(can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
            {issue.lines.map((line) => (
              <tr key={line.id}>
                <Cell>{line.lineNumber}</Cell>
                <Cell><span className="flex flex-col"><span>{line.code} · {line.name}</span>
                  <span className="text-xs text-text-muted">{line.uom !== line.baseUom ? `${qty(line.baseQuantity)} ${line.baseUom}` : line.baseUom}{Number(line.excess) ? ` · +${qty(line.excess)} beyond the requirement` : ""}{Number(line.reversed) ? ` · ${qty(line.reversed)} reversed` : ""}</span></span></Cell>
                <Cell numeric>{qty(line.quantity)} {line.uom}</Cell><Cell numeric>{qty(line.required)}</Cell><Cell numeric>{qty(line.netIssued)}</Cell><Cell numeric>{qty(line.remainingToIssue)}</Cell>
                <Cell numeric>{qty(line.reservedForOrder)}</Cell>
                <Cell>{line.allocations.length ? (
                  <span className="flex flex-col text-xs">{line.allocations.map((part) => (
                    <span key={part.stockMovementId}>{qty(part.quantity)}{part.batch ? ` · ${part.batch}` : ""}{part.serial ? ` · ${part.serial}` : ""}{part.location ? ` · ${part.location}` : ""}{part.fromReservation ? " · reserved" : " · free"}</span>
                  ))}</span>
                ) : (
                  <span className="text-xs text-text-muted">{line.batch ? `Batch ${line.batch.number}` : line.serials.length ? line.serials.map((serial) => serial.number).join(", ") : line.trackingType === "batch" ? "Earliest expiry first" : "—"}</span>
                )}</Cell>
                {can.viewCost && <Cell numeric>{line.posted?.totalCost ? inr(line.posted.totalCost) : ""}</Cell>}
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {preview && <PreviewPanel preview={preview} canPost={can.post} onPost={post} />}
        {(issue.approval.status !== "NOT_REQUIRED" || issue.approval.excess.length > 0) && (
          <Panel title="Additional material">
            <FactList items={[
              ["Approval", issue.approval.status.toLowerCase().replace(/_/g, " ")],
              ["Kind", issue.approval.varianceType?.toLowerCase().replace(/_/g, " ") ?? "—"],
              ["Why", issue.approval.reason ?? "—"],
              ["Asked by", issue.approval.requestedBy ? `${issue.approval.requestedBy}, ${formatDateTime(issue.approval.requestedAt!)}` : "—"],
              ["Decided by", issue.approval.decidedBy ? `${issue.approval.decidedBy}, ${formatDateTime(issue.approval.decidedAt!)}` : "—"],
              ["Note", issue.approval.note ?? "—"],
            ]} />
            {issue.approval.excess.length > 0 && <p className="text-xs text-text-muted">{issue.approval.excess.map((row) => `${row.code} +${qty(row.excess)}${row.withinTolerance ? " (within tolerance)" : ""}`).join(" · ")}</p>}
          </Panel>
        )}
        {issue.posting && (
          <Panel title="Posting" description="Inventory moved the stock and Finance recorded the value in one transaction, under one posting identity.">
            <FactList items={[
              ["Posting identity", issue.posting.key], ["Inventory", `${issue.posting.inventoryStatus.toLowerCase()} · ${issue.posting.stockMovementIds.length} movement(s)`],
              ["Finance", issue.posting.financeStatus.toLowerCase().replace(/_/g, " ")], ["Posted", formatDateTime(issue.posting.at)],
            ]} />
            {check && (
              <Notice tone={check.consistent ? "success" : "danger"}>
                {check.consistent ? `Checked ${formatDateTime(check.checkedAt)}: Inventory (${check.inventory.movements} movements, ${qty(check.inventory.quantity)}) and Finance (${check.finance.status.toLowerCase()}) agree with the note.`
                  : check.problems.join(" ")}
              </Notice>
            )}
          </Panel>
        )}
        {issue.reversals.length > 0 && (
          <Panel title="Reversals">
            <LinesTable columns={["Reversal", "Line", { label: "Quantity", numeric: true }, "Why", "Evidence", ...(can.viewCost ? [{ label: "Value", numeric: true }] : []), "By"]}>
              {issue.reversals.map((row) => (
                <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.lineNumber}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell><Cell>{row.evidence ?? ""}</Cell>
                  {can.viewCost && <Cell numeric>{row.cost ? inr(row.cost) : ""}</Cell>}<Cell>{row.by}, {formatDateTime(row.at)}</Cell></tr>
              ))}
            </LinesTable>
          </Panel>
        )}
        <HistoryList title="Timeline" entries={issue.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

function PreviewPanel({ preview, canPost, onPost }: { preview: IssuePreview; canPost: boolean; onPost: () => void }) {
  return (
    <Panel title="Review" description={`Checked ${formatDateTime(preview.checkedAt)}. Nothing has moved; posting checks it all again.`}>
      {preview.ok ? <Notice tone="success">Every line can be issued now.</Notice> : <Notice tone="danger"><ul className="list-disc pl-4">{preview.problems.map((row) => <li key={row.message}>{row.message}</li>)}</ul></Notice>}
      <LinesTable columns={["Material", { label: "Issue", numeric: true }, { label: "From reservation", numeric: true }, { label: "Free stock", numeric: true }, { label: "Short", numeric: true }, "Stock to take"]}>
        {preview.lines.map((line) => (
          <tr key={line.lineId}><Cell>{line.code}</Cell><Cell numeric>{qty(line.baseQuantity)} {line.uom}</Cell><Cell numeric>{qty(line.fromReservation)}</Cell><Cell numeric>{qty(line.fromFree)}</Cell>
            <Cell numeric>{Number(line.short) ? qty(line.short) : ""}</Cell>
            <Cell><span className="text-xs">{line.plan.map((part) => `${qty(part.quantity)}${part.batch ? ` ${part.batch}` : ""}${part.serial ? ` ${part.serial}` : ""}${part.expiresOn ? ` (exp ${formatDate(part.expiresOn)})` : ""} · ${part.source === "RESERVATION" ? "reserved" : "free"}`).join("; ")}</span></Cell></tr>
        ))}
      </LinesTable>
      {preview.ok && canPost && <div className="flex justify-end"><Button variant="primary" onPress={onPost}>Post</Button></div>}
    </Panel>
  );
}

