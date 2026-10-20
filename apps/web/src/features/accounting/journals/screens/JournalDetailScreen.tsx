"use client";

// One journal entry: its debits and credits (each account opens its ledger), the document it came from (journal → source), who created,
// approved and posted it, and its full audit trail. A manual journal moves draft → submit → approve (someone else) → post here; a draft
// is edited or discarded; a posted one is reversed on a chosen date, or reversed and corrected — the correction opens as a new draft
// linked to the original. An automatic entry is corrected from its document.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumb, Button, Dialog, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, errorMessage, errorStatus, getJournal, journalStep, plain, statusOf, type JournalDetail, type JournalStep } from "../api/journals-api";

const OUTCOME: Record<string, string> = { DRAFTED: "Journal written", POSTED: "Posted", FAILED: "Failed", RETRY_REQUESTED: "Retry requested", REVERSED: "Reversed",
  DETECTED_MISSING: "Found without an entry", CANCELLED: "Dismissed", DUPLICATE_REFUSED: "Duplicate refused", QUEUED: "Queued", RESOLVED: "Resolved" };
const KIND: Record<string, string> = { standard: "Standard", adjustment: "Adjustment", accrual: "Accrual", deferral: "Deferral", reversal: "Reversal", opening: "Opening", closing: "Closing" };

type Ask = { step: "reverse" | "correct" | "discard" } | null;

export function JournalDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "journal", id), queryFn: () => getJournal(id), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<JournalStep | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  if (query.isLoading) return <LoadingState label="Loading the journal entry" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the journal entry" description={errorMessage(query.error)} />;
  }
  const journal = query.data;
  const currency = journal.functionalCurrency?.trim() || "INR";
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const run = async (step: JournalStep, input: { reason?: string; accountingDate?: string } = {}) => {
    setBusy(step);
    setError(null);
    try {
      const result = await journalStep(journal.id, step, { ...input, ...(step === "approve" ? { contentHash: journal.contentHash } : {}) });
      await refresh();
      setAsk(null);
      // Reversing opens the reversal; correcting opens the correction draft.
      if ((step === "reverse" || step === "correct") && result.id !== journal.id) router.push(`/accounting/journals/${result.id}`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(null); }
  };
  const status = statusOf(journal.status);
  const mine = journal.submittedById === workspace.userId;
  const manual = journal.manual;
  const primary = manual ? (
    <>
      {journal.editable && can("accounting.journal.create") && <LinkButton href={`/accounting/journals/${journal.id}/edit`} variant="secondary">Edit</LinkButton>}
      {journal.editable && can("accounting.journal.submit") && <Button variant="primary" isLoading={busy === "submit"} isDisabled={Boolean(busy)} onPress={() => run("submit")}>Submit</Button>}
      {journal.status === "pending_approval" && can("accounting.journal.approve") && !mine && <>
        <Button variant="secondary" isLoading={busy === "reject"} isDisabled={Boolean(busy)} onPress={() => run("reject")}>Send back</Button>
        <Button variant="primary" isLoading={busy === "approve"} isDisabled={Boolean(busy)} onPress={() => run("approve")}>Approve</Button></>}
      {journal.status === "approved" && can("accounting.journal.post") && <Button variant="primary" isLoading={busy === "post"} isDisabled={Boolean(busy)} onPress={() => run("post")}>Post</Button>}
      {journal.status === "posted" && can("accounting.journal.reverse") && <Button variant="secondary" isDisabled={Boolean(busy)} onPress={() => setAsk({ step: "reverse" })}>Reverse</Button>}
    </>
  ) : undefined;
  const more = (
    <MoreActions actions={[
      { id: "correct", label: "Reverse and correct", run: () => setAsk({ step: "correct" }), show: manual && journal.status === "posted" && can("accounting.journal.reverse") && can("accounting.journal.create") },
      { id: "discard", label: "Discard draft", run: () => setAsk({ step: "discard" }), show: journal.editable && can("accounting.journal.create") },
    ]} />
  );
  const hasDimensions = journal.lines.some((line) => line.department || line.costCenter);
  const auditTrail = journal.history.map((entry) => ({ summary: entry.label, at: entry.at, actor: entry.actor, detail: entry.detail ?? undefined }));
  const postingTrail = (journal.posting?.history ?? []).map((entry) => ({
    summary: `${OUTCOME[entry.outcome] ?? entry.outcome}${entry.journalNumber ? ` · ${entry.journalNumber}` : ""}`, at: entry.at, actor: entry.actor, detail: entry.message ?? undefined }));

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/journals">Journal entries</Breadcrumb>, <Breadcrumb key="this" isCurrent>{journal.number}</Breadcrumb>],
          title: `Journal ${journal.number}`,
          status: <StatusBadge tone={status.tone}>{status.label}</StatusBadge>,
          fields: [
            { label: "Posting date", value: formatDate(journal.accountingDate) },
            { label: "Origin", value: journal.automatic ? "Automatic" : journal.type === "reversal" ? "Reversal" : "Manual" },
            { label: "Amount", value: amount(journal.totals.debit, currency) },
          ],
          primaryAction: primary,
          secondaryActions: more,
        }}
        sidebar={<div className="flex flex-col gap-4">
          <HistoryList title="Audit trail" entries={auditTrail} empty="No history recorded." />
          {journal.automatic && postingTrail.length > 0 && <HistoryList title="Posting history" entries={postingTrail} />}
        </div>}
      >
        <div className="flex flex-col gap-4">
          {journal.source && (
            <Notice tone="info">
              Recorded automatically from {journal.source.module}: {journal.source.label.toLowerCase()}{" "}
              {journal.source.href ? <Link className="font-medium underline" href={journal.source.href}>{journal.source.number ?? "open it"}</Link> : journal.source.number}.
              {" "}To correct it, correct that document.
            </Notice>
          )}
          {journal.status === "pending_approval" && mine && <Notice tone="info">Waiting for someone else to approve it — the person who submits a journal can&apos;t approve it.</Notice>}
          {journal.status === "rejected" && <Notice tone="warning">Sent back for changes. Edit it and submit it again, or discard it.</Notice>}
          {journal.status === "cancelled" && <Notice tone="neutral">Discarded. It is kept for the record and never posts.</Notice>}
          {journal.reversedBy && <Notice tone="warning">Reversed by <Link className="underline" href={`/accounting/journals/${journal.reversedBy.id}`}>{journal.reversedBy.number}</Link>{journal.reversedBy.reason ? `: ${journal.reversedBy.reason}` : ""}.</Notice>}
          {journal.correctedBy && <Notice tone="info">Corrected by <Link className="underline" href={`/accounting/journals/${journal.correctedBy.id}`}>{journal.correctedBy.number}</Link> ({statusOf(journal.correctedBy.status).label.toLowerCase()}).</Notice>}
          {journal.reversalOf && <Notice tone="info">This entry reverses <Link className="underline" href={`/accounting/journals/${journal.reversalOf.id}`}>{journal.reversalOf.number}</Link>.</Notice>}
          {journal.correctionOf && <Notice tone="info">This entry corrects <Link className="underline" href={`/accounting/journals/${journal.correctionOf.id}`}>{journal.correctionOf.number}</Link>, which was reversed.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <FactList items={[
            ["Description", journal.description], ["Reference", journal.reference ?? "—"], ["Journal", journal.journal], ["Kind", KIND[journal.entryType] ?? journal.entryType],
            ["Document date", formatDate(journal.documentDate ?? journal.entryDate)], ["Accounting period", `${journal.period} (${journal.periodStatus === "soft_closed" ? "closing review" : journal.periodStatus})`],
            ["Currency", journal.currency === journal.functionalCurrency ? journal.currency : `${journal.currency} at ${journal.exchangeRate}`],
            ["Created", byLine(journal.createdAt, journal.createdBy) ?? "—"], ["Approved", byLine(journal.approvedAt, journal.approvedBy) ?? "—"], ["Posted", byLine(journal.postedAt, journal.postedBy) ?? "—"],
          ]} />
          <Panel title="Debits and credits" description="Amounts in the company's currency. Each account opens its ledger.">
            <LinesTable columns={["Account", "Description", ...(hasDimensions ? ["Department / cost centre"] : []), "Party", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }]}>
              {journal.lines.map((line) => (
                <tr key={line.sequence}>
                  <Cell><Link className="text-brand underline" href={`/accounting/ledger/${line.accountId}`}>{line.account}</Link>{line.taxType && line.taxType !== "other" ? <span className="ml-1 text-xs text-text-muted">{line.taxType.toUpperCase()}</span> : null}</Cell>
                  <Cell>{line.description}</Cell>
                  {hasDimensions && <Cell>{[line.department, line.costCenter].filter(Boolean).join(" · ")}</Cell>}
                  <Cell>{line.party}</Cell>
                  <Cell numeric>{plain(line.debit)}</Cell>
                  <Cell numeric>{plain(line.credit)}</Cell>
                </tr>
              ))}
              <tr className="font-medium">
                <Cell>Total</Cell><Cell />{hasDimensions && <Cell />}<Cell />
                <Cell numeric>{plain(journal.totals.debit)}</Cell>
                <Cell numeric>{plain(journal.totals.credit)}</Cell>
              </tr>
            </LinesTable>
          </Panel>
          {journal.posting?.postedAt && <p className="text-xs text-text-muted">Recorded {formatDateTime(journal.posting.postedAt)}.</p>}
        </div>
      </RecordDetailsPage>
      {ask && <StepDialog journal={journal} step={ask.step} busy={busy === ask.step} error={error} onClose={() => { setAsk(null); setError(null); }}
        onConfirm={(input) => run(ask.step, input)} />}
    </>
  );
}

