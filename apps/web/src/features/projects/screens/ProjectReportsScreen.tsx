"use client";

// Project overview reports, over the projects the person may see (so they reconcile with the directory): by status, manager, customer and
// priority; near deadline, overdue and on hold; task progress and milestones (once those features track work); completed; activity.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { HEALTH_TONE, PROJECTS_BASE, STATUS_TONE, dateLabel, errorMessage, errorStatus, getReport, targetLabel, type ProjectRow } from "../api/projects-api";

const REPORTS = [{ id: "by-status", label: "By status" }, { id: "by-manager", label: "By manager" }, { id: "by-customer", label: "By customer" }, { id: "by-priority", label: "By priority" },
  { id: "near-deadline", label: "Near deadline" }, { id: "overdue", label: "Overdue" }, { id: "on-hold", label: "On hold" }, { id: "task-progress", label: "Task progress" },
  { id: "milestone-summary", label: "Milestones" }, { id: "completed", label: "Completed" }, { id: "activity", label: "Activity" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export function ProjectReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-status";
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "report", kind), queryFn: () => getReport<Row>(kind) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to project reports" description="Ask an administrator for the View project reports permission." />;
  const rows = query.data ?? [];
  const open = (row: Row) => <Link className="text-brand underline" href={`${PROJECTS_BASE}/${s(row.id ?? row.projectId)}`}>{s(row.name) || "Untitled draft"} <span className="text-text-muted">{s(row.code)}</span></Link>;
  const projectRows = (extra: Array<[string, (row: ProjectRow & Row) => React.ReactNode]> = []) => (
    <LinesTable columns={["Project", "Status", "Health", "Manager", "Target", ...extra.map(([label]) => label)]}>
      {(rows as Array<ProjectRow & Row>).map((row) => (
        <tr key={row.id}><Cell>{open(row)}</Cell><Cell><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
          <Cell><StatusBadge tone={HEALTH_TONE[row.health]}>{row.healthLabel}</StatusBadge></Cell><Cell>{row.manager ?? "—"}</Cell>
          <Cell>{dateLabel(row.targetEndDate)}{targetLabel(row) ? <span className="block text-xs text-text-muted">{targetLabel(row)}</span> : null}</Cell>
          {extra.map(([label, render]) => <Cell key={label}>{render(row)}</Cell>)}</tr>
      ))}
    </LinesTable>
  );
  const groups = () => (
    <LinesTable columns={["", { label: "Total", numeric: true }, { label: "Active", numeric: true }, { label: "On hold", numeric: true }, { label: "Completed", numeric: true }, { label: "Overdue", numeric: true }, { label: "At risk", numeric: true }]}>
      {rows.map((row, index) => <tr key={index}><Cell>{s(row.label)}</Cell><Cell numeric>{s(row.total)}</Cell><Cell numeric>{s(row.active)}</Cell><Cell numeric>{s(row.onHold)}</Cell>
        <Cell numeric>{s(row.completed)}</Cell><Cell numeric>{s(row.overdue)}</Cell><Cell numeric>{s(row.atRisk)}</Cell></tr>)}
    </LinesTable>
  );
  const table = () => {
    switch (kind) {
      case "by-status": return <LinesTable columns={["Status", { label: "Projects", numeric: true }]}>{rows.map((row) => <tr key={s(row.key)}><Cell>{s(row.label)}</Cell><Cell numeric>{s(row.total)}</Cell></tr>)}</LinesTable>;
      case "by-priority": return <LinesTable columns={["Priority", { label: "Projects", numeric: true }, { label: "Active", numeric: true }]}>{rows.map((row) => <tr key={s(row.key)}><Cell>{s(row.label)}</Cell><Cell numeric>{s(row.total)}</Cell><Cell numeric>{s(row.active)}</Cell></tr>)}</LinesTable>;
      case "by-manager": case "by-customer": return groups();
      case "near-deadline": case "overdue": return projectRows();
      case "on-hold": return projectRows([["On hold since", (row) => (row.heldSince ? formatDateTime(s(row.heldSince)) : "—")], ["Why", (row) => s(row.holdReason)]]);
      case "task-progress": return projectRows([["Tasks", (row) => (row.tasks ? `${s((row.tasks as Row).completed)} of ${s((row.tasks as Row).total)}` : "Not tracked yet")]]);
      case "milestone-summary": return projectRows([["Milestones", (row) => (row.milestones ? `${s((row.milestones as Row).completed)} of ${s((row.milestones as Row).total)}` : "Not tracked yet")]]);
      case "completed": return projectRows([["Completed", (row) => dateLabel(row.completedAt)], ["On time", (row) => (row.onTime === null ? "—" : row.onTime ? "Yes" : "Late")]]);
      case "activity": return <LinesTable columns={["When", "Project", "What", "Who"]}>{rows.map((row, index) => <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{open(row)}</Cell>
        <Cell>{s(row.summary) || s(row.action).toLowerCase().replace(/_/g, " ")}</Cell><Cell>{s(row.actor)}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Project Reports" description="The project portfolio from the projects you may see. Financial reports follow with project budgets, time and billing." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Preparing the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && <Panel title={REPORTS.find((row) => row.id === kind)?.label}>{rows.length ? table() : <p className="text-sm text-text-muted">Nothing to report.</p>}</Panel>}
    </div>
  );
}
