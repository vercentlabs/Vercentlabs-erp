"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, Dialog, ErrorState, IconButton, MetricStrip, PageHeader, PermissionState, Select, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { RefreshCw } from "lucide-react";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { toNumber } from "@/features/crm/shared/format";
import { formatDate, formatMoney, humanize } from "@/features/crm/shared/human";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import {
  capturePredictiveSnapshot,
  createForecastPeriod,
  createForecastSubmission,
  CrmForecastApiError,
  getCrmForecast,
  getForecastCalibration,
  listForecastPeriods,
  listForecastSubmissions,
  updateForecastSubmission,
} from "../api/forecast-api";
import type { ForecastPeriod, ForecastSubmission, PredictiveForecastResult } from "../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Waiting for review",
  approved: "Approved",
  rejected: "Sent back",
  superseded: "Replaced",
  planned: "Not started",
  open: "Open",
  frozen: "Frozen",
  closed: "Closed",
};
const statusLabel = (value: string) => STATUS_LABEL[value] ?? humanize(value);
const rangeLabel = (start: string, end: string) => formatDate(start) + " to " + formatDate(end);

// F025 — every forecast amount opens the exact deals behind it: open
// pipeline/weighted by expected close date, best case and commit by
// forecast category, won by the date it was won. The list's total always
// equals the figure (same owner, dates and category predicates).
function forecastHref(ownerUserId: string | null, kind: "pipeline" | "best_case" | "committed" | "won", range: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  params.set("ownerId", ownerUserId ?? "unassigned");
  if (kind === "won") {
    params.set("status", "won");
    if (range.from) params.set("closedFrom", range.from);
    if (range.to) params.set("closedTo", range.to);
  } else {
    params.set("status", "open");
    if (range.from) params.set("expectedCloseFrom", range.from);
    if (range.to) params.set("expectedCloseTo", range.to);
    if (kind !== "pipeline") params.set("forecastCategory", kind);
  }
  return `/crm/opportunities?${params.toString()}`;
}

function AmountLink({ href, children, label }: { href: string; children: string; label: string }) {
  const router = useRouter();
  return (
    <button type="button" className="tabular-nums text-text-secondary underline-offset-2 hover:text-brand hover:underline" aria-label={label} onClick={() => router.push(href)}>
      {children}
    </button>
  );
}

