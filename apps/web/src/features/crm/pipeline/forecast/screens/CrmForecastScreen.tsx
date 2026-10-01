"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  ErrorState,
  MetricStrip,
  PageHeader,
  PermissionState,
  Select,
  StatusBadge,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, formatMoney, humanize } from "@/shared/format/human";
import {
  captureForecastSnapshot,
  CrmForecastApiError,
  getForecastWorkspace,
  listForecastPeriods,
  setForecastPeriodStatus,
  type ForecastOwnerRow,
} from "../api/forecast-api";
import { DateRangeForecast } from "../components/DateRangeForecast";
import { PeriodsDialog } from "../components/PeriodsDialog";
import { PredictiveCalibration } from "../components/PredictiveCalibration";
import { MySubmission } from "../components/MySubmission";
import { ForecastRollupTable } from "../components/ForecastRollupTable";
import { ReviewDialog } from "../components/ReviewDialog";
import { HistoryDialog } from "../components/HistoryDialog";
import { SnapshotsSection } from "../components/SnapshotsSection";
import { SnapshotDialog } from "../components/SnapshotDialog";
import { AccuracySection } from "../components/AccuracySection";

const PERIOD_ACTIONS: Record<
  string,
  Array<{ status: string; label: string; confirm: string }>
> = {
  planned: [
    {
      status: "open",
      label: "Open period",
      confirm: "Sellers can submit forecasts once the period is open.",
    },
  ],
  open: [
    {
      status: "frozen",
      label: "Lock period",
      confirm:
        "Locking takes a snapshot and stops all submissions and reviews until the period is reopened.",
    },
  ],
  frozen: [
    {
      status: "open",
      label: "Reopen",
      confirm: "Sellers and managers can change forecasts again.",
    },
    {
      status: "closed",
      label: "Close period",
      confirm:
        "Closing takes a final snapshot. A closed period can never be reopened or changed.",
    },
  ],
  closed: [],
};

