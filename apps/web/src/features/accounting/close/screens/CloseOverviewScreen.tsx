"use client";

// Period close: each financial year with its months and where each stands (Open, Closing review, Closed, Locked), the month next to close,
// and — once every month is closed — closing the year (its profit moves to retained earnings and every month is locked).
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lock } from "lucide-react";
import { Breadcrumb, Button, Dialog, ErrorState, LinkButton, PageHeader, PermissionState, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PERIOD_TONE, closeOverview, closeYear, errorMessage, errorStatus, type CloseYear } from "../api/close-api";

export function CloseOverviewScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "close-overview"), queryFn: closeOverview });
  const [closing, setClosing] = useState<CloseYear | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mayClose = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.close.manage");
  if (query.isLoading) return <LoadingState label="Loading the period close" rows={8} />;
  if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!query.data) return <ErrorState title="Could not load the period close" description={errorMessage(query.error)} />;
  const { nextToClose, years } = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader breadcrumbs={[<Breadcrumb key="a" href="/accounting">Accounting</Breadcrumb>, <Breadcrumb key="b" isCurrent>Period Close</Breadcrumb>]}
        title="Period Close" description="Close each month in order: closing review stops postings, the readiness checks say what is left, and a closed month is locked. A month is reopened only with a reason."
        primaryAction={nextToClose ? <LinkButton variant="primary" href={`/accounting/close/${nextToClose.id}`}>Close {nextToClose.name}<ArrowRight className="size-4" aria-hidden="true" /></LinkButton> : undefined} />
      {message && <Notice tone="success">{message}</Notice>}
      {years.length === 0 && <Notice tone="info">No financial year yet. Create one under Financial Years.</Notice>}
      {years.map((year) => (
        <Panel key={year.id} title={year.name} description={`${formatDate(year.startDate)} – ${formatDate(year.endDate)}${year.status === "closed" ? ` · closed ${formatDate(year.closedAt)}` : ""}`}
          actions={year.status === "closed"
            ? (year.closingJournalEntryId ? <Link className="text-sm text-brand underline" href={`/accounting/journals/${year.closingJournalEntryId}`}>Year-end closing entry</Link> : <StatusBadge tone="neutral">Closed</StatusBadge>)
            : mayClose ? <Button size="compact" variant={year.canClose ? "primary" : "secondary"} isDisabled={!year.canClose} onPress={() => setClosing(year)}><Lock className="size-3.5" aria-hidden="true" />Close the year</Button> : undefined}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {year.periods.map((period) => (
              <li key={period.id}>
                <Link href={`/accounting/close/${period.id}`} className={`flex flex-col gap-1 rounded-[var(--radius-control)] border p-3 text-sm hover:border-brand ${nextToClose?.id === period.id ? "border-brand bg-brand-soft/40" : "border-border bg-surface"}`}>
                  <span className="font-medium text-text">{period.name}</span>
                  <StatusBadge tone={PERIOD_TONE[period.status]}>{period.statusLabel}</StatusBadge>
                  <span className="text-xs text-text-muted">{period.status === "closed" || period.status === "locked" ? `Closed ${formatDate(period.closedAt)}${period.closedBy ? ` · ${period.closedBy}` : ""}`
                    : period.reopenedAt ? `Reopened ${formatDate(period.reopenedAt)}` : period.type === "adjustment" ? "Year-end adjustments" : `${formatDate(period.startDate)} – ${formatDate(period.endDate)}`}</span>
                </Link>
              </li>
            ))}
          </ul>
          {!year.canClose && year.status !== "closed" && <p className="mt-2 text-xs text-text-muted">The year is closed once all its months are closed.</p>}
        </Panel>
      ))}
      {closing && <CloseYearDialog year={closing} onClose={() => setClosing(null)}
        onDone={async (text) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") }); setClosing(null); setMessage(text); }} />}
    </div>
  );
}

function CloseYearDialog({ year, onClose, onDone }: { year: CloseYear; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Close ${year.name}`}
      description="The year's profit or loss moves to retained earnings in a closing entry dated the last day, and every month of the year is locked. A closed year isn't reopened.">
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <TextArea label="Note" value={note} onChange={setNote} maxLength={1000} placeholder="Accounts approved by the board on …" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isLoading={busy} onPress={async () => {
            setBusy(true); setFailure(null);
            try { await closeYear(year.id, note.trim() || undefined); await onDone(`${year.name} is closed.`); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
          }}>Close the year</Button>
        </div>
      </div>
    </Dialog>
  );
}
