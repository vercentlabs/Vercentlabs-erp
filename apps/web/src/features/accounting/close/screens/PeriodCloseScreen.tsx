"use client";

// Closing one month. The readiness checks say what is left: blocking ones must be cleared (each links to where to do it); a warning is
// cleared or acknowledged with a reason. Start closing review (postings stop), close the month once it is ready, lock it, or — with a
// reason — reopen it. A closed month shows the checks and trial balance totals it was closed with.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { Breadcrumb, Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList, HistoryList, MoreActions, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PERIOD_TONE, closeStep, closeWorkspace, errorMessage, errorStatus, type CloseCheck, type CloseStep } from "../api/close-api";

export function PeriodCloseScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "period-close", id), queryFn: () => closeWorkspace(id), retry: false });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<CloseStep | null>(null);
  const [ask, setAsk] = useState<null | { kind: "reopen" } | { kind: "acknowledge"; check: CloseCheck }>(null);
  if (query.isLoading) return <LoadingState label="Loading the month's close" rows={10} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the month's close" description={errorMessage(query.error)} />;
  }
  const data = query.data;
  const { period, actions } = data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const run = async (step: CloseStep, done: string, input: Record<string, string> = {}) => {
    setBusy(step);
    setMessage(null);
    try { await closeStep(period.id, step, input); await refresh(); setMessage({ tone: "success", text: done }); }
    catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); } finally { setBusy(null); }
  };
  const blocking = data.checks.filter((check) => check.severity === "blocking");
  const warnings = data.checks.filter((check) => check.severity === "warning");
  const primary = (
    <>
      {actions.startReview && <Button variant="primary" isLoading={busy === "review"} isDisabled={Boolean(busy)} onPress={() => run("review", "Closing review started; nothing more posts into this month.")}>Start closing review</Button>}
      {actions.backToOpen && <Button variant="secondary" isLoading={busy === "back-to-open"} isDisabled={Boolean(busy)} onPress={() => run("back-to-open", "Back to open.")}>Back to open</Button>}
      {actions.close && <Button variant="primary" isLoading={busy === "close"} isDisabled={Boolean(busy) || !data.ready} onPress={() => run("close", `${period.name} is closed.`)}>Close {period.name}</Button>}
      {actions.lock && <Button variant="primary" isLoading={busy === "lock"} isDisabled={Boolean(busy)} onPress={() => run("lock", `${period.name} is locked.`)}>Lock</Button>}
    </>
  );

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/close">Period Close</Breadcrumb>, <Breadcrumb key="this" isCurrent>{period.name}</Breadcrumb>],
          title: `Close ${period.name}`,
          status: <StatusBadge tone={PERIOD_TONE[period.status]}>{period.statusLabel}</StatusBadge>,
          fields: [
            { label: "Month", value: `${formatDate(period.startDate)} – ${formatDate(period.endDate)}` },
            { label: "Financial year", value: period.yearName ?? "—" },
            ...(data.live ? [{ label: "Left to do", value: data.ready ? "Nothing — ready" : `${data.open} check${data.open === 1 ? "" : "s"}` }] : []),
          ],
          primaryAction: primary,
          secondaryActions: <MoreActions actions={[
            { id: "previous", label: `Open ${data.previous?.name ?? ""}`, run: () => router.push(`/accounting/close/${data.previous!.id}`), show: Boolean(data.previous) },
            { id: "next", label: `Open ${data.next?.name ?? ""}`, run: () => router.push(`/accounting/close/${data.next!.id}`), show: Boolean(data.next) },
            { id: "reopen", label: "Reopen the month", run: () => setAsk({ kind: "reopen" }), show: actions.reopen },
          ]} />,
        }}
        sidebar={<HistoryList title="Trail" entries={data.history.map((entry) => ({ summary: entry.label, at: entry.at, actor: entry.actor, detail: entry.detail ?? undefined }))} />}
      >
        <div className="flex flex-col gap-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {period.status === "open" && <Notice tone="info">Postings are open. Start the closing review when the month&apos;s work is in: postings stop, and the checks below must be cleared or acknowledged.</Notice>}
          {period.status === "soft_closed" && (data.ready ? <Notice tone="success">Ready to close: every check is cleared or acknowledged.</Notice>
            : <Notice tone="warning">In closing review — nothing posts into this month. {data.open} check{data.open === 1 ? " is" : "s are"} left; go back to open to fix something that needs a posting.</Notice>)}
          {period.status === "closed" && <Notice tone="success">Closed{period.closedBy ? ` by ${period.closedBy}` : ""} {period.closedAt ? `on ${formatDate(period.closedAt)}` : ""}. Lock it once the next month is under way.</Notice>}
          {period.status === "locked" && <Notice tone="neutral">Locked{period.lockedBy ? ` by ${period.lockedBy}` : ""}. {period.yearClosed ? "Its financial year is closed." : "Reopening needs the permission to waive close controls, and a reason."}</Notice>}
          {period.reopenedAt && period.status !== "closed" && period.status !== "locked" && <Notice tone="warning">Reopened {formatDate(period.reopenedAt)}{period.reopenedBy ? ` by ${period.reopenedBy}` : ""}: {period.reopenReason}</Notice>}

          <Panel title="Must be cleared" description={data.live ? "These stop the month from closing." : "As they were when the month closed."}>
            <CheckList checks={blocking} />
          </Panel>
          <Panel title="To clear or acknowledge" description={data.live ? "Each is cleared, or acknowledged with a reason by someone who may waive close controls." : "As they were when the month closed."}>
            <CheckList checks={warnings} canAcknowledge={actions.acknowledge} onAcknowledge={(check) => setAsk({ kind: "acknowledge", check })}
              onWithdraw={(check) => void run("withdraw", "Acknowledgement withdrawn.", { checkKey: check.key })} />
          </Panel>
          {data.trialBalance && (
            <FactList items={[
              ["Debits in the month", data.trialBalance.debit.toLocaleString("en-IN", { minimumFractionDigits: 2 })],
              ["Credits in the month", data.trialBalance.credit.toLocaleString("en-IN", { minimumFractionDigits: 2 })],
              ["Closing debits", data.trialBalance.closingDebit.toLocaleString("en-IN", { minimumFractionDigits: 2 })],
              ["Closing credits", data.trialBalance.closingCredit.toLocaleString("en-IN", { minimumFractionDigits: 2 })],
              ["Review started", byLine(period.reviewStartedAt, period.reviewStartedBy) ?? "—"], ["Closed", byLine(period.closedAt, period.closedBy) ?? "—"],
              ["Statements", <Link key="s" className="text-brand underline" href={`/accounting/trial-balance`}>Trial balance</Link>],
            ]} />
          )}
        </div>
      </RecordDetailsPage>
      {ask?.kind === "reopen" && (
        <ReasonDialog title={`Reopen ${period.name}`} action="Reopen" onClose={() => setAsk(null)}
          description={period.status === "locked" ? "A locked month is reopened only for a real correction. It goes back to open and postings return; close it again afterwards." : "It goes back to open and postings return; close it again afterwards."}
          run={async (reason) => { await closeStep(period.id, "reopen", { reason }); await refresh(); setAsk(null); setMessage({ tone: "success", text: `${period.name} is open again.` }); }} />
      )}
      {ask?.kind === "acknowledge" && (
        <ReasonDialog title={`Acknowledge: ${ask.check.label}`} action="Acknowledge" onClose={() => setAsk(null)}
          description={`${ask.check.detail ?? ""} Say why the month can close with this open; it is kept with the month.`}
          run={async (reason) => { await closeStep(period.id, "acknowledge", { checkKey: ask.check.key, reason }); await refresh(); setAsk(null); setMessage({ tone: "success", text: "Acknowledged." }); }} />
      )}
    </>
  );
}

