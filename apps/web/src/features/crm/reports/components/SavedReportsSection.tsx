"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Dialog,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextField,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDateTime, humanize } from "@/shared/format/human";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  listReportRuns,
  listReportSchedules,
  listSavedReports,
  reportRunDownloadUrl,
  runSavedReport,
  saveReport,
  scheduleReport,
  setReportScheduleStatus,
  type SavedReportDefinition,
} from "../api/saved-reports-api";

const GROUP_BY = [
  { value: "stage", label: "Stage" },
  { value: "owner", label: "Owner" },
  { value: "team", label: "Sales team" },
  { value: "territory", label: "Territory" },
  { value: "source", label: "Source" },
  { value: "forecast_category", label: "Forecast category" },
  { value: "pipeline", label: "Pipeline" },
  { value: "close_month", label: "Close month" },
];

const MEASURES = [
  { value: "open_opportunities", label: "Open opportunities" },
  { value: "open_pipeline", label: "Open pipeline" },
  { value: "weighted_pipeline", label: "Weighted pipeline" },
  { value: "closing_in_period", label: "Closing in period" },
  { value: "commit", label: "Commit" },
  { value: "best_case", label: "Best case" },
  { value: "won_amount", label: "Won" },
  { value: "won_count", label: "Deals won" },
  { value: "lost_amount", label: "Lost" },
  { value: "lost_count", label: "Deals lost" },
  { value: "win_rate", label: "Win rate" },
  { value: "stalled_opportunities", label: "Stalled opportunities" },
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// F030 governed CRM reports: build a grouped analysis over the canonical
// pipeline metrics, save it, run it (a background CSV), and schedule it.
export function SavedReportsSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canSchedule =
    workspace.permissions.includes(CRM_PERMISSIONS.reportsSchedule) ||
    workspace.roleSlugs.includes("organization_owner");
  const definitions = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "saved-reports"),
    queryFn: listSavedReports,
  });
  const runs = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "report-runs"),
    queryFn: listReportRuns,
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (run) => run.status === "queued" || run.status === "running",
      )
        ? 3000
        : false,
  });
  const schedules = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "report-schedules"),
    queryFn: listReportSchedules,
  });
  const [building, setBuilding] = useState(false);
  const [scheduling, setScheduling] = useState<SavedReportDefinition | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const invalidate = () => {
    for (const key of ["saved-reports", "report-runs", "report-schedules"])
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", key),
      });
  };
  const runMutation = useMutation({
    mutationFn: (definitionId: string) => runSavedReport(definitionId),
    onSuccess: () => {
      setNotice(
        "The report is being prepared. It appears under Recent runs when ready.",
      );
      invalidate();
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "active" | "paused" | "cancelled";
    }) => setReportScheduleStatus(id, status),
    onSuccess: invalidate,
    onError: (error) => setNotice((error as Error).message),
  });

  return (
    <section
      aria-label="Saved and scheduled reports"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text">
            Saved and scheduled reports
          </h2>
          <p className="text-sm text-text-secondary">
            Pipeline analyses with the dashboard&apos;s own figures. Each
            recipient of a schedule gets a copy built with their own access.
          </p>
        </div>
        <Button variant="primary" onPress={() => setBuilding(true)}>
          New saved report
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-text">
          {notice}
        </p>
      )}

      <Table caption="Saved reports">
        <TableHead>
          <TableRow>
            <TableHeaderCell className="text-left">Report</TableHeaderCell>
            <TableHeaderCell className="text-left">Dataset</TableHeaderCell>
            <TableHeaderCell className="text-left">Owner</TableHeaderCell>
            <TableHeaderCell className="text-left">
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(definitions.data ?? []).length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-3 text-sm text-text-secondary"
              >
                {definitions.isLoading
                  ? "Loading…"
                  : "No saved CRM reports yet."}
              </TableCell>
            </TableRow>
          ) : (
            (definitions.data ?? []).map((definition) => (
              <TableRow key={definition.id} className="border-t border-border">
                <TableCell className="py-2 pr-3 font-medium text-text">
                  {definition.name}
                </TableCell>
                <TableCell className="py-2 pr-3 text-text-secondary">
                  {definition.datasetLabel}
                </TableCell>
                <TableCell className="py-2 pr-3 text-text-secondary">
                  {definition.isMine
                    ? "You"
                    : (definition.createdByName ?? "—")}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="compact"
                      variant="secondary"
                      onPress={() => runMutation.mutate(definition.id)}
                      aria-label={`Run ${definition.name}`}
                    >
                      Run
                    </Button>
                    {canSchedule && definition.isMine && (
                      <Button
                        size="compact"
                        variant="ghost"
                        onPress={() => setScheduling(definition)}
                        aria-label={`Schedule ${definition.name}`}
                      >
                        Schedule
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Recent runs</h3>
          {(runs.data ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">No runs yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {(runs.data ?? []).slice(0, 10).map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="font-medium text-text">
                    {run.definitionName ?? run.datasetLabel}
                  </span>
                  <StatusBadge
                    tone={
                      run.status === "succeeded"
                        ? "success"
                        : run.status === "failed"
                          ? "danger"
                          : "info"
                    }
                  >
                    {humanize(run.status)}
                  </StatusBadge>
                  <span className="text-text-muted">
                    {formatDateTime(run.requestedAt)}
                  </span>
                  {run.downloadable && (
                    <a
                      className="ml-auto text-sm font-medium text-brand hover:underline"
                      href={reportRunDownloadUrl(run.id)}
                    >
                      {`Download CSV (${run.rowCount ?? 0} rows)`}
                    </a>
                  )}
                  {run.error && (
                    <span className="w-full text-xs text-danger">
                      {run.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Schedules</h3>
          {(schedules.data ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">No scheduled reports.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {(schedules.data ?? []).map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="font-medium text-text">
                    {schedule.definitionName}
                  </span>
                  <span className="text-text-secondary">
                    {`${humanize(schedule.frequency)}${schedule.frequency === "weekly" && schedule.weekday !== null ? ` on ${WEEKDAYS[schedule.weekday]}` : ""}${schedule.frequency === "monthly" ? ` on day ${schedule.monthDay}` : ""} at ${schedule.timeOfDay} (${schedule.timezone})`}
                  </span>
                  <StatusBadge
                    tone={schedule.status === "active" ? "success" : "neutral"}
                  >
                    {humanize(schedule.status)}
                  </StatusBadge>
                  {schedule.nextRunAt && (
                    <span className="text-xs text-text-muted">{`Next ${formatDateTime(schedule.nextRunAt)}`}</span>
                  )}
                  {schedule.isMine && (
                    <span className="ml-auto flex gap-1">
                      <Button
                        size="compact"
                        variant="ghost"
                        onPress={() =>
                          statusMutation.mutate({
                            id: schedule.id,
                            status:
                              schedule.status === "active"
                                ? "paused"
                                : "active",
                          })
                        }
                      >
                        {schedule.status === "active" ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        size="compact"
                        variant="ghost"
                        onPress={() =>
                          statusMutation.mutate({
                            id: schedule.id,
                            status: "cancelled",
                          })
                        }
                      >
                        Stop
                      </Button>
                    </span>
                  )}
                  {schedule.deliveries.length > 0 && (
                    <span className="w-full text-xs text-text-muted">
                      {`Last delivery: ${humanize(schedule.deliveries[0].status)}${schedule.deliveries[0].reason ? ` — ${schedule.deliveries[0].reason}` : ""}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <BuildReportDialog
        isOpen={building}
        onOpenChange={setBuilding}
        onSaved={() => {
          setBuilding(false);
          invalidate();
        }}
      />
      <ScheduleDialog
        definition={scheduling}
        onClose={() => setScheduling(null)}
        onSaved={() => {
          setScheduling(null);
          invalidate();
        }}
      />
    </section>
  );
}

function BuildReportDialog({
  isOpen,
  onOpenChange,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [groupBy, setGroupBy] = useState("stage");
  const [measures, setMeasures] = useState<string[]>([
    "open_pipeline",
    "weighted_pipeline",
    "won_amount",
  ]);
  const [sortBy, setSortBy] = useState("open_pipeline");
  const [sortDirection, setSortDirection] = useState("desc");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      saveReport({
        name,
        datasetKey: "crm.pipeline_analysis",
        columns: ["group", ...measures],
        filters: Object.fromEntries(
          Object.entries({ groupBy, sortBy, sortDirection, from, to }).filter(
            ([, value]) => value,
          ),
        ),
      }),
    onSuccess: () => {
      setName("");
      onSaved();
    },
  });
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="New saved report"
      size="lg"
      description="A grouped pipeline analysis. Leave the dates empty for the current month at run time."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          isRequired
          maxLength={160}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Group by"
            options={GROUP_BY}
            selectedKey={groupBy}
            onSelectionChange={(key) => setGroupBy(String(key ?? "stage"))}
          />
          <Select
            label="Sort by"
            options={MEASURES.filter((measure) =>
              measures.includes(measure.value),
            )}
            selectedKey={sortBy}
            onSelectionChange={(key) => setSortBy(String(key ?? ""))}
          />
          <Select
            label="Order"
            options={[
              { value: "desc", label: "Largest first" },
              { value: "asc", label: "Smallest first" },
            ]}
            selectedKey={sortDirection}
            onSelectionChange={(key) => setSortDirection(String(key ?? "desc"))}
          />
        </div>
        <CheckboxGroup label="Columns" value={measures} onChange={setMeasures}>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {MEASURES.map((measure) => (
              <Checkbox key={measure.value} value={measure.value}>
                {measure.label}
              </Checkbox>
            ))}
          </div>
        </CheckboxGroup>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
        </div>
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isDisabled={!name.trim() || measures.length === 0}
            isLoading={mutation.isPending}
          >
            Save report
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ScheduleDialog({
  definition,
  onClose,
  onSaved,
}: {
  definition: SavedReportDefinition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const workspace = useWorkspaceContext();
  const options = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: () => getCrmOptions(),
    enabled: definition !== null,
  });
  const users = useMemo(
    () =>
      (options.data?.options.users ?? []).map((user) => ({
        value: String(user.id),
        label: String(user.fullName ?? user.name ?? user.email ?? user.id),
      })),
    [options.data],
  );
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(
    "weekly",
  );
  const [weekday, setWeekday] = useState("1");
  const [monthDay, setMonthDay] = useState("1");
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [recipients, setRecipients] = useState<string[]>([]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const mutation = useMutation({
    mutationFn: () =>
      scheduleReport({
        definitionId: definition!.id,
        frequency,
        timeOfDay,
        timezone,
        weekday: frequency === "weekly" ? Number(weekday) : null,
        monthDay: frequency === "monthly" ? Number(monthDay) : null,
        recipients: recipients.length ? recipients : [workspace.userId],
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog
      isOpen={definition !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={definition ? `Schedule “${definition.name}”` : "Schedule report"}
      description={`Times are in ${timezone}. Each recipient receives a copy built with their own access; anyone without access to the report is skipped.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Repeat"
            options={[
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
            ]}
            selectedKey={frequency}
            onSelectionChange={(key) =>
              setFrequency((key as "daily" | "weekly" | "monthly") ?? "weekly")
            }
          />
          {frequency === "weekly" && (
            <Select
              label="Day"
              options={WEEKDAYS.map((label, index) => ({
                value: String(index),
                label,
              }))}
              selectedKey={weekday}
              onSelectionChange={(key) => setWeekday(String(key ?? "1"))}
            />
          )}
          {frequency === "monthly" && (
            <Select
              label="Day of month"
              options={Array.from({ length: 28 }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              }))}
              selectedKey={monthDay}
              onSelectionChange={(key) => setMonthDay(String(key ?? "1"))}
            />
          )}
          <TextField
            label="Time"
            type="time"
            value={timeOfDay}
            onChange={setTimeOfDay}
            isRequired
          />
        </div>
        <CheckboxGroup
          label="Recipients"
          value={recipients}
          onChange={setRecipients}
          description="Up to 25. You receive it if nobody is chosen."
        >
          <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {users.map((user) => (
              <Checkbox key={user.value} value={user.value}>
                {user.label}
              </Checkbox>
            ))}
          </div>
        </CheckboxGroup>
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
            isDisabled={recipients.length > 25}
          >
            Schedule
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
