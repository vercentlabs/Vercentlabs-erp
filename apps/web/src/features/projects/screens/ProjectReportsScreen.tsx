"use client";

// Project overview reports, over the projects the person may see (so they reconcile with the directory): by status, manager, customer and
// priority; near deadline, overdue and on hold; task progress and milestones (once those features track work); completed; activity. The customer
// reports (projects per customer, active and completed customer projects, managers, sales-linked projects, missing primary contacts, customer
// mismatches, reassignment history and the customer summary) read the same associations the projects hold.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  APPROVAL_TONE, HEALTH_TONE, MILESTONES_BASE, MILESTONE_TONE, PROJECTS_BASE, STATUS_TONE, TASKS_BASE, TASK_TONE, customerExportHref, dateLabel, dueLabel, errorMessage, errorStatus,
  getMilestoneReport, getOptions, getReport, getTaskReport, milestoneExportHref, minutesLabel, targetLabel, taskExportHref, type MilestoneRow, type ProjectRow, type ProjectStatus, type TaskRow,
} from "../api/projects-api";
import { PriorityBadge } from "../priority/Priority";
import { getPriorityReport } from "../priority/priority-api";
import { PRIORITY_REPORT_TABS, PriorityReport } from "../priority/PriorityViews";
import { getStatusReport } from "../status/status-api";
import { STATUS_REPORT_TABS, StatusReport } from "../status/StatusReports";
import { BILLABLE_REPORT_TABS, BillableReport } from "../billable/BillableReports";
import { getBillableReport } from "../billable/billable-api";
import { TIME_REPORT_TABS, TimeReport } from "../timesheets/TimeReports";
import { getCollaborationReport } from "../collaboration/collaboration-api";
import { getProgressReport, progressExportHref } from "../progress/progress-api";
import { PROGRESS_REPORT_TABS, ProgressReport } from "../progress/ProgressViews";
import { getExpenseReport } from "../expenses/expenses-api";
import { EXPENSE_REPORT_TABS, ExpenseReport } from "../expenses/ExpenseScreens";
import { TIME_INVOICE_REPORT_TABS, TimeInvoiceReport, getTimeInvoiceReport } from "../time-invoicing/TimeInvoicing";
import { COST_REPORT_TABS, CostReport, getCostReport } from "../costing/ProjectCost";
import { REVENUE_REPORT_TABS, RevenueReport, getRevenueReport } from "../revenue/ProjectRevenue";
import { PROFITABILITY_REPORT_TABS, ProfitabilityReport, getProfitabilityReport } from "../profitability/ProjectProfitability";
import { COLLABORATION_REPORT_TABS, CollaborationReport, collaborationExportHref } from "../collaboration/DiscussionScreens";
import { getTimeReport } from "../timesheets/timesheets-api";

const REPORTS = [{ id: "by-status", label: "By status" }, { id: "by-manager", label: "By manager" }, { id: "by-customer", label: "By customer" }, { id: "by-priority", label: "By priority" },
  { id: "near-deadline", label: "Near deadline" }, { id: "overdue", label: "Overdue" }, { id: "on-hold", label: "On hold" }, { id: "task-progress", label: "Task progress" },
  { id: "milestone-summary", label: "Milestones" }, { id: "completed", label: "Completed" }, { id: "activity", label: "Activity" }];
const CUSTOMER_REPORTS = [{ id: "customer-count", label: "Projects by customer" }, { id: "customer-active", label: "Active customer projects" },
  { id: "customer-completed", label: "Completed customer projects" }, { id: "customer-managers", label: "Customer project managers" }, { id: "customer-status", label: "Status by customer" },
  { id: "sales-linked", label: "Sales-linked projects" }, { id: "missing-primary-contact", label: "Missing primary contact" }, { id: "customer-mismatch", label: "Customer mismatches" },
  { id: "customer-reassignments", label: "Customer reassignments" }, { id: "customer-summary", label: "Customer summary" }];