export function CrmForecastScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canManageSettings = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const canManageOpportunities = workspace.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);
  const [periodsDialogOpen, setPeriodsDialogOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<{ from?: string; to?: string }>({});

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast", appliedFilters),
    queryFn: () => getCrmForecast(appliedFilters),
  });

  const rows = useMemo(() => query.data?.report.rows ?? [], [query.data]);
  const periodsForCurrency = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"), queryFn: listForecastPeriods });
  const currency = useMemo(() => (periodsForCurrency.data?.rows ?? []).find((p) => p.currencyCode)?.currencyCode ?? null, [periodsForCurrency.data]);
  const rangeInvalid = Boolean(from && to && to < from);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          pipeline: acc.pipeline + toNumber(row.pipeline),
          weighted: acc.weighted + toNumber(row.weighted),
          won: acc.won + toNumber(row.won),
        }),
        { pipeline: 0, weighted: 0, won: 0 },
      ),
    [rows],
  );

  if (query.isLoading) return <LoadingState label="Loading forecast" rows={3} />;
  if (query.isError) {
    if (query.error instanceof CrmForecastApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to the CRM forecast" />;
    }
    return <ErrorState title="Could not load the forecast" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Forecast"
        description="What is open, what it is likely to be worth, and what has been won, by owner. Managers see their own deals and their team's; wider access needs the broader records permission."
        primaryAction={
          canManageSettings ? (
            <Button variant="secondary" onPress={() => setPeriodsDialogOpen(true)}>
              Manage forecast periods
            </Button>
          ) : undefined
        }
      />

      <MySubmissionSection canSubmit={canManageOpportunities} />

      <div className="flex flex-wrap items-end gap-2">
        <p className="basis-full text-xs text-text-muted">Open deals count by their expected close date; won deals by the date they were won.</p>
        <DateInput label="Expected to close from" value={from} onChange={setFrom} />
        <DateInput label="Expected to close until" value={to} onChange={setTo} errorMessage={rangeInvalid ? "The end date is before the start date." : undefined} />
        <Button variant="secondary" isDisabled={rangeInvalid} onPress={() => setAppliedFilters({ from: from || undefined, to: to || undefined })}>
          Show these dates
        </Button>
        {(appliedFilters.from || appliedFilters.to) && (
          <Button variant="ghost" onPress={() => { setFrom(""); setTo(""); setAppliedFilters({}); }}>
            Clear dates
          </Button>
        )}
      </div>
      {(appliedFilters.from || appliedFilters.to) && (
        <p role="status" className="text-sm text-text-secondary">
          {"Showing deals expected to close " + (appliedFilters.from ? "from " + formatDate(appliedFilters.from) + " " : "") + (appliedFilters.to ? "until " + formatDate(appliedFilters.to) : "")}
        </p>
      )}
      {currency && <p className="text-xs text-text-muted">{"All amounts are in " + currency + "."}</p>}

      <MetricStrip
        metrics={[
          { label: "Open pipeline", value: formatMoney(currency, totals.pipeline, { compact: true }) },
          { label: "Weighted by probability", value: formatMoney(currency, totals.weighted, { compact: true }) },
          { label: "Won", value: formatMoney(currency, totals.won, { compact: true }) },
        ]}
      />

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">By owner</h2>
        <p className="text-xs text-text-muted">
          Best case adds deals that could close. Commit is what the owner is confident will close. Weighted multiplies each open deal by its chance of winning.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {appliedFilters.from || appliedFilters.to ? "No open or won deals expected in these dates. Try a wider range." : "There are no open or won deals you can see yet. Deals appear here once they are created and given an expected close date."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-sm">
              <caption className="sr-only">Forecast amounts by deal owner</caption>
              <TableHead>
                <TableRow className="border-b border-border text-left text-xs text-text-muted">
                  <TableHeaderCell scope="col" className="py-1.5 font-medium">Owner</TableHeaderCell>
                  <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Open pipeline</TableHeaderCell>
                  <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Best case</TableHeaderCell>
                  <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Commit</TableHeaderCell>
                  <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Weighted</TableHeaderCell>
                  <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Won</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.owner} className="border-b border-border last:border-0">
                    <TableCell className="py-1.5 text-text">
                      {row.ownerUserId ? (
                        <button type="button" className="text-left text-brand underline-offset-2 hover:underline" title="See this owner's open deals in this range" onClick={() => router.push(forecastHref(row.ownerUserId, "pipeline", appliedFilters))}>
                          {row.owner}
                        </button>
                      ) : (
                        row.owner
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right"><AmountLink href={forecastHref(row.ownerUserId, "pipeline", appliedFilters)} label={`${row.owner} open pipeline`}>{formatMoney(currency, row.pipeline)}</AmountLink></TableCell>
                    <TableCell className="py-1.5 text-right"><AmountLink href={forecastHref(row.ownerUserId, "best_case", appliedFilters)} label={`${row.owner} best case deals`}>{formatMoney(currency, row.bestCase)}</AmountLink></TableCell>
                    <TableCell className="py-1.5 text-right"><AmountLink href={forecastHref(row.ownerUserId, "committed", appliedFilters)} label={`${row.owner} committed deals`}>{formatMoney(currency, row.commitAmount)}</AmountLink></TableCell>
                    <TableCell className="py-1.5 text-right"><AmountLink href={forecastHref(row.ownerUserId, "pipeline", appliedFilters)} label={`${row.owner} weighted pipeline deals`}>{formatMoney(currency, row.weighted)}</AmountLink></TableCell>
                    <TableCell className="py-1.5 text-right"><AmountLink href={forecastHref(row.ownerUserId, "won", appliedFilters)} label={`${row.owner} won deals`}>{formatMoney(currency, row.won)}</AmountLink></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <TeamReviewSection canReview={canManageOpportunities} />
      <CalibrationSection canView={canManageOpportunities} currency={currency} />

      <PeriodsDialog isOpen={periodsDialogOpen} onOpenChange={setPeriodsDialogOpen} />
    </div>
  );
}

const amountError = (value: string) => (value.trim() !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0) ? "Enter an amount of zero or more." : undefined);
const confidenceError = (value: string) => (value.trim() !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) ? "Enter a number from 0 to 100." : undefined);

