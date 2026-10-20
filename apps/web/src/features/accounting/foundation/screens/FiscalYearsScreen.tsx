"use client";

// Financial years and periods (Finance MVP F1): each year with its twelve monthly periods (and, optionally, a year-end adjustment period),
// each period's status and how many journals it holds. A period moves Open → Closing review here (and back); closing and locking happen
// through a close run, so a closed month can't be reopened by accident. Posting is refused in any period that isn't open.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { Button, Dialog, ErrorState, PageHeader, PermissionState, StatusBadge, Switch, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createFiscalYear, errorField, errorMessage, errorStatus, listFiscalYears, setPeriodReview, type FiscalPeriod, type FiscalYear, type PeriodStatus,
} from "../api/foundation-api";

const TONE: Record<PeriodStatus, "success" | "warning" | "neutral" | "info"> = { open: "success", soft_closed: "warning", closed: "neutral", locked: "info" };
const MEANING: Record<PeriodStatus, string> = {
  open: "Takes postings.", soft_closed: "Under review: nothing posts until it is reopened or closed.", closed: "Closed through a close run.", locked: "Locked for good.",
};

export function FiscalYearsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const mayManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.period.manage");
  const years = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "fiscal-years"), queryFn: listFiscalYears, retry: false });
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<FiscalPeriod | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });

  if (years.isLoading) return <LoadingState label="Loading financial years" rows={8} />;
  if (years.isError || !years.data) {
    if (errorStatus(years.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load financial years" description={errorMessage(years.error)} action={{ label: "Try again", onPress: () => void years.refetch() }} />;
  }
  const latest = years.data[0];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Financial Years" description="Each financial year is split into monthly periods. Entries post only into an open period; a month under closing review takes nothing until it is reopened or closed through a close run."
        primaryAction={mayManage ? <Button variant="primary" onPress={() => { setMessage(null); setAdding(true); }}><CalendarPlus className="size-4" aria-hidden="true" />{latest ? "Add next year" : "Add financial year"}</Button> : undefined} />
      {message && <Notice tone="success">{message}</Notice>}
      {years.data.length === 0 && <Notice tone="warning">No financial year yet. Add one so entries have a period to post into.</Notice>}
      {years.data.map((year) => <YearPanel key={year.id} year={year} mayManage={mayManage} onReview={(period) => { setMessage(null); setReviewing(period); }} />)}
      {adding && <AddYearDialog latest={latest ?? null} onClose={() => setAdding(false)} onDone={async (year) => { setAdding(false); setMessage(`${year.name} added with ${year.periods.length} periods.`); await refresh(); }} />}
      {reviewing && <ReviewDialog period={reviewing} onClose={() => setReviewing(null)} onDone={async (period) => {
        setReviewing(null); setMessage(period.status === "soft_closed" ? `${period.name} is in closing review. Nothing posts to it now.` : `${period.name} is open again.`); await refresh();
      }} />}
    </div>
  );
}