// Milestone reports (ids prefixed so they never clash with the portfolio's).
const MILESTONE_REPORTS = [{ id: "ms-by-project", label: "By project" }, { id: "ms-upcoming", label: "Due soon" }, { id: "ms-overdue", label: "Overdue" }, { id: "ms-by-owner", label: "By owner" },
  { id: "ms-completed", label: "Completed" }, { id: "ms-blocked", label: "Blocked" }, { id: "ms-pending-internal", label: "Pending approval" }, { id: "ms-pending-customer", label: "Pending customer" },
  { id: "ms-schedule-changes", label: "Schedule changes" }, { id: "ms-billing-eligibility", label: "Billing eligibility" }, { id: "ms-completion-history", label: "Completion history" }];
// Task reports — task counts, never hours or money.
const TASK_REPORTS = [{ id: "tk-by-project", label: "By project" }, { id: "tk-my-open", label: "My open tasks" }, { id: "tk-by-status", label: "By status" }, { id: "tk-by-assignee", label: "Workload" },
  { id: "tk-overdue", label: "Overdue" }, { id: "tk-due-soon", label: "Due soon" }, { id: "tk-high-priority", label: "High priority" }, { id: "tk-blocked", label: "Blocked" },
  { id: "tk-in-review", label: "In review" }, { id: "tk-by-milestone", label: "By milestone" }, { id: "tk-completion-trend", label: "Completion trend" },
  { id: "tk-reassignments", label: "Reassignments" }, { id: "tk-completion-evidence", label: "Completion evidence" }, { id: "tk-needs-owner", label: "Needs an owner" }];
const ALL_REPORTS = [...REPORTS, ...CUSTOMER_REPORTS, ...MILESTONE_REPORTS, ...TASK_REPORTS, ...PRIORITY_REPORT_TABS, ...STATUS_REPORT_TABS, ...TIME_REPORT_TABS, ...BILLABLE_REPORT_TABS, ...COLLABORATION_REPORT_TABS, ...PROGRESS_REPORT_TABS, ...EXPENSE_REPORT_TABS, ...TIME_INVOICE_REPORT_TABS, ...COST_REPORT_TABS, ...REVENUE_REPORT_TABS, ...PROFITABILITY_REPORT_TABS];
// Reports grouped the way people look for them: six categories, each holding one or more report sets (a set's reports share a prefix).
const SET_LABEL: Record<string, string> = { portfolio: "Portfolio", progress: "Progress", status: "Status", customers: "Customers", collaboration: "Discussions", tasks: "Tasks", milestones: "Milestones",
  priority: "Priority", time: "Time", billable: "Billable hours", expenses: "Expenses", costs: "Cost", revenue: "Revenue", "time-invoices": "Invoices from time", profitability: "Profitability" };
const FIRST_REPORT: Record<string, string> = { portfolio: "by-status", progress: "pg-overview", status: "st-by-status", customers: "customer-count", collaboration: "cm-recent", tasks: "tk-by-project",
  milestones: "ms-by-project", priority: "pr-distribution", time: "tm-project-hours", billable: "bt-billable-vs-nonbillable", expenses: "ex-by-project", costs: "pc-summary", revenue: "rv-contract-value",
  "time-invoices": "ti-unbilled", profitability: "pf-summary" };
const REPORT_CATEGORIES = [
  { id: "delivery", label: "Project Delivery", sets: ["portfolio", "progress", "status", "customers", "collaboration"] },
  { id: "work", label: "Tasks & Milestones", sets: ["tasks", "milestones", "priority"] },
  { id: "time", label: "Timesheets & Expenses", sets: ["time", "billable", "expenses"] },
  { id: "costs", label: "Costs & Forecasts", sets: ["costs"] },
  { id: "revenue", label: "Revenue & Billing", sets: ["revenue", "time-invoices"] },
  { id: "profit", label: "Profitability & Audit", sets: ["profitability"] },
];
const PREFIX_SET: Record<string, string> = { "customer-": "customers", "ms-": "milestones", "tk-": "tasks", "pr-": "priority", "st-": "status", "tm-": "time", "bt-": "billable", "cm-": "collaboration",
  "pg-": "progress", "ex-": "expenses", "ti-": "time-invoices", "pc-": "costs", "rv-": "revenue", "pf-": "profitability" };
