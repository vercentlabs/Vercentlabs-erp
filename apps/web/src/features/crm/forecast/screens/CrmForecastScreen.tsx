"use client";

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  Dialog,
  ErrorState,
  MetricStrip,
  PageHeader,
  PermissionState,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  humanize,
} from "@/shared/format/human";
import {
  captureForecastSnapshot,
  CrmForecastApiError,
  getForecastSnapshot,
  getForecastWorkspace,
  getGovernedForecastAccuracy,
  listForecastPeriods,
  listGovernedSubmissionEvents,
  reviewGovernedForecast,
  setForecastPeriodStatus,
  submitGovernedForecast,
  type ForecastOwnerRow,
  type ForecastTeamNode,
  type ForecastWorkspace,
} from "../api/forecast-api";
import { DateRangeForecast } from "../components/DateRangeForecast";
import { PeriodsDialog } from "../components/PeriodsDialog";
import { PredictiveCalibration } from "../components/PredictiveCalibration";

const SUBMISSION_TONE = {
  submitted: "info",
  approved: "success",
  rejected: "danger",
  draft: "neutral",
  superseded: "neutral",
} as const;

const SUBMISSION_LABEL: Record<string, string> = {
  submitted: "Waiting for review",
  approved: "Approved",
  rejected: "Sent back",
  draft: "Draft",
};

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

const num = (value: string | number | null | undefined) => Number(value ?? 0);

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

