"use client";

// Automatic postings: every financial event every module posted to the accounts, failures first. The health strip says whether the books
// balance and whether anything needs attention; a failed posting says why in plain words and is retried in place (never duplicated) or
// dismissed with a reason; "Find missing postings" looks for documents that reached their posting point without an entry; Coverage lists
// every event the system posts and what it records.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { HistoryList } from "@/shared/ui/record";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { BooksChecks } from "../components/BooksChecks";

import {
  POSTING_STATUS, amount, dismissPosting, errorMessage, errorStatus, getPosting, listPostings, postingHealth, retryAllPostings, retryPosting, scanPostings, type CoverageRow, type Posting,
} from "../api/automatic-api";

const VIEWS = [{ id: "attention", label: "Needs attention" }, { id: "all", label: "All" }, { id: "POSTED", label: "Posted" }, { id: "REVERSED", label: "Reversed" },
  { id: "CANCELLED", label: "Dismissed" }, { id: "coverage", label: "Coverage" }, { id: "books", label: "Sub-ledgers vs books" }];
const MODULES = ["Sales", "Procurement", "Inventory", "Manufacturing", "POS", "Expenses", "Payroll", "Assets", "Finance"];
const ANY = "any";

export function PostingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const mayPost = can("accounting.journal.post");
  const [view, setView] = useState("attention");
  const [module, setModule] = useState(ANY);
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const listing = view !== "coverage" && view !== "books";
  const filters = { status: listing ? view : undefined, module: module === ANY ? undefined : module, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "postings", filters), queryFn: () => listPostings(filters), enabled: listing, placeholderData: (previous) => previous });
  const health = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-health"), queryFn: postingHealth });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const coverage = useMemo(() => health.data?.coverage ?? [], [health.data]);
  const paged = usePagedRows(rows);
  const pagedCoverage = usePagedRows(coverage, { pageSize: 50 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try { setMessage({ tone: "success", text: await work() }); await refresh(); } catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); } finally { setBusy(false); }
  };

  const columns = useMemo<ColumnDef<Posting, unknown>[]>(() => [
    { id: "label", accessorKey: "label", header: "What happened", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.label}</span><span className="text-xs text-text-muted">{row.original.module}</span></span>) },
    { id: "sourceNumber", accessorKey: "sourceNumber", header: "Document", cell: ({ row }) => row.original.sourceHref
      ? <Link className="text-brand underline" href={row.original.sourceHref} onClick={(event) => event.stopPropagation()}>{row.original.sourceNumber ?? "Open"}</Link> : row.original.sourceNumber ?? "" },
    { id: "postingDate", accessorKey: "postingDate", header: "Posting date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.postingDate ?? row.original.transactionDate)}</span> },
    { id: "amount", accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.amount, row.original.currency?.trim() || "INR")}</span> },
    { id: "journalNumber", accessorKey: "journalNumber", header: "Journal", cell: ({ row }) => row.original.journalEntryId
      ? <Link className="text-brand underline" href={`/accounting/journals/${row.original.journalEntryId}`} onClick={(event) => event.stopPropagation()}>{row.original.journalNumber}</Link> : "—" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={POSTING_STATUS[row.original.status].tone}>{POSTING_STATUS[row.original.status].label}</StatusBadge> },
    { id: "problem", header: "Why", cell: ({ row }) => row.original.error ? <span className="text-xs text-danger">{row.original.error.message}</span> : row.original.automatic ? "Automatic" : "Manual" },
  ], []);
  const coverageColumns = useMemo<ColumnDef<CoverageRow, unknown>[]>(() => [
    { id: "module", accessorKey: "module", header: "Module" },
    { id: "label", accessorKey: "label", header: "Transaction", cell: ({ row }) => <span className="font-medium text-text">{row.original.label}</span> },
    { id: "effect", accessorKey: "effect", header: "Recorded automatically", cell: ({ row }) => <span className="text-text-secondary">{row.original.effect}</span> },
    { id: "posted", accessorKey: "posted", header: "Posted", cell: ({ row }) => <span className="tabular-nums">{row.original.posted}</span> },
    { id: "reversed", accessorKey: "reversed", header: "Reversed", cell: ({ row }) => <span className="tabular-nums">{row.original.reversed}</span> },
    { id: "attention", accessorKey: "attention", header: "Needs attention", cell: ({ row }) => row.original.attention
      ? <StatusBadge tone="danger">{String(row.original.attention)}</StatusBadge> : <span className="text-text-muted">0</span> },
  ], []);

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  const h = health.data?.health;
  return (
    <EnterpriseListPage
      header={{
        title: "Automatic Postings",
        description: "Every financial transaction in Sales, Procurement, Inventory, Manufacturing, POS, Expenses, Payroll, Assets and Finance is recorded in the accounts automatically. Anything that could not be recorded waits here with the reason; Sub-ledgers vs books shows whether each module agrees with its accounts.",
        primaryAction: mayPost ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" isLoading={busy} onPress={() => run(async () => { const found = await scanPostings(); return found.found ? `${found.found} document(s) without an accounting entry were found.` : "Nothing is missing."; })}>
              Find missing postings
            </Button>
            <Button variant="primary" isLoading={busy} isDisabled={!h || !(h.postings.FAILED + h.postings.PENDING)}
              onPress={() => run(async () => { const result = await retryAllPostings(); return `${result.posted} posted, ${result.failed} still need attention.`; })}>Retry all</Button>
          </div>
        ) : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={!listing ? undefined : {
        start: (
          <>
            <SearchField aria-label="Search postings" placeholder="Document or journal number" className="w-full sm:w-72" value={search} onChange={setSearch} />
            <Select aria-label="Module" size="compact" selectedKey={module} onSelectionChange={(key) => { setModule(String(key)); paged.resetPage(); }}
              options={[{ value: ANY, label: "Every module" }, ...MODULES.map((value) => ({ value, label: value }))]} />
          </>
        ),
      }}
    >
      {h && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Trial balance" value={h.trialBalance.balanced ? "Balanced" : `Off by ${amount(h.trialBalance.difference)}`} />
          <MetricCard label="Posted" value={String(h.postings.POSTED)} />
          <MetricCard label="Need attention" value={String(h.postings.FAILED + h.postings.PENDING)} />
          <MetricCard label="Reversed" value={String(h.postings.REVERSED)} />
        </div>
      )}
      {h && !h.healthy && (h.unbalancedEntries.length > 0 || h.stuckDrafts > 0) && (
        <Notice tone="danger">{h.unbalancedEntries.length ? `${h.unbalancedEntries.length} posted journal(s) do not balance. ` : ""}{h.stuckDrafts ? `${h.stuckDrafts} automatic journal(s) are stuck in draft.` : ""}</Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {view === "books" ? <BooksChecks /> : view === "coverage" ? (
        <EnterpriseDataGrid<CoverageRow>
          aria-label="Posting coverage" columns={coverageColumns} data={pagedCoverage.pageRows} getRowId={(row) => row.postingEvent}
          state={health.isLoading ? "loading" : health.isError ? "error" : "ready"}
          loadingContent={<LoadingState label="Loading coverage" rows={8} />}
          errorContent={<ErrorState title="Could not load coverage" description={errorMessage(health.error)} />}
          {...pagedCoverage.grid}
        />
      ) : (
        <EnterpriseDataGrid<Posting>
          aria-label="Automatic postings" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (view === "attention" && !submitted && module === ANY ? "empty" : "no-results") : "ready"}
          loadingContent={<LoadingState label="Loading postings" rows={8} />}
          errorContent={<ErrorState title="Could not load postings" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="Nothing needs attention" description="Every transaction that reached its posting point is in the accounts." />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, module or search." />}
          {...paged.grid}
          onRowClick={(row) => setSelected(row.id)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.label}</span>
                <StatusBadge tone={POSTING_STATUS[row.status].tone}>{POSTING_STATUS[row.status].label}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.sourceNumber} · {amount(row.amount)}{row.error ? ` · ${row.error.message}` : ""}</span>
            </div>
          )}
        />
      )}
      {selected && <PostingDialog id={selected} mayPost={mayPost} onClose={() => setSelected(null)} onChanged={refresh} />}
    </EnterpriseListPage>
  );
}

