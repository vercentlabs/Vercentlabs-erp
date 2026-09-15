"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, MetricStrip, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { money, toNumber } from "@/features/crm/shared/format";
import {
  createForecastPeriod,
  createForecastSubmission,
  CrmForecastApiError,
  getCrmForecast,
  listForecastPeriods,
  listForecastSubmissions,
  updateForecastSubmission,
} from "../api/forecast-api";
import type { ForecastPeriod, ForecastSubmission } from "../types";

export function CrmForecastScreen() {
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

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading forecast…</p>;
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
                  <th className="py-1.5 font-medium">Weighted</th>
                  <th className="py-1.5 font-medium">Won</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.owner} className="border-b border-border last:border-0">
                    <td className="py-1.5 text-text">{row.owner}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.pipeline)}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.weighted)}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(null, row.won)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  const periods = useMemo(() => (periodsQuery.data?.rows ?? []).filter((period) => period.status === "active"), [periodsQuery.data]);
  const periodOptions: SelectOption[] = periods.map((period) => ({ value: period.id, label: `${period.name} (${period.periodStart} – ${period.periodEnd})` }));

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

  if (!canSubmit) return null;
  if (periodsQuery.isLoading) return null;
  if (periods.length === 0) return <p className="text-sm text-text-muted">No open forecast period to submit against yet.</p>;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">My forecast submission</h2>
        {mine && <StatusBadge tone="success">Submitted</StatusBadge>}
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Select label="Period" options={periodOptions} selectedKey={periodId} onSelectionChange={(key) => setPeriodId(String(key ?? ""))} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Pipeline" value={pipelineAmount} onChange={setPipelineAmount} />
        <TextField label="Best case" value={bestCaseAmount} onChange={setBestCaseAmount} />
        <TextField label="Commit" value={commitAmount} onChange={setCommitAmount} />
      </div>
      <TextField label="Confidence %" placeholder="Optional" value={confidencePercent} onChange={setConfidencePercent} />
      <TextArea label="Notes" value={notes} onChange={setNotes} />
      {mine?.managerAdjustment != null && toNumber(mine.managerAdjustment) !== 0 && (
        <p className="text-sm text-text-secondary">Manager adjustment on record: {money(mine.currencyCode, mine.managerAdjustment)}</p>
      )}
      <Button variant="primary" size="compact" className="self-start" onPress={() => submitMutation.mutate()} isLoading={submitMutation.isPending}>
        {mine ? "Update submission" : "Submit forecast"}
      </Button>
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
              <StatusBadge tone={period.status === "active" ? "success" : "neutral"}>{period.status}</StatusBadge>
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
