"use client";

// Project overview reports, over the projects the person may see (so they reconcile with the directory): by status, manager, customer and
// priority; near deadline, overdue and on hold; task progress and milestones (once those features track work); completed; activity. The customer
// reports (projects per customer, active and completed customer projects, managers, sales-linked projects, missing primary contacts, customer
// mismatches, reassignment history and the customer summary) read the same associations the projects hold.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { HEALTH_TONE, PROJECTS_BASE, STATUS_TONE, customerExportHref, dateLabel, errorMessage, errorStatus, getOptions, getReport, targetLabel, type ProjectRow, type ProjectStatus } from "../api/projects-api";

const REPORTS = [{ id: "by-status", label: "By status" }, { id: "by-manager", label: "By manager" }, { id: "by-customer", label: "By customer" }, { id: "by-priority", label: "By priority" },
  { id: "near-deadline", label: "Near deadline" }, { id: "overdue", label: "Overdue" }, { id: "on-hold", label: "On hold" }, { id: "task-progress", label: "Task progress" },
  { id: "milestone-summary", label: "Milestones" }, { id: "completed", label: "Completed" }, { id: "activity", label: "Activity" }];
const CUSTOMER_REPORTS = [{ id: "customer-count", label: "Projects by customer" }, { id: "customer-active", label: "Active customer projects" },
  { id: "customer-completed", label: "Completed customer projects" }, { id: "customer-managers", label: "Customer project managers" }, { id: "customer-status", label: "Status by customer" },
  { id: "sales-linked", label: "Sales-linked projects" }, { id: "missing-primary-contact", label: "Missing primary contact" }, { id: "customer-mismatch", label: "Customer mismatches" },
  { id: "customer-reassignments", label: "Customer reassignments" }, { id: "customer-summary", label: "Customer summary" }];
const ALL_REPORTS = [...REPORTS, ...CUSTOMER_REPORTS];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export function ProjectReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = ALL_REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-status";
  const customerReport = CUSTOMER_REPORTS.some((row) => row.id === kind);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "report", kind), queryFn: () => getReport<Row>(kind) });
  if (query.isError && errorStatus(query.error) === 403 && !customerReport) return <PermissionState title="You don't have access to project reports" description="Ask an administrator for the View project reports permission." />;
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
  // A customer report's project rows: the customer, its primary contact and what links it to Sales.
  const customerRows = (extra: Array<[string, (row: Row) => React.ReactNode]> = []) => (
    <LinesTable columns={["Project", "Status", "Customer", "Manager", "Primary contact", ...extra.map(([label]) => label)]}>
      {rows.map((row) => (
        <tr key={s(row.id)}><Cell>{open(row)}</Cell><Cell><StatusBadge tone={STATUS_TONE[row.status as ProjectStatus] ?? "neutral"}>{s(row.statusLabel)}</StatusBadge></Cell>
          <Cell>{s(row.customer) || "—"}{row.customerNumber ? <span className="block text-xs text-text-muted">{s(row.customerNumber)}{row.customerStatus && row.customerStatus !== "active" ? ` · ${s(row.customerStatus)}` : ""}</span> : null}</Cell>
          <Cell>{s(row.manager) || "—"}</Cell><Cell>{s(row.primaryContact) || "—"}</Cell>
          {extra.map(([label, render]) => <Cell key={label}>{render(row)}</Cell>)}</tr>
      ))}
    </LinesTable>
  );
  const customerGroups = (withQuality = false) => (
    <LinesTable columns={["Customer", { label: "Total", numeric: true }, { label: "Active", numeric: true }, { label: "On hold", numeric: true }, { label: "Completed", numeric: true },
      { label: "Drafts", numeric: true }, { label: "Cancelled", numeric: true }, ...(withQuality ? [{ label: "Needs review", numeric: true }, { label: "No primary contact", numeric: true }] : [])]}>
      {rows.map((row, index) => <tr key={index}><Cell>{s(row.label)}{row.number ? <span className="block text-xs text-text-muted">{s(row.number)}</span> : null}</Cell><Cell numeric>{s(row.total)}</Cell>
        <Cell numeric>{s(row.active)}</Cell><Cell numeric>{s(row.onHold)}</Cell><Cell numeric>{s(row.completed)}</Cell><Cell numeric>{s(row.drafts)}</Cell><Cell numeric>{s(row.cancelled)}</Cell>
        {withQuality && <Cell numeric>{s(row.needsReview)}</Cell>}{withQuality && <Cell numeric>{s(row.missingPrimaryContact)}</Cell>}</tr>)}
    </LinesTable>
  );
  const table = () => {
    switch (kind) {
      case "customer-count": case "customer-status": return customerGroups();
      case "customer-summary": return customerGroups(true);
      case "customer-active": case "customer-completed": case "missing-primary-contact": return customerRows([["Site", (row) => s(row.site) || "—"]]);
      case "sales-linked": return customerRows([["Sales orders", (row) => s(row.salesOrders)]]);
      case "customer-mismatch": return customerRows([["Mismatch", (row) => [...((row.mismatches as string[] | undefined) ?? []), s(row.review)].filter(Boolean).join(" · ")]]);
      case "customer-managers": return <LinesTable columns={["Customer", "Project Manager", { label: "Projects", numeric: true }, { label: "Active", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.key)}><Cell>{s(row.customer)}</Cell><Cell>{s(row.manager)}</Cell><Cell numeric>{s(row.projects)}</Cell><Cell numeric>{s(row.active)}</Cell></tr>)}</LinesTable>;
      case "customer-reassignments": return <LinesTable columns={["When", "Project", "What", "From", "To", "Why", "Who"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{open(row)}</Cell><Cell>{s(row.type).toLowerCase().replace(/_/g, " ")}</Cell>
          <Cell>{s(row.from) || "—"}</Cell><Cell>{s(row.to) || "—"}</Cell><Cell>{s(row.reason) || "—"}</Cell><Cell>{s(row.actor)}</Cell></tr>)}</LinesTable>;
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
      <PageHeader title="Project Reports" description="The project portfolio from the projects you may see. Financial reports follow with project budgets, time and billing."
        secondaryActions={options.data?.can.customerExport ? <LinkButton variant="secondary" href={customerExportHref()}>Export customer associations</LinkButton> : undefined} />
      <Tabs selectedKey={customerReport ? "customers" : "portfolio"} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value) === "customers" ? "customer-count" : "by-status"}`)}>
        <TabList aria-label="Report sets"><Tab id="portfolio">Portfolio</Tab><Tab id="customers">Customers</Tab></TabList>
      </Tabs>
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{(customerReport ? CUSTOMER_REPORTS : REPORTS).map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Preparing the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorStatus(query.error) === 403 ? "This report needs a permission you do not hold." : errorMessage(query.error)} />}
      {query.data && <Panel title={ALL_REPORTS.find((row) => row.id === kind)?.label}>{rows.length ? table() : <p className="text-sm text-text-muted">Nothing to report.</p>}</Panel>}
    </div>
  );
}