function MySubmission({
  data,
  onSaved,
}: {
  data: ForecastWorkspace;
  onSaved: () => void;
}) {
  const workspace = useWorkspaceContext();
  const mine = data.owners.find(
    (owner) => owner.ownerUserId === workspace.userId,
  );
  const submission = mine?.submission ?? null;
  const [commit, setCommit] = useState(
    String(
      submission ? num(submission.commitAmount) : (mine?.figures.commit ?? 0),
    ),
  );
  const [bestCase, setBestCase] = useState(
    String(
      submission
        ? num(submission.bestCaseAmount)
        : (mine?.figures.bestCase ?? 0),
    ),
  );
  const [notes, setNotes] = useState(submission?.notes ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      submitGovernedForecast({
        periodId: data.period.id,
        commitAmount: Number(commit),
        bestCaseAmount: Number(bestCase),
        notes,
        expectedVersion: submission?.version,
      }),
    onSuccess: onSaved,
  });
  const currency = data.reportingCurrency;
  return (
    <section
      aria-label="My forecast"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">My forecast</h2>
        {submission ? (
          <StatusBadge tone={SUBMISSION_TONE[submission.status] ?? "neutral"}>
            {SUBMISSION_LABEL[submission.status] ?? humanize(submission.status)}
          </StatusBadge>
        ) : (
          <span className="text-xs text-text-muted">Not submitted yet</span>
        )}
      </div>
      <p className="text-sm text-text-secondary">
        {`From your deals closing in this period: commit ${formatMoney(currency, mine?.figures.commit ?? 0)}, best case ${formatMoney(currency, mine?.figures.bestCase ?? 0)}, pipeline ${formatMoney(currency, mine?.figures.pipeline ?? 0)}.`}
        {submission && num(submission.managerAdjustment) !== 0
          ? ` Your manager adjusted your commit by ${formatMoney(currency, submission.managerAdjustment)}: ${submission.adjustmentReason ?? ""}`
          : ""}
      </p>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <TextField
          label="Commit"
          type="number"
          inputMode="decimal"
          value={commit}
          onChange={setCommit}
          isRequired
        />
        <TextField
          label="Best case"
          type="number"
          inputMode="decimal"
          value={bestCase}
          onChange={setBestCase}
          isRequired
        />
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={2} />
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger sm:col-span-3">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="sm:col-span-3">
          <Button
            type="submit"
            variant="primary"
            isLoading={mutation.isPending}
          >
            {submission ? "Resubmit" : "Submit forecast"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ForecastRollupTable({
  data,
  onReview,
  onHistory,
}: {
  data: ForecastWorkspace;
  onReview: (owner: ForecastOwnerRow) => void;
  onHistory: (owner: ForecastOwnerRow) => void;
}) {
  const currency = data.reportingCurrency;
  const canReview = (owner: ForecastOwnerRow) =>
    data.permissions.review &&
    owner.submission &&
    owner.submission.status !== "draft" &&
    (data.permissions.reviewableOwners === "all" ||
      data.permissions.reviewableOwners.includes(String(owner.ownerUserId)));
  const ownerRow = (owner: ForecastOwnerRow, depth: number) => (
    <TableRow
      key={`owner-${owner.ownerUserId ?? "none"}`}
      className="border-t border-border"
    >
      <TableCell
        className="py-2 pr-3"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {owner.ownerName}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.commit)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {owner.submission
          ? formatMoney(currency, owner.submission.commitAmount)
          : "—"}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {owner.submission && num(owner.submission.managerAdjustment) !== 0
          ? formatMoney(currency, owner.submission.managerAdjustment)
          : "—"}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right font-medium tabular-nums">
        {formatMoney(currency, owner.adjustedCommit)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.bestCase)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.pipeline)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.won)}
      </TableCell>
      <TableCell className="py-2 pr-3">
        {owner.submission ? (
          <StatusBadge
            tone={SUBMISSION_TONE[owner.submission.status] ?? "neutral"}
          >
            {SUBMISSION_LABEL[owner.submission.status] ??
              humanize(owner.submission.status)}
          </StatusBadge>
        ) : (
          <span className="text-xs text-text-muted">Not submitted</span>
        )}
      </TableCell>
      <TableCell className="py-2">
        <div className="flex gap-1">
          {canReview(owner) && (
            <Button
              size="compact"
              variant="secondary"
              onPress={() => onReview(owner)}
              aria-label={`Review ${owner.ownerName}'s forecast`}
            >
              Review
            </Button>
          )}
          {owner.submission && (
            <Button
              size="compact"
              variant="ghost"
              onPress={() => onHistory(owner)}
              aria-label={`History of ${owner.ownerName}'s forecast`}
            >
              History
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
  const teamRows = (node: ForecastTeamNode, depth: number): React.ReactNode => (
    <Fragment key={`team-${node.id}`}>
      <TableRow className="border-t border-border bg-surface-muted">
        <TableCell
          className="py-2 pr-3 font-semibold"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {node.name}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.commit)}
        </TableCell>
        <TableCell className="py-2 pr-3" />
        <TableCell className="py-2 pr-3" />
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.adjustedCommit)}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.bestCase)}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.pipeline)}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.won)}
        </TableCell>
        <TableCell className="py-2 pr-3" />
        <TableCell className="py-2" />
      </TableRow>
      {node.owners.map((owner) => ownerRow(owner, depth + 1))}
      {node.children.map((child) => teamRows(child, depth + 1))}
    </Fragment>
  );
  return (
    <section
      aria-label="Forecast by team and seller"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">By team and seller</h2>
        <span className="text-xs text-text-muted">
          Each seller counts once, in their current team; team rows include
          sub-teams.
        </span>
      </div>
      <Table caption="Forecast by team and seller">
        <TableHead>
          <TableRow>
            <TableHeaderCell className="pr-3 text-left">
              Team / seller
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Commit (system)
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Submitted
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Adjustment
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Commit
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Best case
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Pipeline
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">Won</TableHeaderCell>
            <TableHeaderCell className="pr-3 text-left">Status</TableHeaderCell>
            <TableHeaderCell className="text-left">
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.rollup.teams.map((node) => teamRows(node, 0))}
          {data.rollup.unattributed.owners.length > 0 && (
            <>
              <TableRow className="border-t border-border bg-surface-muted">
                <TableCell className="py-2 pr-3 font-semibold" colSpan={10}>
                  Not in a team
                </TableCell>
              </TableRow>
              {data.rollup.unattributed.owners.map((owner) =>
                ownerRow(owner, 1),
              )}
            </>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function ReviewDialog({
  owner,
  currency,
  onClose,
  onDone,
}: {
  owner: ForecastOwnerRow | null;
  currency: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [decision, setDecision] = useState<"approve" | "reject" | "adjust">(
    "approve",
  );
  const [adjustment, setAdjustment] = useState("0");
  const [reason, setReason] = useState("");
  const submission = owner?.submission;
  const mutation = useMutation({
    mutationFn: () =>
      reviewGovernedForecast(submission!.id, {
        decision,
        managerAdjustment:
          decision === "adjust" ? Number(adjustment) : undefined,
        reason,
        expectedVersion: submission!.version,
      }),
    onSuccess: () => {
      setReason("");
      onDone();
    },
  });
  return (
    <Dialog
      isOpen={owner !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={owner ? `Review ${owner.ownerName}'s forecast` : "Review forecast"}
      description={
        submission
          ? `Submitted commit ${formatMoney(currency, submission.commitAmount)}, best case ${formatMoney(currency, submission.bestCaseAmount)}. An adjustment is added to the seller's commit; their own number never changes.`
          : undefined
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Select
          label="Decision"
          options={[
            { value: "approve", label: "Approve" },
            { value: "adjust", label: "Adjust commit" },
            { value: "reject", label: "Send back" },
          ]}
          selectedKey={decision}
          onSelectionChange={(key) =>
            setDecision((key as "approve" | "reject" | "adjust") ?? "approve")
          }
        />
        {decision === "adjust" && (
          <TextField
            label="Adjustment (can be negative)"
            type="number"
            inputMode="decimal"
            value={adjustment}
            onChange={setAdjustment}
            isRequired
          />
        )}
        <TextArea
          label="Reason"
          value={reason}
          onChange={setReason}
          isRequired={decision !== "approve"}
          description="Kept in the forecast history."
        />
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={mutation.isPending}
            isDisabled={decision !== "approve" && reason.trim().length < 3}
          >
            Save review
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HistoryDialog({
  owner,
  currency,
  onClose,
}: {
  owner: ForecastOwnerRow | null;
  currency: string | null;
  onClose: () => void;
}) {
  const workspace = useWorkspaceContext();
  const submissionId = owner?.submission?.id ?? "";
  const query = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "forecast-history",
      submissionId,
    ),
    queryFn: () => listGovernedSubmissionEvents(submissionId),
    enabled: Boolean(submissionId),
  });
  return (
    <Dialog
      isOpen={owner !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        owner ? `${owner.ownerName}: forecast history` : "Forecast history"
      }
    >
      {query.isLoading ? (
        <LoadingState label="Loading history" rows={3} />
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {(query.data?.events ?? []).map((event) => (
            <li key={event.id} className="flex flex-col">
              <span className="font-medium text-text">{`${humanize(event.eventType)} by ${event.actorName ?? "someone"} · ${formatDateTime(event.createdAt)}`}</span>
              <span className="text-text-secondary">
                {`Commit ${formatMoney(currency, event.commitAmount)}`}
                {num(event.managerAdjustment) !== 0
                  ? `, adjustment ${formatMoney(currency, event.managerAdjustment)}`
                  : ""}
                {event.reason ? ` — ${event.reason}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

function SnapshotsSection({
  data,
  onOpen,
}: {
  data: ForecastWorkspace;
  onOpen: (captureId: string) => void;
}) {
  return (
    <section
      aria-label="Forecast snapshots"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Snapshots</h2>
        <span className="text-xs text-text-muted">
          Taken daily, when a period is locked or closed, and on demand. A
          snapshot never changes.
        </span>
      </div>
      {data.captures.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No snapshots for this period yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data.captures.map((capture) => (
            <li
              key={capture.id}
              className="flex flex-wrap items-center gap-3 py-2 text-sm"
            >
              <span className="font-medium text-text">
                {formatDateTime(capture.capturedAt)}
              </span>
              <StatusBadge tone="neutral">
                {humanize(capture.source)}
              </StatusBadge>
              <span className="text-text-muted">{`${capture.rowCount} rows`}</span>
              <Button
                size="compact"
                variant="ghost"
                className="ml-auto"
                onPress={() => onOpen(capture.id)}
                aria-label={`Open snapshot from ${formatDateTime(capture.capturedAt)}`}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SnapshotDialog({
  captureId,
  onClose,
}: {
  captureId: string | null;
  onClose: () => void;
}) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "forecast-snapshot",
      captureId ?? "",
    ),
    queryFn: () => getForecastSnapshot(captureId!),
    enabled: Boolean(captureId),
  });
  const snapshot = query.data?.snapshot;
  const currency = snapshot?.capture.reportingCurrency ?? null;
  return (
    <Dialog
      isOpen={captureId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="xl"
      title={
        snapshot
          ? `Snapshot · ${formatDateTime(snapshot.capture.capturedAt)}`
          : "Snapshot"
      }
      description={
        snapshot
          ? `${humanize(snapshot.capture.source)} capture as of ${formatDate(snapshot.capture.asOf)}. Figures are exactly as captured.`
          : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState label="Loading snapshot" rows={3} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the snapshot"
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      ) : (
        <Table caption="Snapshot rows">
          <TableHead>
            <TableRow>
              <TableHeaderCell className="pr-3 text-left">
                Scope
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Commit
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Adjusted commit
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Best case
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">
                Pipeline
              </TableHeaderCell>
              <TableHeaderCell className="pr-3 text-right">Won</TableHeaderCell>
              <TableHeaderCell className="text-right">Deals</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(snapshot?.rows ?? []).map((row, index) => (
              <TableRow
                key={`${row.scopeType}-${row.scopeId ?? index}`}
                className="border-t border-border"
              >
                <TableCell className="py-2 pr-3">
                  {row.scopeType === "organization"
                    ? "Organisation"
                    : `${row.scopeType === "team" ? "Team" : "Seller"}: ${row.totals?.label ?? "Unassigned"}`}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.commitAmount)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.totals?.adjustedCommit)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.bestCaseAmount)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.pipelineAmount)}
                </TableCell>
                <TableCell className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(currency, row.wonAmount)}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums">
                  {row.dealCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Dialog>
  );
}

function AccuracySection({ currency }: { currency: string | null }) {
  const workspace = useWorkspaceContext();
  const [horizon, setHorizon] = useState("0");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "forecast-accuracy", horizon),
    queryFn: () => getGovernedForecastAccuracy(Number(horizon)),
  });
  const accuracy = query.data;
  return (
    <section
      aria-label="Forecast accuracy"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Accuracy</h2>
          <p className="text-xs text-text-muted">
            {accuracy?.scope.organization
              ? "Organisation forecast"
              : "Your forecast"}{" "}
            at the snapshot nearest the period start, against what actually
            closed won.
          </p>
        </div>
        <div className="w-56">
          <Select
            label="Forecast taken"
            options={[
              { value: "0", label: "At period start" },
              { value: "30", label: "Up to 30 days in" },
              { value: "60", label: "Up to 60 days in" },
            ]}
            selectedKey={horizon}
            onSelectionChange={(key) => setHorizon(String(key ?? "0"))}
          />
        </div>
      </div>
      {query.isLoading ? (
        <LoadingState label="Loading accuracy" rows={2} />
      ) : !accuracy || accuracy.periods.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Accuracy appears once a period with snapshots is closed.
        </p>
      ) : (
        <>
          <p className="text-sm text-text" role="status">
            {accuracy.calibration.meanAbsolutePercentError === null
              ? "No measurable periods yet."
              : `Over ${accuracy.calibration.periods} period(s): average miss ${accuracy.calibration.meanAbsolutePercentError}%, bias ${accuracy.calibration.meanBiasPercent}% (positive = under-forecast), ${accuracy.calibration.withinTenPercent} within 10%.`}
          </p>
          <Table caption="Forecast accuracy by period">
            <TableHead>
              <TableRow>
                <TableHeaderCell className="pr-3 text-left">
                  Period
                </TableHeaderCell>
                <TableHeaderCell className="pr-3 text-right">
                  Forecast commit
                </TableHeaderCell>
                <TableHeaderCell className="pr-3 text-right">
                  Actual won
                </TableHeaderCell>
                <TableHeaderCell className="pr-3 text-right">
                  Error
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Commit deals won
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accuracy.periods.map((row) => (
                <TableRow key={row.periodId} className="border-t border-border">
                  <TableCell className="py-2 pr-3">
                    {row.name}
                    <span className="block text-xs text-text-muted">
                      {row.capturedAsOf
                        ? `Snapshot of ${formatDate(row.capturedAsOf)}`
                        : "No snapshot"}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {row.forecastCommit === null
                      ? "—"
                      : formatMoney(currency, row.forecastCommit)}
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {formatMoney(currency, row.actualWon)}
                  </TableCell>
                  <TableCell className="py-2 pr-3 text-right tabular-nums">
                    {row.errorPercent === null
                      ? "—"
                      : `${formatMoney(currency, row.errorAmount)} (${row.errorPercent}%)`}
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">
                    {row.commitConversionPercent === null
                      ? "—"
                      : `${row.commitDealsWon}/${row.commitDeals} (${row.commitConversionPercent}%)`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}