const STEP_TEXT = {
  reverse: { title: "Reverse this journal", action: "Reverse", description: "A mirror entry is posted on the date you choose; this entry stays as it is, marked reversed." },
  correct: { title: "Reverse and correct", action: "Reverse and open correction",
    description: "This entry is reversed on the date you choose, and a correction draft opens with its lines for you to fix, check and post." },
  discard: { title: "Discard this draft", action: "Discard", description: "The draft is kept for the record, marked discarded, and never posts." },
} as const;

function StepDialog({ journal, step, busy, error, onClose, onConfirm }: {
  journal: JournalDetail; step: "reverse" | "correct" | "discard"; busy: boolean; error: string | null; onClose: () => void; onConfirm: (input: { reason: string; accountingDate?: string }) => void;
}) {
  const today = new Date();
  const [date, setDate] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  const [reason, setReason] = useState("");
  const text = STEP_TEXT[step];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={text.title} description={text.description}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {step !== "discard" && <TextField label={step === "correct" ? "Reversal and correction date" : "Reversal date"} type="date" isRequired value={date} onChange={setDate}
          description={`On or after ${formatDate(journal.accountingDate)}, in an open period.`} />}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} maxLength={500} description="Kept with the entry for the audit." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant={step === "discard" ? "danger" : "primary"} isLoading={busy} isDisabled={reason.trim().length < 3 || (step !== "discard" && !date)}
            onPress={() => onConfirm({ reason: reason.trim(), ...(step !== "discard" ? { accountingDate: date } : {}) })}>{text.action}</Button>
        </div>
      </div>
    </Dialog>
  );
}
