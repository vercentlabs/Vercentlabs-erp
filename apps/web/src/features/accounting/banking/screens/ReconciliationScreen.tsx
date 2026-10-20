"use client";

// The reconciliation of one bank statement. Every line of the statement is matched to what the books show (a receipt, a payment, a
// transfer): the best match is suggested on import — never on the amount alone — and accepted with one click; any line can be matched by
// hand to one or more entries that add up to it exactly. What the bank did that the books don't have yet (charges, interest) is posted from
// its line. A line nobody can explain yet is an exception (with why), and one that isn't the company's transaction is ignored with a reason.
// The statement is complete when every line is settled and its opening balance continues from the previous statement; it can be reopened,
// with a reason, to correct a match.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { Breadcrumb, Button, Checkbox, ComboBox, Dialog, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { listPostingAccounts } from "@/features/accounting/automatic/api/automatic-api";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  LINE_STATE, STATEMENT_STATUS, cents, errorMessage, errorStatus, getWorkspace, inr, lineCandidates, lineStep, statementStep, type LineStep, type WorkspaceLine,
} from "../api/banking-api";

const FILTERS = [
  { id: "todo", label: "To do", test: (line: WorkspaceLine) => ["UNMATCHED", "SUGGESTED_MATCH", "PARTLY_MATCHED", "EXCEPTION"].includes(line.state) },
  { id: "suggested", label: "Suggested", test: (line: WorkspaceLine) => line.state === "SUGGESTED_MATCH" },
  { id: "exceptions", label: "Exceptions", test: (line: WorkspaceLine) => line.state === "EXCEPTION" },
  { id: "settled", label: "Matched / ignored", test: (line: WorkspaceLine) => ["MATCHED", "RECONCILED", "IGNORED"].includes(line.state) },
  { id: "all", label: "All", test: () => true },
] as const;
type Ask = null | { kind: "match" | "post" | "exception" | "ignore"; line: WorkspaceLine } | { kind: "reopen" };

