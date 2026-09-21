"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, IconButton, MetricStrip, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { RefreshCw } from "lucide-react";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { money, toNumber } from "@/features/crm/shared/format";
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
        description="Open pipeline, weighted pipeline and won revenue by owner. A sales manager sees their own deals plus their active team's — not the whole organization, unless they hold the broader records permission."
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
        <TextField aria-label="From date" label="From" placeholder="YYYY-MM-DD" value={from} onChange={setFrom} />
        <TextField aria-label="To date" label="To" placeholder="YYYY-MM-DD" value={to} onChange={setTo} />
        <Button variant="secondary" onPress={() => setAppliedFilters({ from: from || undefined, to: to || undefined })}>
          Apply
        </Button>
      </div>

      <MetricStrip
        metrics={[
          { label: "Total pipeline", value: money(null, totals.pipeline) },
          { label: "Total weighted pipeline", value: money(null, totals.weighted) },
          { label: "Total won", value: money(null, totals.won) },
        ]}
      />

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">By owner</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted">No open or won opportunities in scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="py-1.5 font-medium">Owner</th>
                  <th className="py-1.5 font-medium">Pipeline</th>
                  <th className="py-1.5 font-medium">Best case</th>
                  <th className="py-1.5 font-medium">Commit</th>
                  <th className="py-1.5 font-medium">Weighted</th>
                  <th className="py-1.5 font-medium">Won</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.owner} className="border-b border-border last:border-0">
                    <td className="py-1.5 text-text">
                      {row.ownerUserId ? (
                        <button type="button" className="text-left hover:underline" onClick={() => router.push(`/crm/opportunities?ownerId=${row.ownerUserId}`)}>
                          {row.owner}
                        </button>
                      ) : (
                        row.owner
                      )}
                    </td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.pipeline)}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.bestCase)}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.commitAmount)}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.weighted)}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.won)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TeamReviewSection canReview={canManageOpportunities} />
      <CalibrationSection canView={canManageOpportunities} />

      <PeriodsDialog isOpen={periodsDialogOpen} onOpenChange={setPeriodsDialogOpen} />
    </div>
  );
}

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
  const periodOptions: SelectOption[] = periods.map((period) => ({ value: period.id, label: `${period.name} (${period.periodStart} – ${period.periodEnd})${period.status === "frozen" ? " · frozen" : ""}` }));
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
  if (periods.length === 0) return <p className="text-sm text-text-muted">No open forecast period to submit against yet.</p>;

  const isClosed = selectedPeriod?.status === "closed";
  const isReadOnly = isClosed || (mine && !["draft", "rejected"].includes(mine.status));
  const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { draft: "neutral", submitted: "info", approved: "success", rejected: "danger", superseded: "neutral" };

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">My forecast submission</h2>
        {mine && <StatusBadge tone={statusTone[mine.status] ?? "neutral"}>{mine.status}</StatusBadge>}
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {isClosed && <p className="text-sm text-text-muted">This forecast period is closed. Submissions are read-only.</p>}
      <Select label="Period" options={periodOptions} selectedKey={periodId} onSelectionChange={(key) => setPeriodId(String(key ?? ""))} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Pipeline" value={pipelineAmount} onChange={setPipelineAmount} isDisabled={isReadOnly} />
        <TextField label="Best case" value={bestCaseAmount} onChange={setBestCaseAmount} isDisabled={isReadOnly} />
        <TextField label="Commit" value={commitAmount} onChange={setCommitAmount} isDisabled={isReadOnly} />
      </div>
      <TextField label="Confidence %" placeholder="Optional" value={confidencePercent} onChange={setConfidencePercent} isDisabled={isReadOnly} />
      <TextArea label="Notes" value={notes} onChange={setNotes} isDisabled={isReadOnly} />
      {mine?.managerAdjustment != null && toNumber(mine.managerAdjustment) !== 0 && (
        <p className="text-sm text-text-secondary">Manager adjustment on record: {money(mine.currencyCode, mine.managerAdjustment)}</p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="compact" onPress={() => submitMutation.mutate()} isLoading={submitMutation.isPending} isDisabled={isReadOnly}>
          {mine ? "Save draft" : "Save as draft"}
        </Button>
        {mine && ["draft", "rejected"].includes(mine.status) && !isClosed && (
          <Button variant="secondary" size="compact" onPress={() => submitForReviewMutation.mutate()} isLoading={submitForReviewMutation.isPending}>
            Submit for review
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
        <ul className="flex flex-col gap-1">
          {periods.map((period) => (
            <li key={period.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
              <span className="text-text">{period.name} ({period.periodStart} – {period.periodEnd})</span>
              <StatusBadge tone={period.status === "open" ? "success" : period.status === "closed" ? "neutral" : "info"}>{period.status}</StatusBadge>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-3">
          <TextField label="Name" isRequired value={name} onChange={setName} />
          <Select
            label="Period type"
            options={[
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
            selectedKey={periodType}
            onSelectionChange={(key) => setPeriodType(String(key ?? "quarter"))}
          />
          <div className="flex gap-3">
            <TextField label="Start" placeholder="YYYY-MM-DD" value={periodStart} onChange={setPeriodStart} />
            <TextField label="End" placeholder="YYYY-MM-DD" value={periodEnd} onChange={setPeriodEnd} />
          </div>
          <Button variant="secondary" size="compact" className="self-start" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !periodStart || !periodEnd}>
            Create period
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
  const periodOptions: SelectOption[] = periods.map((period) => ({ value: period.id, label: `${period.name} (${period.periodStart} – ${period.periodEnd})` }));

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
        <h2 className="text-sm font-semibold text-text">Team review</h2>
        <Select aria-label="Period" size="compact" options={periodOptions} selectedKey={periodId} onSelectionChange={(key) => setPeriodId(String(key ?? ""))} />
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {reviewable.length === 0 ? (
        <p className="text-sm text-text-muted">No team submissions to review for this period.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reviewable.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">{userName(row.ownerUserId)}</span>
                <StatusBadge tone={REVIEW_STATUS_TONE[row.status] ?? "neutral"}>{row.status}</StatusBadge>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-text-muted">
                <span>Pipeline: {money(row.currencyCode, row.pipelineAmount ?? 0)}</span>
                <span>Best case: {money(row.currencyCode, row.bestCaseAmount ?? 0)}</span>
                <span>Commit: {money(row.currencyCode, row.commitAmount ?? 0)}</span>
                {row.confidencePercent != null && <span>Confidence: {toNumber(row.confidencePercent)}%</span>}
              </div>
              {row.notes && <p className="text-sm text-text-secondary">{row.notes}</p>}
              <div className="flex flex-wrap items-end gap-2">
                <TextField
                  label="Manager adjustment"
                  size="compact"
                  className="w-40"
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
                    <Button variant="danger" size="compact" onPress={() => reviewMutation.mutate({ row, status: "rejected" })} isLoading={reviewMutation.isPending}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// F025 Stage A2 §11 — accuracy/backtesting (getForecastCalibration) and
// predictive confidence (capturePredictiveForecast) already existed,
// fully built and tested, with zero frontend consumer.
function CalibrationSection({ canView }: { canView: boolean }) {
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
        <h2 className="text-sm font-semibold text-text">Forecast accuracy &amp; predictions</h2>
        <IconButton aria-label="Capture a new predictive forecast" size="compact" variant="outline" onPress={() => captureMutation.mutate()} isDisabled={captureMutation.isPending}>
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
            Predicted: <strong>{money(null, latestPrediction.forecast.predictedAmount)}</strong> from{" "}
            {money(null, latestPrediction.forecast.pipelineAmount)} open pipeline · Confidence: {latestPrediction.forecast.confidence}% ·
            Model {latestPrediction.forecast.modelVersion} ({latestPrediction.forecast.opportunityCount} open deals)
          </p>
        </div>
      )}
      <p className="text-xs text-text-muted">Backtesting: predicted amount vs. actual won revenue for each closed period.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No closed periods with a captured prediction yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-1.5 font-medium">Period</th>
                <th className="py-1.5 font-medium">Predicted</th>
                <th className="py-1.5 font-medium">Actual won</th>
                <th className="py-1.5 font-medium">Error</th>
                <th className="py-1.5 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.periodId} className="border-b border-border last:border-0">
                  <td className="py-1.5 text-text">{row.periodName}</td>
                  <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.predictedAmount)}</td>
                  <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.actualWonAmount)}</td>
                  <td className={`py-1.5 tabular-nums ${toNumber(row.errorAmount) < 0 ? "text-danger" : "text-success"}`}>
                    {money(null, row.errorAmount)} {row.errorPercent != null ? `(${toNumber(row.errorPercent)}%)` : ""}
                  </td>
                  <td className="py-1.5 tabular-nums text-text-muted">{toNumber(row.confidencePercent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