// F025 Sales forecast: live figures from the canonical pipeline metrics,
// sellers' submissions, manager review and adjustment, the team rollup,
// immutable snapshots and accuracy against what actually closed.
export function CrmForecastScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(
    CRM_PERMISSIONS.forecastManage,
  );
  const periodsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"),
    queryFn: () => listForecastPeriods(),
  });
  const periods = useMemo(
    () => periodsQuery.data?.rows ?? [],
    [periodsQuery.data],
  );
  // The chosen period, else the one covering today, else the first.
  const [chosenPeriodId, setPeriodId] = useState<string>("");
  const periodId = useMemo(() => {
    if (chosenPeriodId) return chosenPeriodId;
    const today = new Date().toISOString().slice(0, 10);
    const current =
      periods.find(
        (period) =>
          String(period.periodStart).slice(0, 10) <= today &&
          String(period.periodEnd).slice(0, 10) >= today,
      ) ?? periods[0];
    return current ? String(current.id) : "";
  }, [chosenPeriodId, periods]);

  const forecastKey = scopedQueryKey(workspace, "crm", "forecast", periodId);
  const forecastQuery = useQuery({
    queryKey: forecastKey,
    queryFn: () => getForecastWorkspace(periodId),
    enabled: Boolean(periodId),
  });
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ForecastOwnerRow | null>(null);
  const [historyFor, setHistoryFor] = useState<ForecastOwnerRow | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{
    status: string;
    label: string;
    confirm: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: forecastKey });
  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      setForecastPeriodStatus(
        periodId,
        status,
        forecastQuery.data?.period.updatedAt,
      ),
    onSuccess: () => {
      setPendingStatus(null);
      setNotice(null);
      refresh();
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "forecast-periods"),
      });
    },
    onError: (error) => {
      setPendingStatus(null);
      setNotice((error as Error).message);
    },
  });
  const snapshotMutation = useMutation({
    mutationFn: () => captureForecastSnapshot(periodId, crypto.randomUUID()),
    onSuccess: () => refresh(),
    onError: (error) => setNotice((error as Error).message),
  });

  if (periodsQuery.isLoading)
    return (
      <LoadingState
        label="Loading forecast periods"
        rows={3}
        onRetry={() => periodsQuery.refetch()}
      />
    );
  if (periodsQuery.isError) {
    if (
      periodsQuery.error instanceof CrmForecastApiError &&
      periodsQuery.error.status === 403
    )
      return (
        <PermissionState title="You don't have access to the CRM forecast" />
      );
    return (
      <ErrorState
        title="Could not load the forecast"
        action={{ label: "Retry", onPress: () => periodsQuery.refetch() }}
      />
    );
  }

  const data = forecastQuery.data;
  const currency = data?.reportingCurrency ?? null;
  const money = (value: number | string | null | undefined) =>
    formatMoney(currency, value ?? 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Forecast"
        description="Commit, best case and pipeline for a period, rolled up by team, with sellers' submissions and managers' adjustments. Amounts are in the reporting currency."
        secondaryActions={
          canManage ? (
            <Button variant="secondary" onPress={() => setPeriodsOpen(true)}>
              Periods
            </Button>
          ) : undefined
        }
      />

      {periods.length === 0 ? (
        <p className="text-sm text-text-secondary">
          {canManage
            ? "No forecast periods yet. Create one under Periods."
            : "No forecast periods yet. Ask a forecast administrator to create one."}
        </p>
      ) : (
        <section
          aria-label="Forecast period"
          className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <div className="w-64">
            <Select
              label="Period"
              options={periods.map((period) => ({
                value: String(period.id),
                label: `${period.name} · ${humanize(period.status)}`,
              }))}
              selectedKey={periodId}
              onSelectionChange={(key) => setPeriodId(String(key ?? ""))}
            />
          </div>
          {data && (
            <>
              <span className="text-sm text-text-secondary">{`${formatDate(data.period.periodStart)} – ${formatDate(data.period.periodEnd)}`}</span>
              <StatusBadge
                tone={
                  data.period.status === "open"
                    ? "success"
                    : data.period.status === "closed"
                      ? "neutral"
                      : "warning"
                }
              >
                {humanize(data.period.status)}
              </StatusBadge>
              {data.permissions.manage && (
                <div className="ml-auto flex flex-wrap gap-2">
                  {(PERIOD_ACTIONS[data.period.status] ?? []).map((action) => (
                    <Button
                      key={action.status}
                      variant={
                        action.status === "closed" ? "danger" : "secondary"
                      }
                      onPress={() => setPendingStatus(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                  <Button
                    variant="secondary"
                    onPress={() => snapshotMutation.mutate()}
                    isLoading={snapshotMutation.isPending}
                  >
                    Take snapshot
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {notice && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {notice}
        </p>
      )}

      {periodId && forecastQuery.isLoading && (
        <LoadingState label="Loading forecast" rows={4} />
      )}
      {forecastQuery.isError && (
        <ErrorState
          title="Could not load this period"
          action={{ label: "Retry", onPress: () => forecastQuery.refetch() }}
        />
      )}

      {data && (
        <>
          <MetricStrip
            metrics={[
              {
                label: "Commit (system)",
                value: money(data.rollup.total.figures.commit),
              },
              {
                label: "Commit (submitted + adjustments)",
                value: money(data.rollup.total.adjustedCommit),
              },
              {
                label: "Best case",
                value: money(data.rollup.total.figures.bestCase),
              },
              {
                label: "Pipeline",
                value: money(data.rollup.total.figures.pipeline),
              },
              {
                label: "Weighted",
                value: money(data.rollup.total.figures.weighted),
              },
              { label: "Won", value: money(data.rollup.total.figures.won) },
            ]}
          />

          {data.permissions.submit && (
            <MySubmission data={data} onSaved={refresh} />
          )}

          <ForecastRollupTable
            data={data}
            onReview={(owner) => setReviewing(owner)}
            onHistory={(owner) => setHistoryFor(owner)}
          />

          <SnapshotsSection data={data} onOpen={setSnapshotId} />
          <AccuracySection currency={currency} />
          {canManage && <PredictiveCalibration canView currency={currency} />}
        </>
      )}

      <DateRangeForecast currency={currency} />

      <PeriodsDialog isOpen={periodsOpen} onOpenChange={setPeriodsOpen} />
      {pendingStatus && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPendingStatus(null);
          }}
          title={pendingStatus.label}
          description={pendingStatus.confirm}
          tone={pendingStatus.status === "closed" ? "danger" : "primary"}
          confirmLabel={pendingStatus.label}
          onConfirm={() => statusMutation.mutate(pendingStatus.status)}
          isConfirming={statusMutation.isPending}
        />
      )}
      <ReviewDialog
        owner={reviewing}
        currency={currency}
        onClose={() => setReviewing(null)}
        onDone={() => {
          setReviewing(null);
          refresh();
        }}
      />
      <HistoryDialog
        owner={historyFor}
        currency={currency}
        onClose={() => setHistoryFor(null)}
      />
      <SnapshotDialog
        captureId={snapshotId}
        onClose={() => setSnapshotId(null)}
      />
    </div>
  );
}