export function ReconciliationScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "reconciliation", id), queryFn: () => getWorkspace(id), retry: false });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("todo");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  if (query.isLoading) return <LoadingState label="Loading the reconciliation" rows={10} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the reconciliation" description={errorMessage(query.error)} />;
  }
  const data = query.data;
  const { statement } = data;
  const currency = statement.currency;
  const mayReconcile = can("accounting.bank.reconcile");
  const mayPost = mayReconcile && can("accounting.journal.create");
  const open = statement.status !== "reconciled";
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setMessage(null);
    try { await work(); await refresh(); setMessage({ tone: "success", text: done }); }
    catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); } finally { setBusy(null); }
  };
  const step = (line: WorkspaceLine, name: LineStep, done: string) => run(`${line.id}:${name}`, () => lineStep(line.id, name), done);
  const acceptAll = async () => {
    const suggested = data.lines.filter((line) => line.state === "SUGGESTED_MATCH");
    await run("accept-all", async () => { for (const line of suggested) await lineStep(line.id, "accept"); }, `${suggested.length} suggestion${suggested.length === 1 ? "" : "s"} accepted.`);
  };
  const active = FILTERS.find((entry) => entry.id === filter)!;
  const shown = data.lines.filter(active.test);
  const difference = Math.round((statement.closing - data.bookBalance) * 100) / 100;

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/reconciliation">Bank reconciliation</Breadcrumb>, <Breadcrumb key="this" isCurrent>{statement.number}</Breadcrumb>],
          title: `Statement ${statement.number}`,
          status: <StatusBadge tone={STATEMENT_STATUS[statement.status].tone}>{STATEMENT_STATUS[statement.status].label}</StatusBadge>,
          fields: [
            { label: "Account", value: <Link className="text-brand underline" href={`/accounting/bank-accounts/${statement.bankAccount.id}`}>{statement.bankAccount.name}</Link> },
            { label: "Period", value: `${formatDate(statement.from)} – ${formatDate(statement.to)}` },
            { label: "Settled", value: `${data.counts.matched + data.counts.ignored} of ${data.counts.total}` },
          ],
          primaryAction: mayReconcile ? (open
            ? <Button variant="primary" isDisabled={!data.canComplete || Boolean(busy)} isLoading={busy === "complete"}
                onPress={() => run("complete", () => statementStep(statement.id, "complete"), "Statement reconciled.")}><Check className="size-4" aria-hidden="true" />Complete reconciliation</Button>
            : <Button variant="secondary" onPress={() => setAsk({ kind: "reopen" })}>Reopen</Button>) : undefined,
          secondaryActions: <MoreActions actions={[
            { id: "account", label: "Open the account", run: () => router.push(`/accounting/bank-accounts/${statement.bankAccount.id}`) },
            { id: "ledger", label: "Open its ledger", run: () => router.push(`/accounting/ledger/${statement.bankAccount.ledgerAccountId}`) },
            { id: "import", label: "Import the next statement", run: () => router.push(`/accounting/reconciliation/import?accountId=${statement.bankAccount.id}`), show: can("accounting.bank.manage") },
          ]} />,
        }}
      >
        <div className="flex flex-col gap-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {open && data.blockers.length > 0 && <Notice tone="warning">To complete: {data.blockers.join(" ")}</Notice>}
          {!open && <Notice tone="success">Reconciled. Every line is matched or ignored; reopen it (with a reason) to change a match.</Notice>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Opening" value={inr(statement.opening, currency)} warn={!data.continues} />
            <Metric label="Money in" value={inr(data.moneyIn, currency)} />
            <Metric label="Money out" value={inr(data.moneyOut, currency)} />
            <Metric label="Closing (bank)" value={inr(statement.closing, currency)} />
            <Metric label={`Books on ${formatDate(statement.to)}`} value={inr(data.bookBalance, currency)} />
            <Metric label="Difference" value={inr(difference, currency)} warn={Math.abs(difference) >= 0.005} />
          </div>
          {data.previous && !data.continues && (
            <Notice tone="danger">The opening balance {inr(statement.opening, currency)} doesn&apos;t continue from {data.previous.number}, which closed at {inr(data.previous.closing, currency)} on {formatDate(data.previous.to)}. A statement may be missing in between.</Notice>
          )}

          <Panel title="Statement lines"
            actions={open && mayReconcile && data.counts.suggested > 0
              ? <Button size="compact" variant="secondary" isLoading={busy === "accept-all"} isDisabled={Boolean(busy)} onPress={acceptAll}>Accept all {data.counts.suggested} suggestions</Button> : undefined}>
            <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Show lines">
              {FILTERS.map((entry) => {
                const count = data.lines.filter(entry.test).length;
                return <Button key={entry.id} size="compact" variant={filter === entry.id ? "primary" : "ghost"} onPress={() => setFilter(entry.id)}>{entry.label} · {count}</Button>;
              })}
            </div>
            {shown.length === 0 ? <p className="py-4 text-sm text-text-muted">{filter === "todo" ? "Nothing left to do on this statement." : "No lines here."}</p> : (
              <ul className="flex flex-col divide-y divide-border">
                {shown.map((line) => (
                  <LineRow key={line.id} line={line} currency={currency} open={open} mayReconcile={mayReconcile} mayPost={mayPost} busy={busy}
                    onStep={(name, done) => void step(line, name, done)} onAsk={(kind) => setAsk({ kind, line })} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="In the books, not on this statement" description="Entries on this account in the statement's period that no line is matched to — usually cheques not yet cleared, or deposits the bank will show later.">
            <LinesTable columns={["Date", "Entry", "Description", { label: "Amount", numeric: true }]} empty={data.notOnStatement.length ? undefined : "Every entry of the period is on the statement."}>
              {data.notOnStatement.map((entry) => (
                <tr key={entry.journalLineId}>
                  <Cell>{formatDate(entry.date)}</Cell>
                  <Cell>{entry.entryNumber}</Cell>
                  <Cell>{entry.description ?? "—"}</Cell>
                  <Cell numeric><span className={entry.amount < 0 ? "text-danger" : undefined}>{inr(entry.amount, currency)}</span></Cell>
                </tr>
              ))}
            </LinesTable>
          </Panel>
        </div>
      </RecordDetailsPage>
      {ask?.kind === "match" && <MatchDialog line={ask.line} currency={currency} onClose={() => setAsk(null)}
        onDone={async () => { setAsk(null); await refresh(); setMessage({ tone: "success", text: "Matched." }); }} />}
      {ask?.kind === "post" && <PostEntryDialog line={ask.line} currency={currency} onClose={() => setAsk(null)}
        onDone={async () => { setAsk(null); await refresh(); setMessage({ tone: "success", text: "Entry posted and matched." }); }} />}
      {(ask?.kind === "exception" || ask?.kind === "ignore") && (
        <LineReasonDialog kind={ask.kind} line={ask.line} onClose={() => setAsk(null)}
          onDone={async (text) => { await refresh(); setAsk(null); setMessage({ tone: "success", text }); }} />
      )}
      {ask?.kind === "reopen" && (
        <ReasonDialog title={`Reopen ${statement.number}`} action="Reopen" description="Its matches can be changed again; it must be completed again afterwards." onClose={() => setAsk(null)}
          run={async (reason) => { await statementStep(statement.id, "reopen", { reason }); await refresh(); setAsk(null); setMessage({ tone: "success", text: "Reopened." }); }} />
      )}
    </>
  );
}

function LineRow({ line, currency, open, mayReconcile, mayPost, busy, onStep, onAsk }: {
  line: WorkspaceLine; currency: string; open: boolean; mayReconcile: boolean; mayPost: boolean; busy: string | null;
  onStep: (name: LineStep, done: string) => void; onAsk: (kind: "match" | "post" | "exception" | "ignore") => void;
}) {
  const state = LINE_STATE[line.state];
  const settled = ["MATCHED", "RECONCILED", "IGNORED"].includes(line.state);
  const actionable = open && mayReconcile;
  return (
    <li className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums text-text-secondary">{formatDate(line.date)}</span>
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        </span>
        <span className="break-words text-sm font-medium text-text">{line.description ?? "—"}</span>
        {line.reference && <span className="text-xs text-text-muted">Ref {line.reference}</span>}
        {line.suggestion && line.state === "SUGGESTED_MATCH" && (
          <span className="text-xs text-info">Suggested: {line.suggestion.entryNumber} · {formatDate(line.suggestion.date)} · {line.suggestion.description} — {line.suggestion.reasons.join(", ")} ({line.suggestion.score}%)</span>
        )}
        {line.matches.length > 0 && (
          <span className="text-xs text-text-secondary">Matched to {line.matches.map((match, index) => (
            <span key={match.journalLineId}>{index > 0 ? ", " : ""}<Link className="text-brand underline" href={`/accounting/journals/${match.entryId}`}>{match.entryNumber}</Link> ({inr(match.amount, currency)})</span>
          ))}</span>
        )}
        {line.exception && line.state === "EXCEPTION" && <span className="text-xs text-danger">Exception: {line.exception.reason}{line.exception.by ? ` — ${line.exception.by}` : ""}</span>}
        {line.exception && line.state === "IGNORED" && <span className="text-xs text-text-muted">Ignored: {line.exception.reason}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
        <span className={`min-w-28 text-right text-sm font-semibold tabular-nums ${line.direction === "in" ? "text-success" : "text-text"}`}>
          {line.direction === "in" ? "+" : "−"}{inr(line.amount, currency)}</span>
        {actionable && line.state === "SUGGESTED_MATCH" && (
          <Button size="compact" variant="primary" isLoading={busy === `${line.id}:accept`} isDisabled={Boolean(busy)} onPress={() => onStep("accept", "Suggestion accepted.")}>Accept</Button>
        )}
        {actionable && !settled && <Button size="compact" variant="secondary" isDisabled={Boolean(busy)} onPress={() => onAsk("match")}><Search className="size-3.5" aria-hidden="true" />Find match</Button>}
        {actionable && (
          <MoreActions actions={[
            { id: "post", label: line.direction === "in" ? "Post as income (interest …)" : "Post as expense (bank charges …)", run: () => onAsk("post"), show: !settled && mayPost },
            { id: "exception", label: "Mark as exception", run: () => onAsk("exception"), show: !settled && line.state !== "EXCEPTION" },
            { id: "clear", label: "Clear exception", run: () => onStep("clear-exception", "Exception cleared."), show: line.state === "EXCEPTION" },
            { id: "ignore", label: "Ignore line", run: () => onAsk("ignore"), show: !settled },
            { id: "unmatch", label: line.state === "IGNORED" ? "Undo ignore" : "Undo match", run: () => onStep("unmatch", "Undone."), show: settled },
          ]} />
        )}
      </div>
    </li>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-panel)] border p-3 ${warn ? "border-warning-emphasis/30 bg-warning-soft" : "border-border bg-surface"}`}>
      <span className="truncate text-xs text-text-muted">{label}</span><span className="truncate text-base font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

function MatchDialog({ line, currency, onClose, onDone }: { line: WorkspaceLine; currency: string; onClose: () => void; onDone: () => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const candidates = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-line-candidates", line.id), queryFn: () => lineCandidates(line.id) });
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const total = (candidates.data ?? []).filter((entry) => chosen.includes(entry.journalLineId)).reduce((sum, entry) => sum + cents(entry.amount), 0);
  const left = cents(line.amount) - total;
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => !open && onClose()} size="lg" title={`Match ${line.direction === "in" ? "money in" : "money out"} of ${inr(line.amount, currency)}`}
      description={`${formatDate(line.date)} · ${line.description ?? ""}. Choose the entry, or several that add up to it exactly (a deposit of two cheques).`}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        {candidates.isLoading ? <LoadingState label="Finding entries" rows={4} /> : candidates.error ? <Notice>{errorMessage(candidates.error)}</Notice>
          : (candidates.data ?? []).length === 0 ? (
            <Notice tone="neutral">No unmatched {line.direction === "in" ? "money in" : "money out"} of up to {inr(line.amount, currency)} within 30 days on this account. Record the receipt, payment or transfer first — or post it from the line.</Notice>
          ) : (
            <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
              {(candidates.data ?? []).map((entry) => (
                <li key={entry.journalLineId} className="py-2">
                  <Checkbox isSelected={chosen.includes(entry.journalLineId)}
                    onChange={(selected) => setChosen((current) => selected ? [...current, entry.journalLineId] : current.filter((value) => value !== entry.journalLineId))}>
                    <span className="flex w-full min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium text-text">{entry.entryNumber} · {formatDate(entry.date)}{entry.party ? ` · ${entry.party}` : ""}</span>
                        <span className="truncate text-xs text-text-muted">{entry.description}{entry.reference ? ` · ${entry.reference}` : ""}</span>
                        <span className="text-xs text-info">{entry.reasons.join(", ")} · {entry.score}%</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{inr(entry.amount, currency)}</span>
                    </span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-sm tabular-nums ${left === 0 && total > 0 ? "text-success" : left < 0 ? "text-danger" : "text-text-secondary"}`}>
            {total === 0 ? "Nothing chosen" : left === 0 ? "Adds up exactly" : left > 0 ? `${inr(left / 100, currency)} still to find` : `${inr(-left / 100, currency)} too much`}</span>
          <span className="flex gap-2">
            <Button variant="secondary" onPress={onClose}>Cancel</Button>
            <Button variant="primary" isLoading={busy} isDisabled={left !== 0 || total === 0 || busy} onPress={async () => {
              setBusy(true); setFailure(null);
              try { await lineStep(line.id, "match", { journalLineIds: chosen }); await onDone(); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
            }}>Match</Button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}

function PostEntryDialog({ line, currency, onClose, onDone }: { line: WorkspaceLine; currency: string; onClose: () => void; onDone: () => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-accounts"), queryFn: listPostingAccounts, staleTime: 60_000 });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState(line.description ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const classes = line.direction === "in" ? ["revenue", "liability", "equity", "asset"] : ["expense", "asset", "liability"];
  const options = (accounts.data?.accounts ?? []).filter((account) => classes.includes(account.accountClass) && !["bank", "cash", "receivable", "payable"].includes(account.accountType))
    .sort((a, b) => (classes.indexOf(a.accountClass) - classes.indexOf(b.accountClass)) || a.code.localeCompare(b.code))
    .map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }));
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => !open && onClose()} title={line.direction === "in" ? "Post money in" : "Post money out"}
      description={`${inr(line.amount, currency)} on ${formatDate(line.date)}. Posts a journal entry against this bank account and matches the line to it. For a customer or supplier, record a receipt or payment instead.`}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <ComboBox label={line.direction === "in" ? "Income or other account" : "Expense or other account"} isRequired placeholder={line.direction === "in" ? "Interest received" : "Bank charges"}
          selectedKey={accountId} onSelectionChange={(key) => setAccountId(key ? String(key) : null)} options={options} />
        <TextField label="Description" value={description} onChange={setDescription} maxLength={300} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!accountId || busy} onPress={async () => {
            setBusy(true); setFailure(null);
            try { await lineStep(line.id, "post-entry", { accountId: accountId!, description: description.trim() || undefined }); await onDone(); }
            catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
          }}>Post and match</Button>
        </div>
      </div>
    </Dialog>
  );
}

function LineReasonDialog({ kind, line, onClose, onDone }: { kind: "exception" | "ignore"; line: WorkspaceLine; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  return (
    <ReasonDialog title={kind === "exception" ? "Mark as exception" : "Ignore this line"} action={kind === "exception" ? "Mark exception" : "Ignore line"}
      description={kind === "exception" ? "For a line nobody can explain yet. Say what is being done about it; the statement can't be completed until it is resolved."
        : "For a line that isn't the company's transaction (a bank error and its reversal). It is kept, marked ignored, with the reason."}
      onClose={onClose}
      run={async (reason) => { await lineStep(line.id, kind, { reason }); await onDone(kind === "exception" ? "Marked as exception." : "Line ignored."); }} />
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
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} maxLength={500} description="Kept on record." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={reason.trim().length < 3 || busy}
            onPress={async () => { setBusy(true); setFailure(null); try { await run(reason.trim()); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); } }}>{action}</Button>
        </div>
      </div>
    </Dialog>
  );
}

