"use client";

// One journal entry: its debits and credits (each account opens its ledger), the document it came from (journal → source), who created,
// approved and posted it, its posting history, and the entry that reversed it or that it reverses. A manual journal moves through submit →
// approve (someone else) → post here, and is corrected by reversal; an automatic one is corrected from its document.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, TextField } from "@vercentlabs/design-system";

import { act } from "@/features/accounting/shared/client";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, errorMessage, errorStatus, getJournal, plain } from "../api/automatic-api";
import { JOURNAL_TONE } from "./JournalsScreen";

const OUTCOME: Record<string, string> = { DRAFTED: "Journal written", POSTED: "Posted", FAILED: "Failed", RETRY_REQUESTED: "Retry requested", REVERSED: "Reversed",
  DETECTED_MISSING: "Found without an entry", CANCELLED: "Dismissed", DUPLICATE_REFUSED: "Duplicate refused", QUEUED: "Queued", RESOLVED: "Resolved" };

export function JournalDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "accounting", "journal", id);
  const query = useQuery({ queryKey: key, queryFn: () => getJournal(id), retry: false });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  if (query.isLoading) return <LoadingState label="Loading the journal entry" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the journal entry" description={errorMessage(query.error)} />;
  }
  const journal = query.data;
  const currency = journal.functionalCurrency?.trim() || "INR";
  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try { await act(action, { id: journal.id, ...extra }); setReason(""); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") }); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const manual = !journal.automatic && journal.type !== "reversal";
  const actions = manual ? (
    <>
      {["draft", "rejected"].includes(journal.status) && can("accounting.journal.submit") && <Button size="compact" variant="primary" isLoading={busy} onPress={() => run("journal-submit")}>Submit</Button>}
      {journal.status === "pending_approval" && can("accounting.journal.approve") && <>
        <Button size="compact" variant="primary" isLoading={busy} onPress={() => run("journal-approve")}>Approve</Button>
        <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run("journal-reject")}>Send back</Button></>}
      {journal.status === "approved" && can("accounting.journal.post") && <Button size="compact" variant="primary" isLoading={busy} onPress={() => run("journal-post")}>Post</Button>}
    </>
  ) : undefined;

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href="/accounting/journals">Journal entries</Link>,
        title: `Journal ${journal.number}`,
        status: <StatusBadge tone={JOURNAL_TONE[journal.status] ?? "neutral"}>{journal.status.replace(/_/g, " ")}</StatusBadge>,
        fields: [
          { label: "Posting date", value: formatDate(journal.accountingDate) },
          { label: "Origin", value: journal.automatic ? "Automatic" : journal.type === "reversal" ? "Reversal" : "Manual" },
          { label: "Amount", value: amount(journal.totals.debit, currency) },
        ],
        primaryAction: actions,
      }}
      sidebar={journal.posting ? (
        <HistoryList title="Posting history" entries={(journal.posting.history ?? []).map((entry) => ({
          summary: `${OUTCOME[entry.outcome] ?? entry.outcome}${entry.journalNumber ? ` · ${entry.journalNumber}` : ""}`, at: entry.at, actor: entry.actor, detail: entry.message ?? undefined }))} />
      ) : undefined}
    >
      <div className="flex flex-col gap-4">
        {journal.source && (
          <Notice tone="info">
            Recorded automatically from {journal.source.module}: {journal.source.label.toLowerCase()}{" "}
            {journal.source.href ? <Link className="font-medium underline" href={journal.source.href}>{journal.source.number ?? "open it"}</Link> : journal.source.number}.
          </Notice>
        )}
        {journal.reversedBy && <Notice tone="warning">Reversed by <Link className="underline" href={`/accounting/journals/${journal.reversedBy.id}`}>{journal.reversedBy.number}</Link>{journal.reversedBy.reason ? `: ${journal.reversedBy.reason}` : ""}.</Notice>}
        {journal.reversalOf && <Notice tone="info">This entry reverses <Link className="underline" href={`/accounting/journals/${journal.reversalOf.id}`}>{journal.reversalOf.number}</Link>.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <FactList items={[
          ["Description", journal.description], ["Reference", journal.reference ?? "—"], ["Journal", journal.journal],
          ["Transaction date", formatDate(journal.documentDate ?? journal.entryDate)], ["Accounting period", `${journal.period} (${journal.periodStatus})`],
          ["Currency", journal.currency === journal.functionalCurrency ? journal.currency : `${journal.currency} at ${journal.exchangeRate}`],
          ["Created", byLine(journal.createdAt, journal.createdBy) ?? "—"], ["Approved", byLine(journal.approvedAt, journal.approvedBy) ?? "—"], ["Posted", byLine(journal.postedAt, journal.postedBy) ?? "—"],
        ]} />
        <Panel title="Debits and credits" description="Amounts in the company's currency. Each account opens its ledger.">
          <LinesTable columns={["Account", "Description", "Party", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }]}>
            {journal.lines.map((line) => (
              <tr key={line.sequence}>
                <Cell><Link className="text-brand underline" href={`/accounting/ledger/${line.accountId}`}>{line.account}</Link>{line.taxType && line.taxType !== "other" ? <span className="ml-1 text-xs text-text-muted">{line.taxType.toUpperCase()}</span> : null}</Cell>
                <Cell>{line.description}</Cell>
                <Cell>{line.party}</Cell>
                <Cell numeric>{plain(line.debit)}</Cell>
                <Cell numeric>{plain(line.credit)}</Cell>
              </tr>
            ))}
            <tr className="font-medium">
              <Cell>Total</Cell><Cell /><Cell />
              <Cell numeric>{plain(journal.totals.debit)}</Cell>
              <Cell numeric>{plain(journal.totals.credit)}</Cell>
            </tr>
          </LinesTable>
        </Panel>
        {manual && journal.status === "posted" && can("accounting.journal.reverse") && (
          <Panel title="Reverse this journal" description="A mirror entry is posted today; this entry stays as it is, marked reversed.">
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Reason" size="compact" value={reason} onChange={setReason} maxLength={500} className="sm:min-w-[22rem]" />
              <Button size="compact" variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3} onPress={() => run("journal-reverse", { reason: reason.trim() })}>Reverse</Button>
            </div>
          </Panel>
        )}
        {journal.automatic && journal.status === "posted" && (
          <p className="text-xs text-text-muted">Posted entries cannot be edited. To correct an automatic entry, correct its document (a credit note, a reversal of the bill or payment …).</p>
        )}
        {journal.posting?.postedAt && <p className="text-xs text-text-muted">Recorded {formatDateTime(journal.posting.postedAt)}.</p>}
      </div>
    </RecordDetailsPage>
  );
}