function MySubmissionSection({ canSubmit }: { canSubmit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pipelineAmount, setPipelineAmount] = useState("0");
  const [bestCaseAmount, setBestCaseAmount] = useState("0");
  const [commitAmount, setCommitAmount] = useState("0");
  const [confidencePercent, setConfidencePercent] = useState("");
  const [notes, setNotes] = useState("");

  const periodsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"), queryFn: listForecastPeriods });
  // F025 Stage A2 §11 correction — this filtered on status === "active",
  // a value tenant.crm_forecast_periods' real CHECK constraint
  // (planned/open/frozen/closed) never produces, so this section always
  // rendered "No open forecast period to submit against yet." regardless
  // of real period state — a genuine, severe bug, not a style nit. Now
  // matches the same "still mutable" set resource-options.js's own
  // period picker already uses (excludes only 'closed').
  const periods = useMemo(() => (periodsQuery.data?.rows ?? []).filter((period) => ["planned", "open", "frozen"].includes(period.status)), [periodsQuery.data]);
  const periodOptions: SelectOption[] = periods.map((period) => ({ value: period.id, label: period.name + " (" + rangeLabel(period.periodStart, period.periodEnd) + ")" + (period.status === "frozen" ? ", frozen" : "") }));
  const selectedPeriod = periods.find((period) => period.id === periodId);

  const [seededPeriods, setSeededPeriods] = useState<ForecastPeriod[] | undefined>(undefined);
  if (!periodId && periods.length > 0 && periods !== seededPeriods) {
    setSeededPeriods(periods);
    setPeriodId(periods[0].id);
  }

  const submissionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-submissions", periodId, "mine"),
    queryFn: () => listForecastSubmissions(periodId),
    enabled: Boolean(periodId),
  });
  // The generic resource route already scopes reads by ownerField for a
  // caller without crm.records.view_all, so "my" submission for this
  // period is simply the one row a rep sees — a manager with the
  // broader permission would see every team member's row here instead,
  // which this section deliberately does not attempt to disambiguate
  // (manager adjustment across a team is a separate, larger UI not
  // built this pass).
  const mine = submissionsQuery.data?.rows.find((row) => row.ownerUserId === workspace.userId);

  const [seededFor, setSeededFor] = useState<ForecastSubmission | undefined>(undefined);
  if (mine && mine !== seededFor) {
    setSeededFor(mine);
    setPipelineAmount(String(toNumber(mine.pipelineAmount)));
    setBestCaseAmount(String(toNumber(mine.bestCaseAmount)));
    setCommitAmount(String(toNumber(mine.commitAmount)));
    setConfidencePercent(mine.confidencePercent !== null ? String(toNumber(mine.confidencePercent)) : "");
    setNotes(mine.notes ?? "");
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "forecast-submissions", periodId, "mine") });
  }

  // F025 — the system's own numbers for this rep and period, computed from
  // their deals exactly as the forecast table does, so a submission is a
  // visible judgement on top of the pipeline rather than a blank guess.
  const systemQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast", "mine", selectedPeriod?.periodStart, selectedPeriod?.periodEnd),
    queryFn: () => getCrmForecast({ from: selectedPeriod!.periodStart.slice(0, 10), to: selectedPeriod!.periodEnd.slice(0, 10) }),
    enabled: Boolean(selectedPeriod),
  });
  const systemRow = systemQuery.data?.report.rows.find((row) => row.ownerUserId === workspace.userId);
  const systemRange = selectedPeriod ? { from: selectedPeriod.periodStart.slice(0, 10), to: selectedPeriod.periodEnd.slice(0, 10) } : {};
  const system = {
    pipeline: toNumber(systemRow?.pipeline ?? 0),
    bestCase: toNumber(systemRow?.bestCase ?? 0),
    commit: toNumber(systemRow?.commitAmount ?? 0),
    won: toNumber(systemRow?.won ?? 0),
  };
  function useSystemNumbers() {
    setPipelineAmount(String(system.pipeline));
    setBestCaseAmount(String(system.bestCase));
    setCommitAmount(String(system.commit + system.won));
  }
  const commitGap = (Number(commitAmount) || 0) - (system.commit + system.won);

  const submitMutation = useMutation({
    mutationFn: () => {
      const input = {
        pipelineAmount: Number(pipelineAmount) || 0,
        bestCaseAmount: Number(bestCaseAmount) || 0,
        commitAmount: Number(commitAmount) || 0,
        confidencePercent: confidencePercent ? Number(confidencePercent) : null,
        notes: notes || null,
      };
      return mine ? updateForecastSubmission(mine.id, input, mine.updatedAt) : createForecastSubmission({ ...input, periodId });
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => setError(err instanceof CrmForecastApiError ? err.message : "The forecast submission could not be saved."),
  });

  // F025 Stage A2 §11 — a rep could previously only ever save a draft;
  // nothing in the UI ever called the real draft->submitted transition
  // assertLifecycleUpdate (record-policy.js) already enforces.
  const submitForReviewMutation = useMutation({
    mutationFn: () => updateForecastSubmission(mine!.id, { status: "submitted" }, mine!.updatedAt),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => setError(err instanceof CrmForecastApiError ? err.message : "This forecast could not be submitted for review."),
  });

  if (!canSubmit) return null;
  if (periodsQuery.isLoading) return null;
  if (periods.length === 0)
    return (
      <p className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm text-text-secondary">
        There is no forecast period open for your submission yet. A manager can add one with Manage forecast periods.
      </p>
    );

  const isClosed = selectedPeriod?.status === "closed";
  const isReadOnly = isClosed || (mine && !["draft", "rejected"].includes(mine.status));
  const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { draft: "neutral", submitted: "info", approved: "success", rejected: "danger", superseded: "neutral" };

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">My forecast submission</h2>
        {mine && <StatusBadge tone={statusTone[mine.status] ?? "neutral"}>{statusLabel(mine.status)}</StatusBadge>}
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-text-muted">Tell your manager what you expect to close in this period. Save a draft as often as you like, then send it for review.</p>
      {mine && mine.status === "rejected" && <p role="status" className="text-sm text-warning">Your manager sent this back. Update it and send it again.</p>}
      {mine && mine.status === "submitted" && <p role="status" className="text-sm text-text-secondary">This is with your manager for review, so it cannot be changed now.</p>}
      {isClosed && <p className="text-sm text-text-muted">This period is closed, so the submission can no longer be changed.</p>}
      <Select label="Period" options={periodOptions} selectedKey={periodId} onSelectionChange={(key) => setPeriodId(String(key ?? ""))} />
      {selectedPeriod && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3" aria-label="From your deals in this period">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">From your deals in this period</span>
            {!isReadOnly && (
              <Button variant="secondary" size="compact" onPress={useSystemNumbers} isDisabled={systemQuery.isLoading}>
                Use these numbers
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {([
              ["Open pipeline", system.pipeline, forecastHref(workspace.userId, "pipeline", systemRange)],
              ["Best case", system.bestCase, forecastHref(workspace.userId, "best_case", systemRange)],
              ["Committed", system.commit, forecastHref(workspace.userId, "committed", systemRange)],
              ["Already won", system.won, forecastHref(workspace.userId, "won", systemRange)],
            ] as const).map(([label, value, href]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd><AmountLink href={href} label={`My ${label.toLowerCase()} deals`}>{formatMoney(selectedPeriod.currencyCode, value)}</AmountLink></dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-text-muted">
            {`"Use these numbers" puts committed plus already won into Commit. `}
            {Number(commitAmount) > 0 && commitGap !== 0
              ? `Your commit is ${formatMoney(selectedPeriod.currencyCode, Math.abs(commitGap))} ${commitGap > 0 ? "above" : "below"} what your deals show — say why in the notes.`
              : ""}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Open pipeline" description="Everything still open." inputMode="decimal" value={pipelineAmount} onChange={setPipelineAmount} isDisabled={isReadOnly} errorMessage={amountError(pipelineAmount)} />
        <TextField label="Best case" description="Open deals that could close." inputMode="decimal" value={bestCaseAmount} onChange={setBestCaseAmount} isDisabled={isReadOnly} errorMessage={amountError(bestCaseAmount)} />
        <TextField label="Commit" description="Deals you are confident will close." inputMode="decimal" value={commitAmount} onChange={setCommitAmount} isDisabled={isReadOnly} errorMessage={amountError(commitAmount)} />
      </div>
      <TextField label="How confident are you (0 to 100)" description="Optional." inputMode="numeric" value={confidencePercent} onChange={setConfidencePercent} isDisabled={isReadOnly} errorMessage={confidenceError(confidencePercent)} />
      <TextArea label="Notes" value={notes} onChange={setNotes} isDisabled={isReadOnly} />
      {mine?.managerAdjustment != null && toNumber(mine.managerAdjustment) !== 0 && (
        <p className="text-sm text-text-secondary">Your manager adjusted this by {formatMoney(mine.currencyCode ?? selectedPeriod?.currencyCode, mine.managerAdjustment)}.</p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="compact" onPress={() => submitMutation.mutate()} isLoading={submitMutation.isPending} isDisabled={isReadOnly || Boolean(amountError(pipelineAmount) || amountError(bestCaseAmount) || amountError(commitAmount) || confidenceError(confidencePercent))}>
          {mine ? "Save draft" : "Save as draft"}
        </Button>
        {mine && ["draft", "rejected"].includes(mine.status) && !isClosed && (
          <Button variant="secondary" size="compact" onPress={() => submitForReviewMutation.mutate()} isLoading={submitForReviewMutation.isPending}>
            Send for review
          </Button>
        )}
      </div>
    </div>
  );
}

function PeriodsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [periodType, setPeriodType] = useState("quarter");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const dateOrderError = periodStart && periodEnd && periodEnd < periodStart ? "The end must be on or after the start." : undefined;
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"), queryFn: listForecastPeriods, enabled: isOpen });
  const periods = query.data?.rows ?? [];

  const mutation = useMutation({
    mutationFn: () => createForecastPeriod({ name, periodType, periodStart, periodEnd }),
    onSuccess: () => {
      setError(null);
      setName("");
      setPeriodStart("");
      setPeriodEnd("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "forecast-periods") });
    },
    onError: (err: unknown) => setError(err instanceof CrmForecastApiError ? err.message : "The forecast period could not be created."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Forecast periods">
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {query.isLoading && <LoadingState label="Loading periods" rows={2} onRetry={() => query.refetch()} />}
        {query.isError && <ErrorState title="Could not load periods" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        {query.isSuccess && periods.length === 0 && <p className="text-sm text-text-secondary">No forecast periods yet. Add one below so your team can submit what they expect to close.</p>}
        <ul className="flex flex-col gap-1">
          {periods.map((period) => (
            <li key={period.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
              <span className="flex flex-col">
                <span className="text-text">{period.name}</span>
                <span className="text-xs text-text-muted">{rangeLabel(period.periodStart, period.periodEnd)}</span>
              </span>
              <StatusBadge tone={period.status === "open" ? "success" : period.status === "closed" ? "neutral" : "info"}>{statusLabel(period.status)}</StatusBadge>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-3">
          <TextField label="Period name" placeholder="For example, Q3 2026" value={name} onChange={setName} />
          <Select
            label="Length of period"
            options={[
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
            selectedKey={periodType}
            onSelectionChange={(key) => setPeriodType(String(key ?? "quarter"))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateInput label="Starts on" value={periodStart} onChange={setPeriodStart} />
            <DateInput label="Ends on" value={periodEnd} onChange={setPeriodEnd} errorMessage={dateOrderError} />
          </div>
          <Button variant="secondary" size="compact" className="self-start" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !periodStart || !periodEnd || Boolean(dateOrderError)}>
            Add period
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

const REVIEW_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  superseded: "neutral",
};

// F025 Stage A2 §11 — the dossier's "manager review"/"manager adjustment"
// requirement. Reads exactly the same listForecastSubmissions(periodId)
// query MySubmissionSection uses; the ONLY reason a manager now sees
// their reports' rows here (instead of just their own) is the
// recordScope hierarchy fix in record-policy.js — this component adds
// no scoping logic of its own. Approve/reject/adjust call the exact same
// governed updateForecastSubmission path, which server-side (record-
// policy.js) already refuses a reviewer's self-approval/self-adjustment
// and any transition/period-closed violation — this UI only hides
// actions a reviewer could never legally take, it does not re-implement
// the rules.
function TeamReviewSection({ canReview }: { canReview: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});

  const periodsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"), queryFn: listForecastPeriods });
  const periods = useMemo(() => periodsQuery.data?.rows ?? [], [periodsQuery.data]);
  const periodOptions: SelectOption[] = periods.map((period) => ({ value: period.id, label: period.name + " (" + rangeLabel(period.periodStart, period.periodEnd) + ")" }));
  const [rejecting, setRejecting] = useState<ForecastSubmission | null>(null);

  const [seededPeriods, setSeededPeriods] = useState<ForecastPeriod[] | undefined>(undefined);
  if (!periodId && periods.length > 0 && periods !== seededPeriods) {
    setSeededPeriods(periods);
    setPeriodId(periods[0].id);
  }

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const userName = useMemo(() => {
    const byId = new Map((optionsQuery.data?.options?.users ?? []).map((row) => [String(row.id), String(row.fullName || row.name || row.id)]));
    return (userId: string) => byId.get(userId) || userId;
  }, [optionsQuery.data]);

  const submissionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-submissions", periodId, "team"),
    queryFn: () => listForecastSubmissions(periodId),
    enabled: Boolean(periodId),
  });
  const reviewable = useMemo(
    () => (submissionsQuery.data?.rows ?? []).filter((row) => row.ownerUserId && row.ownerUserId !== workspace.userId),
    [submissionsQuery.data, workspace.userId],
  );

  // F025 — who owes a forecast: owners with deals in this period (the same
  // report the forecast table uses, so the list respects what the reviewer
  // may see) who have not sent one, or have only a draft.
  const selectedPeriod = periods.find((period) => period.id === periodId);
  const periodDealsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast", "review", selectedPeriod?.periodStart, selectedPeriod?.periodEnd),
    queryFn: () => getCrmForecast({ from: selectedPeriod!.periodStart.slice(0, 10), to: selectedPeriod!.periodEnd.slice(0, 10) }),
    enabled: Boolean(selectedPeriod) && canReview,
  });
  const notSent = useMemo(() => {
    const sent = new Set((submissionsQuery.data?.rows ?? []).filter((row) => row.status !== "draft").map((row) => row.ownerUserId));
    return (periodDealsQuery.data?.report.rows ?? [])
      .filter((row) => row.ownerUserId && row.ownerUserId !== workspace.userId && !sent.has(row.ownerUserId))
      .map((row) => row.owner);
  }, [periodDealsQuery.data, submissionsQuery.data, workspace.userId]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "forecast-submissions", periodId, "team") });
  }
  function handleError(err: unknown) {
    setError(err instanceof CrmForecastApiError ? err.message : "This action could not be completed.");
  }

  const reviewMutation = useMutation({
    mutationFn: ({ row, status }: { row: ForecastSubmission; status: "approved" | "rejected" }) => updateForecastSubmission(row.id, { status }, row.updatedAt),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });
  const adjustMutation = useMutation({
    mutationFn: ({ row, amount }: { row: ForecastSubmission; amount: number }) => updateForecastSubmission(row.id, { managerAdjustment: amount }, row.updatedAt),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  if (!canReview) return null;
  if (periodsQuery.isLoading) return null;
  if (periods.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Team forecasts to review</h2>
        <Select aria-label="Period" size="compact" options={periodOptions} selectedKey={periodId} onSelectionChange={(key) => setPeriodId(String(key ?? ""))} />
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {notSent.length > 0 && (
        <p className="text-sm text-text-secondary" aria-label="Not sent yet">
          <span className="font-medium text-text">{"Haven't sent a forecast yet: "}</span>
          {notSent.join(", ")}
        </p>
      )}
      {reviewable.length === 0 ? (
        <p className="text-sm text-text-secondary">Nobody on your team has sent a forecast for this period yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reviewable.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">{userName(row.ownerUserId)}</span>
                <StatusBadge tone={REVIEW_STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-text-muted">
                <span>{"Open pipeline: " + formatMoney(row.currencyCode, row.pipelineAmount ?? 0)}</span>
                <span>{"Best case: " + formatMoney(row.currencyCode, row.bestCaseAmount ?? 0)}</span>
                <span>{"Commit: " + formatMoney(row.currencyCode, row.commitAmount ?? 0)}</span>
                {toNumber(row.managerAdjustment ?? 0) !== 0 && (
                  <span className="font-medium text-text">{"After your adjustment: " + formatMoney(row.currencyCode, toNumber(row.commitAmount ?? 0) + toNumber(row.managerAdjustment ?? 0))}</span>
                )}
                {row.confidencePercent != null && <span>{"Confidence: " + toNumber(row.confidencePercent) + "%"}</span>}
              </div>
              {row.notes && <p className="text-sm text-text-secondary">{row.notes}</p>}
              <div className="flex flex-wrap items-end gap-2">
                <TextField
                  label="Your adjustment"
                  description="Add or subtract from their number."
                  inputMode="decimal"
                  size="compact"
                  className="w-48"
                  value={adjustments[row.id] ?? (row.managerAdjustment != null ? String(toNumber(row.managerAdjustment)) : "")}
                  onChange={(value) => setAdjustments((current) => ({ ...current, [row.id]: value }))}
                />
                <Button
                  variant="secondary"
                  size="compact"
                  onPress={() => adjustMutation.mutate({ row, amount: Number(adjustments[row.id]) || 0 })}
                  isLoading={adjustMutation.isPending}
                >
                  Save adjustment
                </Button>
                {row.status === "submitted" && (
                  <>
                    <Button variant="primary" size="compact" onPress={() => reviewMutation.mutate({ row, status: "approved" })} isLoading={reviewMutation.isPending}>
                      Approve
                    </Button>
                    <Button variant="danger" size="compact" onPress={() => setRejecting(row)}>
                      Send back
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rejecting && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setRejecting(null); }}
          title={"Send " + userName(rejecting.ownerUserId) + "'s forecast back?"}
          description="They are told it needs changes and can update and send it again. Nothing is deleted."
          confirmLabel="Send back"
          isConfirming={reviewMutation.isPending}
          onConfirm={() => reviewMutation.mutate({ row: rejecting, status: "rejected" }, { onSettled: () => setRejecting(null) })}
        />
      )}
    </div>
  );
}

// F025 Stage A2 §11 — accuracy/backtesting (getForecastCalibration) and
// predictive confidence (capturePredictiveForecast) already existed,
// fully built and tested, with zero frontend consumer.
function CalibrationSection({ canView, currency }: { canView: boolean; currency: string | null }) {
  const workspace = useWorkspaceContext();
  const [error, setError] = useState<string | null>(null);
  const [latestPrediction, setLatestPrediction] = useState<PredictiveForecastResult | null>(null);

  const calibrationQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-calibration"),
    queryFn: () => getForecastCalibration(),
    enabled: canView,
  });
  const rows = calibrationQuery.data?.rows ?? [];

  const captureMutation = useMutation({
    mutationFn: () => capturePredictiveSnapshot(),
    onSuccess: (result) => {
      setError(null);
      setLatestPrediction(result);
    },
    onError: (err: unknown) => setError(err instanceof CrmForecastApiError ? err.message : "The predictive forecast could not be captured."),
  });

  if (!canView) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">How accurate past forecasts were</h2>
        <IconButton aria-label="Refresh the predicted forecast now" size="compact" variant="outline" onPress={() => captureMutation.mutate()} isDisabled={captureMutation.isPending}>
          <RefreshCw className={`size-4 ${captureMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
        </IconButton>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {latestPrediction && (
        <div className="rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm text-text">
          <p>
            {"Predicted to close: "}<strong>{formatMoney(currency, latestPrediction.forecast.predictedAmount)}</strong>
            {" out of " + formatMoney(currency, latestPrediction.forecast.pipelineAmount) + " open pipeline, across " + latestPrediction.forecast.opportunityCount + " open deals. Confidence " + latestPrediction.forecast.confidence + "%."}
          </p>
        </div>
      )}
      <p className="text-xs text-text-muted">For each closed period, what was predicted compared with what was actually won.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-secondary">Nothing to compare yet. A period needs to close, with a prediction saved during it, before its accuracy shows here.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHead>
              <TableRow className="border-b border-border text-left text-xs text-text-muted">
                <TableHeaderCell scope="col" className="py-1.5 font-medium">Period</TableHeaderCell>
                <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Predicted</TableHeaderCell>
                <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Actually won</TableHeaderCell>
                <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Difference</TableHeaderCell>
                <TableHeaderCell scope="col" className="py-1.5 text-right font-medium">Confidence</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.periodId} className="border-b border-border last:border-0">
                  <TableCell className="py-1.5 text-text">{row.periodName}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-text-secondary">{formatMoney(currency, Math.round(toNumber(row.predictedAmount)))}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-text-secondary">{formatMoney(currency, Math.round(toNumber(row.actualWonAmount)))}</TableCell>
                  <TableCell className={`py-1.5 text-right tabular-nums ${toNumber(row.errorAmount) < 0 ? "text-danger" : "text-success"}`}>
                    {/* errorAmount = won − predicted: negative means the forecast was too high. */}
                    {(toNumber(row.errorAmount) < 0 ? "Forecast too high by " : "Forecast too low by ") + formatMoney(currency, Math.round(Math.abs(toNumber(row.errorAmount))))} {row.errorPercent != null ? "(" + Math.abs(toNumber(row.errorPercent)) + "%)" : ""}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-text-secondary">{toNumber(row.confidencePercent)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