function CheckList({ checks, canAcknowledge, onAcknowledge, onWithdraw }: {
  checks: CloseCheck[]; canAcknowledge?: boolean; onAcknowledge?: (check: CloseCheck) => void; onWithdraw?: (check: CloseCheck) => void;
}) {
  if (!checks.length) return <p className="text-sm text-text-muted">No checks.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {checks.map((check) => (
        <li key={check.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
          <span className="flex min-w-0 gap-2">
            {check.state === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Cleared" />
              : check.state === "acknowledged" ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" aria-label="Acknowledged" />
              : check.severity === "blocking" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Blocking" />
              : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" />}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-text">{check.label}</span>
              {!check.clear && check.detail && <span className="text-xs text-text-secondary">{check.detail}</span>}
              {check.acknowledgement && <span className="text-xs text-info">Acknowledged{check.acknowledgement.by ? ` by ${check.acknowledgement.by}` : ""}: {check.acknowledgement.reason}</span>}
            </span>
          </span>
          {!check.clear && (
            <span className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              {check.href && <Link className="text-sm text-brand underline" href={check.href}>Go there</Link>}
              {canAcknowledge && check.severity === "warning" && !check.acknowledgement && onAcknowledge && <Button size="compact" variant="secondary" onPress={() => onAcknowledge(check)}>Acknowledge</Button>}
              {canAcknowledge && check.acknowledgement && onWithdraw && <Button size="compact" variant="ghost" onPress={() => onWithdraw(check)}>Withdraw</Button>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReasonDialog({ title, description, action, onClose, run }: { title: string; description: string; action: string; onClose: () => void; run: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} maxLength={500} description="Kept with the month." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={reason.trim().length < 5 || busy}
            onPress={async () => { setBusy(true); setFailure(null); try { await run(reason.trim()); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); } }}>{action}</Button>
        </div>
      </div>
    </Dialog>
  );
}