function YearPanel({ year, mayManage, onReview }: { year: FiscalYear; mayManage: boolean; onReview: (period: FiscalPeriod) => void }) {
  const summary = [year.counts.open && `${year.counts.open} open`, year.counts.soft_closed && `${year.counts.soft_closed} in review`, year.counts.closed && `${year.counts.closed} closed`,
    year.counts.locked && `${year.counts.locked} locked`].filter(Boolean).join(" · ");
  return (
    <Panel
      title={<span className="flex flex-wrap items-center gap-2">{year.name}{year.current && <StatusBadge tone="info">Current</StatusBadge>}</span>}
      description={`${formatDate(year.startDate)} – ${formatDate(year.endDate)}${summary ? ` · ${summary}` : ""}`}>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
        {year.periods.map((period) => {
          const today = new Date().toISOString().slice(0, 10);
          const now = period.type === "standard" && period.startDate <= today && today <= period.endDate;
          // A month is put under review once it has started; a future month has nothing to review.
          const started = period.startDate <= today;
          return (
            <li key={period.id} className={`flex flex-col gap-1.5 rounded-[var(--radius-panel)] border p-2.5 sm:p-3 ${now ? "border-brand/50 bg-brand/5" : "border-border bg-surface"}`}>
              <span className="flex flex-col-reverse items-start justify-between gap-1 sm:flex-row sm:gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text">{period.name}</span>
                  <span className={`text-xs text-text-muted tabular-nums ${period.type === "adjustment" ? "" : "hidden sm:inline"}`}>{period.type === "adjustment" ? `Adjustments on ${formatDate(period.endDate)}` : `${formatDate(period.startDate)} – ${formatDate(period.endDate)}`}</span>
                  {now && <span className="text-xs font-medium text-brand">This month</span>}
                </span>
                <StatusBadge tone={TONE[period.status] ?? "neutral"}>{period.statusLabel}</StatusBadge>
              </span>
              <span className="text-xs text-text-secondary">{period.journalCount} journal{period.journalCount === 1 ? "" : "s"}{period.status === "open" ? "" : ` · ${MEANING[period.status]}`}</span>
              {period.note && <span className="line-clamp-2 text-xs text-text-muted">“{period.note}”</span>}
              <span className="mt-auto flex flex-wrap gap-2">
                {mayManage && period.status === "open" && started && <Button size="compact" variant="secondary" onPress={() => onReview(period)}>Start review</Button>}
                {mayManage && period.status === "soft_closed" && <Button size="compact" variant="secondary" onPress={() => onReview(period)}>Reopen</Button>}
                {period.status === "soft_closed" && <Link className="self-center text-xs text-brand underline" href={`/accounting/close/${period.id}`}>Close the month</Link>}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function AddYearDialog({ latest, onClose, onDone }: { latest: FiscalYear | null; onClose: () => void; onDone: (year: FiscalYear) => Promise<void> }) {
  const [startDate, setStartDate] = useState("");
  const [adjustment, setAdjustment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const year = await createFiscalYear({ ...(latest ? {} : startDate ? { startDate } : {}), withAdjustmentPeriod: adjustment });
      if (year) await onDone(year);
    } catch (error) { setFailure(error); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={latest ? "Add the next financial year" : "Add a financial year"}
      description={latest ? `It starts the day after ${latest.name} ends and has twelve monthly periods.` : "Twelve monthly periods, starting on the first of a month."}>
      <div className="flex flex-col gap-3">
        {Boolean(failure) && !errorField(failure) && <Notice tone="danger">{errorMessage(failure)}</Notice>}
        {!latest && <TextField label="First day" type="date" value={startDate} onChange={setStartDate} errorMessage={errorField(failure) === "startDate" ? errorMessage(failure) : undefined}
          description="Leave empty to use the company's financial year start (1 April unless set otherwise)." />}
        {latest && Boolean(failure) && errorField(failure) && <Notice tone="danger">{errorMessage(failure)}</Notice>}
        <Switch isSelected={adjustment} onChange={setAdjustment}>Add a year-end adjustment period (for audit and closing entries after the last month is closed)</Switch>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} onPress={save}>Add year</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReviewDialog({ period, onClose, onDone }: { period: FiscalPeriod; onClose: () => void; onDone: (period: FiscalPeriod) => Promise<void> }) {
  const review = period.status === "open";
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setFailure(null);
    try { await onDone(await setPeriodReview(period.id, review, note.trim() || undefined)); } catch (error) { setFailure(error); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={review ? `Start closing review of ${period.name}` : `Reopen ${period.name}`}
      description={review ? "While under review nothing posts to this month: invoices, bills, payments and journals dated in it are refused until it is reopened or closed."
        : "Entries dated in this month will post again."}>
      <div className="flex flex-col gap-3">
        {Boolean(failure) && <Notice tone="danger">{errorMessage(failure)}</Notice>}
        <TextArea label="Note" value={note} onChange={setNote} description="Optional. Kept in the period's history." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} onPress={save}>{review ? "Start review" : "Reopen"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