const OUTCOME: Record<string, string> = {
  QUEUED: "Queued", DRAFTED: "Journal written", POSTED: "Posted", FAILED: "Failed", DUPLICATE_REFUSED: "Duplicate refused", RETRY_REQUESTED: "Retry requested",
  DETECTED_MISSING: "Found without an entry", REVERSED: "Reversed", CANCELLED: "Dismissed", RESOLVED: "Resolved",
};

function PostingDialog({ id, mayPost, onClose, onChanged }: { id: string; mayPost: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting", id), queryFn: () => getPosting(id) });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const posting = query.data;
  const act = async (work: () => Promise<Posting>) => {
    setBusy(true);
    setError(null);
    try { await work(); await onChanged(); await query.refetch(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const open = posting && (posting.status === "FAILED" || posting.status === "PENDING");
  return (
    <Dialog isOpen isDismissable onOpenChange={(value) => { if (!value) onClose(); }} title={posting ? `${posting.label}${posting.sourceNumber ? ` · ${posting.sourceNumber}` : ""}` : "Posting"} size="lg">
      {!posting ? <LoadingState label="Loading the posting" rows={4} /> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge tone={POSTING_STATUS[posting.status].tone}>{POSTING_STATUS[posting.status].label}</StatusBadge>
            <span className="text-text-secondary">{posting.module} · {posting.effect}</span>
          </div>
          {posting.error && (
            <Notice tone="danger"><span className="font-medium">{posting.error.message}</span> {posting.error.hint}</Notice>
          )}
          <Panel>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-text-muted">Document</dt><dd>{posting.sourceHref ? <Link className="text-brand underline" href={posting.sourceHref}>{posting.sourceNumber ?? "Open"}</Link> : posting.sourceNumber}</dd></div>
              <div><dt className="text-xs text-text-muted">Journal</dt><dd>{posting.journalEntryId ? <Link className="text-brand underline" href={`/accounting/journals/${posting.journalEntryId}`}>{posting.journalNumber}</Link> : "—"}</dd></div>
              <div><dt className="text-xs text-text-muted">Amount</dt><dd className="tabular-nums">{amount(posting.amount, posting.currency?.trim() || "INR")}</dd></div>
              <div><dt className="text-xs text-text-muted">Attempts</dt><dd>{posting.attempts}</dd></div>
              <div><dt className="text-xs text-text-muted">Transaction date</dt><dd>{formatDate(posting.transactionDate)}</dd></div>
              <div><dt className="text-xs text-text-muted">Posted</dt><dd>{posting.postedAt ? `${formatDateTime(posting.postedAt)}${posting.postedBy ? ` by ${posting.postedBy}` : ""}` : "—"}</dd></div>
            </dl>
          </Panel>
          <HistoryList title="Posting history" entries={(posting.history ?? []).map((entry) => ({
            summary: `${OUTCOME[entry.outcome] ?? entry.outcome}${entry.journalNumber ? ` · ${entry.journalNumber}` : ""}`, at: entry.at, actor: entry.actor, detail: entry.message ?? undefined,
          }))} />
          {open && mayPost && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap gap-2">
                {posting.retryable
                  ? <Button variant="primary" isLoading={busy} onPress={() => act(() => retryPosting(posting.id))}>Retry now</Button>
                  : <span className="text-sm text-text-secondary">Post it again from its document{posting.sourceHref ? <> — <Link className="text-brand underline" href={posting.sourceHref}>open it</Link></> : ""}.</span>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <TextField label="Reason it is not needed" size="compact" value={reason} onChange={setReason} maxLength={500} className="sm:min-w-[20rem]" />
                <Button variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 5} onPress={() => act(() => dismissPosting(posting.id, reason.trim()))}>Dismiss</Button>
              </div>
            </div>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}
    </Dialog>
  );
}
