"use client";

// Projects — a project's Time & Expenses tab, time part: the time recorded on it by status, task and person (cost for those who may see it),
// its entries, and — from Billable / Non-Billable Time — its billable time summary and billing policy. Expenses follow with their own feature.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton, MetricStrip } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, type Project } from "../api/projects-api";
import { BillableSummaryPanel } from "../billable/BillingPanels";
import { TimeEntryDialog } from "./TimeEntryDialog";
import { EntryTable } from "./TimeViews";
import { getProjectTime, hours, listEntries, timeExportHref, type Warning } from "./timesheets-api";

export function ProjectTimeTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-summary", project.id), queryFn: () => getProjectTime(project.id) });
  const entries = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-entries", project.id), queryFn: () => listEntries({ view: summary.data?.team ? "team" : "mine", projectId: project.id, pageSize: 100 }),
    enabled: Boolean(summary.data) });
  const [dialog, setDialog] = useState<"log" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading the project's time" rows={6} />;
  if (summary.isError || !summary.data) return <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const data = summary.data;
  const refresh = async (text: string, warnings: Warning[] = []) => {
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
    setMessage({ tone: warnings.length ? "warning" : "success", text: [text, ...warnings.map((row) => row.message)].join(" ") });
  };
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        {data.can.record && <Button size="compact" variant="primary" onPress={() => setDialog("log")}>Log time</Button>}
        {data.can.export && <LinkButton size="compact" variant="ghost" href={timeExportHref({ projectId: project.id })}>Export approved time</LinkButton>}
      </div>
      <MetricStrip metrics={[{ label: "Recorded", value: hours(data.totals.recordedMinutes) }, { label: "Approved", value: hours(data.totals.approvedMinutes) },
        { label: "Awaiting review", value: hours(data.totals.submittedMinutes) }, { label: data.cost ? "Labor cost (approved)" : "Billable", value: data.cost ? `${data.cost.total} ${data.cost.currency ?? ""}` : hours(data.totals.billableMinutes) }]} />
      <BillableSummaryPanel project={project} />
      {data.team && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="By task" description="Actual approved time, beside the task's estimate (an estimate is not time worked).">
            <LinesTable empty="No time yet." columns={["Task", { label: "Estimate", numeric: true }, { label: "Recorded", numeric: true }, { label: "Approved", numeric: true }]}>
              {data.byTask.map((row) => <tr key={row.taskId ?? "project"}><Cell>{row.task}</Cell><Cell numeric>{row.estimateMinutes ? hours(row.estimateMinutes) : "—"}</Cell>
                <Cell numeric>{hours(row.recordedMinutes)}</Cell><Cell numeric>{hours(row.approvedMinutes)}</Cell></tr>)}
            </LinesTable>
          </Panel>
          <Panel title="By person">
            <LinesTable empty="No time yet." columns={["Employee", { label: "Recorded", numeric: true }, { label: "Approved", numeric: true }, { label: "Billable", numeric: true }, ...(data.cost ? [{ label: "Cost", numeric: true }] : [])]}>
              {data.byEmployee.map((row) => <tr key={row.employeeUserId}><Cell>{row.employee}</Cell><Cell numeric>{hours(row.recordedMinutes)}</Cell><Cell numeric>{hours(row.approvedMinutes)}</Cell>
                <Cell numeric>{hours(row.billableMinutes)}</Cell>{data.cost && <Cell numeric>{row.cost ?? "No rate"}</Cell>}</tr>)}
            </LinesTable>
          </Panel>
        </div>
      )}
      <Panel title={data.team ? "Time entries" : "Your time on this project"}>
        {entries.isLoading ? <LoadingState label="Loading entries" rows={4} /> : <EntryTable entries={entries.data?.rows ?? []} showEmployee={data.team} empty="No time recorded on this project yet." />}
      </Panel>
      {dialog === "log" && <TimeEntryDialog projectId={project.id} onClose={() => setDialog(null)} onSaved={refresh} />}
    </div>
  );
}