const setOf = (id: string) => Object.entries(PREFIX_SET).find(([prefix]) => id.startsWith(prefix))?.[1] ?? "portfolio";
const REQUEST_LABEL: Record<string, string> = { OPEN: "Requested", ACKNOWLEDGED: "Taken up by Sales", ELIGIBLE: "Ready to request", NOT_YET: "Not complete yet" };
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export function ProjectReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = ALL_REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-status";
  const customerReport = CUSTOMER_REPORTS.some((row) => row.id === kind);
  const milestoneReport = kind.startsWith("ms-");
  const taskReport = kind.startsWith("tk-");
  const priorityReport = kind.startsWith("pr-");
  const statusReport = kind.startsWith("st-");
  const timeReport = kind.startsWith("tm-");
  const billableReport = kind.startsWith("bt-");
  const collaborationReport = kind.startsWith("cm-");
  const progressReport = kind.startsWith("pg-");
  const expenseReport = kind.startsWith("ex-");
  const timeInvoiceReport = kind.startsWith("ti-");
  const costReport = kind.startsWith("pc-");
  const revenueReport = kind.startsWith("rv-");
  const profitabilityReport = kind.startsWith("pf-");
  const set = customerReport ? "customers" : milestoneReport ? "milestones" : taskReport ? "tasks" : priorityReport ? "priority" : statusReport ? "status" : timeReport ? "time" : billableReport ? "billable" : collaborationReport ? "collaboration" : progressReport ? "progress" : expenseReport ? "expenses" : timeInvoiceReport ? "time-invoices" : costReport ? "costs" : revenueReport ? "revenue" : profitabilityReport ? "profitability" : "portfolio";
  const [search, setSearch] = useState("");
  const category = REPORT_CATEGORIES.find((row) => row.sets.includes(set)) ?? REPORT_CATEGORIES[0];
  const term = search.trim().toLowerCase();
  const found = term.length < 2 ? [] : ALL_REPORTS.filter((row) => row.label.toLowerCase().includes(term) || SET_LABEL[setOf(row.id)].toLowerCase().includes(term)).slice(0, 12);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "report", kind), queryFn: () => (milestoneReport ? getMilestoneReport<Row>(kind.slice(3)) : taskReport ? getTaskReport<Row>(kind.slice(3))
    : priorityReport ? getPriorityReport<Row>(kind.slice(3)) : statusReport ? getStatusReport<Row>(kind.slice(3)) : timeReport ? getTimeReport<Row>(kind.slice(3)) : billableReport ? getBillableReport<Row>(kind.slice(3)) : collaborationReport ? getCollaborationReport<Row>(kind.slice(3)) : progressReport ? getProgressReport<Row>(kind.slice(3)) : expenseReport ? getExpenseReport<Row>(kind.slice(3)) : timeInvoiceReport ? getTimeInvoiceReport<Row>(kind.slice(3)) : costReport ? getCostReport<Row>(kind.slice(3)) : revenueReport ? getRevenueReport<Row>(kind.slice(3)) : profitabilityReport ? getProfitabilityReport<Row>(kind.slice(3)) : getReport<Row>(kind)) });
  if (query.isError && errorStatus(query.error) === 403 && set === "portfolio") return <PermissionState title="You don't have access to project reports" description="Ask an administrator for the View project reports permission." />;
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
  const milestone = (row: Row) => <Link className="text-brand underline" href={`${MILESTONES_BASE}/${s(row.milestoneId ?? row.id)}`}>{s(row.name)} <span className="text-text-muted">{s(row.code)}</span></Link>;
  const milestoneRows = () => (
    <LinesTable columns={["Milestone", "Project", "Owner", "Due", "Status", "Approval"]}>
      {(rows as Array<MilestoneRow & Row>).map((row) => (
        <tr key={row.id}><Cell>{milestone(row)}</Cell><Cell>{s(row.projectCode)}</Cell><Cell>{row.owner ?? "—"}</Cell>
          <Cell>{dateLabel(row.dueDate)}{dueLabel(row) ? <span className={`block text-xs ${row.overdue ? "text-danger" : "text-text-muted"}`}>{dueLabel(row)}</span> : null}</Cell>
          <Cell><StatusBadge tone={MILESTONE_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
          <Cell>{row.approvalStatus === "NOT_REQUIRED" ? "None" : <StatusBadge tone={APPROVAL_TONE[row.approvalStatus]}>{row.approvalLabel}</StatusBadge>}</Cell></tr>
      ))}
    </LinesTable>
  );
  const task = (row: Row) => <Link className="text-brand underline" href={`${TASKS_BASE}/${s(row.taskId ?? row.id)}`}>{s(row.title)} <span className="text-text-muted">{s(row.code)}</span></Link>;
  const taskRows = () => (
    <LinesTable columns={["Task", "Project", "Assigned to", "Status", "Priority", "Due"]}>
      {(rows as Array<TaskRow & Row>).map((row) => (
        <tr key={row.id}><Cell>{task(row)}</Cell><Cell>{s(row.projectCode)}</Cell><Cell>{row.assignee ?? "—"}</Cell>
          <Cell><StatusBadge tone={TASK_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell><Cell><PriorityBadge priority={row.priority} /></Cell>
          <Cell>{dateLabel(row.dueDate)}{dueLabel(row) ? <span className={`block text-xs ${row.overdue ? "text-danger" : "text-text-muted"}`}>{dueLabel(row)}</span> : null}</Cell></tr>
      ))}
    </LinesTable>
  );
  const table = () => {
    if (priorityReport) return <PriorityReport kind={kind} rows={rows} taskRows={taskRows} />;
    if (statusReport) return <StatusReport kind={kind} rows={rows} />;
    if (timeReport) return <TimeReport kind={kind} rows={rows} />;
    if (billableReport) return <BillableReport kind={kind} rows={rows} />;
    if (collaborationReport) return <CollaborationReport kind={kind} rows={rows} />;
    if (progressReport) return <ProgressReport kind={kind} rows={rows} />;
    if (expenseReport) return <ExpenseReport kind={kind} rows={rows} />;
    if (timeInvoiceReport) return <TimeInvoiceReport kind={kind} rows={rows} />;
    if (costReport) return <CostReport kind={kind} rows={rows} />;
    if (revenueReport) return <RevenueReport kind={kind} rows={rows} />;
    if (profitabilityReport) return <ProfitabilityReport kind={kind} rows={rows} />;
    switch (kind) {
      case "tk-my-open": case "tk-needs-owner": case "tk-overdue": case "tk-due-soon": case "tk-high-priority": case "tk-blocked": case "tk-in-review": return taskRows();
      case "tk-by-project": return <LinesTable columns={["Project", { label: "Tasks", numeric: true }, { label: "Done", numeric: true }, { label: "Open", numeric: true }, { label: "Blocked", numeric: true }, { label: "Overdue", numeric: true }, { label: "Progress", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.projectId)}><Cell><Link className="text-brand underline" href={`${PROJECTS_BASE}/${s(row.projectId)}?tab=tasks`}>{s(row.projectName) || s(row.projectCode)} <span className="text-text-muted">{s(row.projectCode)}</span></Link></Cell>
          <Cell numeric>{s(row.total)}</Cell><Cell numeric>{s(row.done)}</Cell><Cell numeric>{s(row.open)}</Cell><Cell numeric>{s(row.blocked)}</Cell><Cell numeric>{s(row.overdue)}</Cell><Cell numeric>{row.percent === null ? "—" : `${s(row.percent)}%`}</Cell></tr>)}</LinesTable>;
      case "tk-by-status": return <LinesTable columns={["Status", { label: "Tasks", numeric: true }]}>{rows.map((row) => <tr key={s(row.status)}><Cell>{s(row.label)}</Cell><Cell numeric>{s(row.total)}</Cell></tr>)}</LinesTable>;
      case "tk-by-assignee": return <LinesTable columns={["Assigned to", { label: "Open", numeric: true }, { label: "Overdue", numeric: true }, { label: "Blocked", numeric: true }, { label: "Done", numeric: true }, { label: "Open estimate", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.assigneeId)}><Cell>{s(row.assignee)}</Cell><Cell numeric>{s(row.open)}</Cell><Cell numeric>{s(row.overdue)}</Cell><Cell numeric>{s(row.blocked)}</Cell><Cell numeric>{s(row.done)}</Cell>
          <Cell numeric>{minutesLabel(Number(row.openEstimateMinutes) || null)}</Cell></tr>)}</LinesTable>;
      case "tk-by-milestone": return <LinesTable columns={["Milestone", "Project", "Milestone status", { label: "Tasks", numeric: true }, { label: "Done", numeric: true }, { label: "Progress", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.milestoneId)}><Cell><Link className="text-brand underline" href={`${MILESTONES_BASE}/${s(row.milestoneId)}`}>{`${s(row.code)} ${s(row.name)}`}</Link></Cell><Cell>{s(row.projectCode)}</Cell>
          <Cell>{s(row.milestoneStatusLabel)}</Cell><Cell numeric>{s(row.total)}</Cell><Cell numeric>{s(row.done)}</Cell><Cell numeric>{row.percent === null ? "—" : `${s(row.percent)}%`}</Cell></tr>)}</LinesTable>;
      case "tk-completion-trend": return <LinesTable columns={["Week of", { label: "Tasks done", numeric: true }]}>{rows.map((row) => <tr key={s(row.week)}><Cell>{dateLabel(s(row.week))}</Cell><Cell numeric>{s(row.done)}</Cell></tr>)}</LinesTable>;
      case "tk-reassignments": return <LinesTable columns={["When", "Task", "Project", "From", "To", "Why", "Who"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{task(row)}</Cell><Cell>{s(row.projectCode)}</Cell><Cell>{s(row.from) || "—"}</Cell><Cell>{s(row.to) || "—"}</Cell>
          <Cell>{s(row.reason) || "—"}</Cell><Cell>{s(row.actor)}</Cell></tr>)}</LinesTable>;
      case "tk-completion-evidence": return <LinesTable columns={["Task", "Project", "Done", "By", "Approved by", "Evidence"]}>
        {rows.map((row) => <tr key={s(row.taskId)}><Cell>{task(row)}</Cell><Cell>{s(row.projectCode)}</Cell><Cell>{formatDateTime(s(row.completedAt))}</Cell><Cell>{s(row.completedBy) || "—"}</Cell>
          <Cell>{s(row.approvedBy) || "—"}</Cell><Cell>{[s(row.note), s(row.reference), Number(row.files) ? `${s(row.files)} file(s)` : "", Number(row.checklistDone) ? `${s(row.checklistDone)} step(s) done` : "",
            Number(row.checklistWaived) ? `${s(row.checklistWaived)} waived` : ""].filter(Boolean).join(" · ") || "—"}</Cell></tr>)}</LinesTable>;
      case "ms-upcoming": case "ms-overdue": case "ms-completed": case "ms-blocked": case "ms-pending-internal": case "ms-pending-customer": return milestoneRows();
      case "ms-by-project": return <LinesTable columns={["Project", { label: "Milestones", numeric: true }, { label: "Completed", numeric: true }, { label: "Overdue", numeric: true }, { label: "Blocked", numeric: true }, { label: "In review", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.projectId)}><Cell><Link className="text-brand underline" href={`${PROJECTS_BASE}/${s(row.projectId)}?tab=milestones`}>{s(row.projectName) || s(row.projectCode)} <span className="text-text-muted">{s(row.projectCode)}</span></Link></Cell>
          <Cell numeric>{s(row.total)}</Cell><Cell numeric>{s(row.completed)}</Cell><Cell numeric>{s(row.overdue)}</Cell><Cell numeric>{s(row.blocked)}</Cell><Cell numeric>{s(row.submitted)}</Cell></tr>)}</LinesTable>;
      case "ms-by-owner": return <LinesTable columns={["Owner", { label: "Open", numeric: true }, { label: "Overdue", numeric: true }, { label: "Completed", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.ownerId)}><Cell>{s(row.owner)}</Cell><Cell numeric>{s(row.open)}</Cell><Cell numeric>{s(row.overdue)}</Cell><Cell numeric>{s(row.completed)}</Cell></tr>)}</LinesTable>;
      case "ms-schedule-changes": return <LinesTable columns={["When", "Milestone", "Project", "From", "To", "Why", "Who"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{milestone(row)}</Cell><Cell>{s(row.projectCode)}</Cell><Cell>{dateLabel(s(row.from))}</Cell>
          <Cell>{dateLabel(s(row.to))}</Cell><Cell>{s(row.reason)}</Cell><Cell>{s(row.changedBy)}</Cell></tr>)}</LinesTable>;
      case "ms-billing-eligibility": return <LinesTable columns={["Milestone", "Project", "Status", "Sales order", "Billing request", "Sales billing status"]}>
        {rows.map((row) => <tr key={s(row.milestoneId)}><Cell>{milestone(row)}</Cell><Cell>{s(row.projectCode)}</Cell><Cell>{s(row.statusLabel)}</Cell><Cell>{s(row.salesOrder)}</Cell>
          <Cell>{REQUEST_LABEL[s(row.request)] ?? s(row.request)}{row.requestedAt ? <span className="block text-xs text-text-muted">{formatDateTime(s(row.requestedAt))}</span> : null}</Cell>
          <Cell>{s(row.salesBillingStatus).replace(/_/g, " ") || "—"}</Cell></tr>)}</LinesTable>;
      case "ms-completion-history": return <LinesTable columns={["When", "Milestone", "Project", "What", "Who"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{milestone(row)}</Cell><Cell>{s(row.projectCode)}</Cell>
          <Cell>{s(row.summary) || s(row.action).toLowerCase().replace(/_/g, " ")}</Cell><Cell>{s(row.actor)}</Cell></tr>)}</LinesTable>;
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
        secondaryActions={milestoneReport ? <LinkButton variant="secondary" href={milestoneExportHref({ view: "all" })}>Export milestones</LinkButton>
          : taskReport ? <LinkButton variant="secondary" href={taskExportHref({ view: "all" })}>Export tasks</LinkButton>
          : progressReport && options.data?.can.progressExport ? <LinkButton variant="secondary" href={progressExportHref()}>Export progress</LinkButton>
          : collaborationReport && options.data?.can.commentExport ? <LinkButton variant="secondary" href={collaborationExportHref()}>Export discussions</LinkButton>
          : options.data?.can.customerExport ? <LinkButton variant="secondary" href={customerExportHref()}>Export customer associations</LinkButton> : undefined} />
      <TextField label="Find a report" value={search} onChange={setSearch} placeholder="e.g. overdue, margin, unbilled" />
      {found.length > 0 && <ul className="flex flex-wrap gap-2 text-sm">{found.map((row) => <li key={row.id}><button type="button" className="rounded border border-border px-2 py-1 hover:bg-surface-muted"
        onClick={() => { setSearch(""); router.replace(`${pathname}?report=${row.id}`); }}>{`${row.label} · ${SET_LABEL[setOf(row.id)]}`}</button></li>)}</ul>}
      <Tabs selectedKey={category.id} onSelectionChange={(value) => router.replace(`${pathname}?report=${FIRST_REPORT[REPORT_CATEGORIES.find((row) => row.id === String(value))!.sets[0]]}`)}>
        <TabList aria-label="Report categories">{REPORT_CATEGORIES.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {category.sets.length > 1 && (
        <Tabs selectedKey={set} onSelectionChange={(value) => router.replace(`${pathname}?report=${FIRST_REPORT[String(value)]}`)}>
          <TabList aria-label="Report sets">{category.sets.map((id) => <Tab key={id} id={id}>{SET_LABEL[id]}</Tab>)}</TabList>
        </Tabs>
      )}
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{(customerReport ? CUSTOMER_REPORTS : milestoneReport ? MILESTONE_REPORTS : taskReport ? TASK_REPORTS : priorityReport ? PRIORITY_REPORT_TABS : statusReport ? STATUS_REPORT_TABS : timeReport ? TIME_REPORT_TABS : billableReport ? BILLABLE_REPORT_TABS : collaborationReport ? COLLABORATION_REPORT_TABS : progressReport ? PROGRESS_REPORT_TABS : expenseReport ? EXPENSE_REPORT_TABS : timeInvoiceReport ? TIME_INVOICE_REPORT_TABS : costReport ? COST_REPORT_TABS : revenueReport ? REVENUE_REPORT_TABS : profitabilityReport ? PROFITABILITY_REPORT_TABS : REPORTS).map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Preparing the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorStatus(query.error) === 403 ? "This report needs a permission you do not hold." : errorMessage(query.error)} />}
      {query.data && <Panel title={ALL_REPORTS.find((row) => row.id === kind)?.label}>{rows.length ? table() : <p className="text-sm text-text-muted">Nothing to report.</p>}</Panel>}
    </div>
  );
}
