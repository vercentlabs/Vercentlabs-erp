"use client";

// Projects — the module destinations that gather other features' records. My Work: one tab bar over the person's own task queue, projects,
// timesheets, expenses, mentions, discussions and approvals (each the same screen as elsewhere, opened on the person's view). Approvals: every
// decision waiting for the person, each row opening the record where it is made. Project Financials: every project the person may see
// financially, with cost, revenue and profitability side by side and the portfolio reports by area.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { call, errorMessage, errorStatus, qs } from "../api/projects-api";
import { TaskQueueScreen } from "../screens/TaskQueueScreen";
import { ProjectListScreen } from "../screens/ProjectListScreen";
import { MyTimesheetScreen } from "../timesheets/MyTimesheetScreen";
import { ExpensesScreen } from "../expenses/ExpenseScreens";
import { DiscussionsScreen } from "../collaboration/DiscussionScreens";
import { CostReport, getCostReport } from "../costing/ProjectCost";
import { RevenueReport, getRevenueReport } from "../revenue/ProjectRevenue";
import { ProfitabilityReport, getProfitabilityReport } from "../profitability/ProjectProfitability";
import { TimeInvoiceReport, getTimeInvoiceReport } from "../time-invoicing/TimeInvoicing";

// ------------------------------------------------------------------ My Work
const MY_WORK = [
  { id: "tasks", label: "My Tasks", view: "mine" }, { id: "projects", label: "My Projects" }, { id: "timesheets", label: "My Timesheets" },
  { id: "expenses", label: "My Expenses", view: "mine" }, { id: "mentions", label: "Mentions", view: "mentions" }, { id: "discussions", label: "Discussions", view: "unread" },
  { id: "approvals", label: "My Approvals" },
] as const;
export function MyWorkScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = MY_WORK.find((row) => row.id === params.get("tab")) ?? MY_WORK[0];
  const open = (id: string) => {
    const next = MY_WORK.find((row) => row.id === id)!;
    router.replace(`${pathname}${qs({ tab: next.id, view: "view" in next ? next.view : undefined })}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-4">
      <Tabs selectedKey={tab.id} onSelectionChange={(key) => open(String(key))}>
        <TabList aria-label="My Work">{MY_WORK.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {tab.id === "tasks" && <TaskQueueScreen />}
      {tab.id === "projects" && <ProjectListScreen mine />}
      {tab.id === "timesheets" && <MyTimesheetScreen />}
      {tab.id === "expenses" && <ExpensesScreen />}
      {(tab.id === "mentions" || tab.id === "discussions") && <DiscussionsScreen />}
      {tab.id === "approvals" && <ApprovalsScreen embedded />}
    </div>
  );
}

// ------------------------------------------------------------------ Approvals
type Queue = { key: string; label: string; count: number; rows: Array<{ id: string; title: string; project: string | null; projectId: string | null; by: string | null; waitingDays: number | null; href: string }> };
export const getApprovals = () => call<{ queues: Queue[]; total: number }>("/approvals");
export function ApprovalsScreen({ embedded = false }: { embedded?: boolean }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "approvals"), queryFn: getApprovals });
  const [selected, setSelected] = useState<string>("all");
  if (query.isLoading) return <LoadingState label="Loading approvals" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load approvals" description={errorMessage(query.error)} />;
  const queues = query.data.queues.filter((q) => q.count > 0);
  const shown = selected === "all" ? queues : queues.filter((q) => q.key === selected);
  return (
    <div className="flex flex-col gap-4">
      {!embedded && <PageHeader title="Approvals" description="Every decision waiting for you across Projects. Each opens the record where the decision is made." />}
      {queues.length === 0 ? <Notice tone="success">Nothing is waiting for your decision.</Notice> : (
        <>
          <Tabs selectedKey={selected} onSelectionChange={(key) => setSelected(String(key))}>
            <TabList aria-label="Approval queues"><Tab id="all">{`All (${query.data.total})`}</Tab>{queues.map((q) => <Tab key={q.key} id={q.key}>{`${q.label} (${q.count})`}</Tab>)}</TabList>
          </Tabs>
          {shown.map((q) => (
            <Panel key={q.key} title={`${q.label} · ${q.count}`}>
              <LinesTable columns={["Waiting for you", "Project", "From", { label: "Waiting", numeric: true }]}>
                {q.rows.map((row) => <tr key={row.id}><Cell><Link className="text-brand hover:underline" href={row.href}>{row.title}</Link></Cell>
                  <Cell>{row.projectId ? <Link className="hover:underline" href={`/projects/${row.projectId}`}>{row.project ?? "Project"}</Link> : row.project ?? "—"}</Cell><Cell>{row.by ?? "—"}</Cell>
                  <Cell numeric>{row.waitingDays === null ? "—" : row.waitingDays === 0 ? "today" : `${row.waitingDays} d`}</Cell></tr>)}
              </LinesTable>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Project Financials
type DirectoryRow = { projectId: string; code: string; name: string | null; customer: string | null; manager: string | null; status: string; internal: boolean;
  cost: { actual: string; budget: string | null; eac: string | null; overrun: boolean | null } | null;
  revenue: { contract: string | null; netInvoiced: string; recognized?: string | null; collected?: string; outstanding?: string } | null;
  profitability: { status: string; contribution: string | null; margin: number | null; forecastMargin?: number | null; completeness: string } | null; attention: number; href: string };
type Directory = { rows: DirectoryRow[]; totals: { cost: { actual: string; budget: string; eac: string } | null; revenue: { contract: string; netInvoiced: string } | null;
  profitability: { recognized: string; cost: string; contribution: string; margin: number | null; projects: number } | null } };
const money = (value: string | null | undefined) => (value === null || value === undefined ? "—" : `${Number(value) < 0 ? "−" : ""}₹${Math.abs(Number(value)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (value: number | null | undefined) => (value === null || value === undefined ? "N/A" : `${value}%`);
const PROFIT_TONE: Record<string, "success" | "danger" | "neutral" | "warning" | "info"> = { PROFITABLE: "success", LOSS: "danger", BREAK_EVEN: "neutral", UNKNOWN: "warning", INTERNAL: "info" };
const PROFIT_LABEL: Record<string, string> = { PROFITABLE: "Profitable", LOSS: "Loss", BREAK_EVEN: "Break-even", UNKNOWN: "Unknown", INTERNAL: "Internal" };
// Each area's portfolio report: the same report the Reports page runs.
const AREAS = [
  { id: "overview", label: "Overview" },
  { id: "costs", label: "Costs", report: "pc-summary", load: () => getCostReport("summary"), render: (rows: Record<string, unknown>[]) => <CostReport kind="pc-summary" rows={rows} /> },
  { id: "revenue", label: "Revenue", report: "rv-invoiced", load: () => getRevenueReport("invoiced"), render: (rows: Record<string, unknown>[]) => <RevenueReport kind="rv-invoiced" rows={rows} /> },
  { id: "billing", label: "Billing", report: "ti-unbilled", load: () => getTimeInvoiceReport("unbilled"), render: (rows: Record<string, unknown>[]) => <TimeInvoiceReport kind="ti-unbilled" rows={rows} /> },
  { id: "budget", label: "Budget & Forecast", report: "pf-budget-vs-forecast", load: () => getProfitabilityReport("budget-vs-forecast"), render: (rows: Record<string, unknown>[]) => <ProfitabilityReport kind="pf-budget-vs-forecast" rows={rows} /> },
  { id: "profitability", label: "Profitability", report: "pf-summary", load: () => getProfitabilityReport("summary"), render: (rows: Record<string, unknown>[]) => <ProfitabilityReport kind="pf-summary" rows={rows} /> },
  { id: "reconciliation", label: "Reconciliation", report: "pf-exceptions", load: () => getProfitabilityReport("exceptions"), render: (rows: Record<string, unknown>[]) => <ProfitabilityReport kind="pf-exceptions" rows={rows} /> },
] as const;
export function ProjectFinancialsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const area = AREAS.find((row) => row.id === params.get("tab")) ?? AREAS[0];
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const directory = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "financials-directory", status, search), queryFn: () => call<Directory>(`/financials${qs({ status: status || undefined, search: search || undefined })}`),
    retry: false, enabled: area.id === "overview" });
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "financials-area", area.id), queryFn: () => ("load" in area ? area.load() : Promise.resolve([])), retry: false, enabled: area.id !== "overview" });
  if (directory.isError && errorStatus(directory.error) === 403) return <PermissionState title="Project financials are restricted" description="Ask for the project cost, revenue or profitability permission." />;
  const d = directory.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Project Financials" description="Cost, revenue and profitability across the projects you may see financially — each figure from Project Cost, Project Revenue or Finance. Open a project for its detail." />
      <Tabs selectedKey={area.id} onSelectionChange={(key) => router.replace(`${pathname}?tab=${String(key)}`, { scroll: false })}>
        <TabList aria-label="Financial areas">{AREAS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {area.id === "overview" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="w-full"><Select label="Status" selectedKey={status} onSelectionChange={(k) => setStatus(String(k ?? ""))} options={[{ value: "", label: "All statuses" }, { value: "PLANNED", label: "Planned" },
              { value: "IN_PROGRESS", label: "In progress" }, { value: "ON_HOLD", label: "On hold" }, { value: "COMPLETED", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" }]} /></div>
            <TextField label="Search" value={search} onChange={setSearch} placeholder="Project, code or customer" />
          </div>
          {directory.isLoading ? <LoadingState label="Loading project financials" rows={6} /> : directory.isError ? <ErrorState title="Could not load" description={errorMessage(directory.error)} /> : d && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {d.totals.revenue && <Total label="Contract value" value={money(d.totals.revenue.contract)} note={`Net invoiced ${money(d.totals.revenue.netInvoiced)}`} />}
                {d.totals.cost && <Total label="Actual cost" value={money(d.totals.cost.actual)} note={`Budgets ${money(d.totals.cost.budget)} · EAC ${money(d.totals.cost.eac)}`} />}
                {d.totals.profitability && <Total label="Portfolio contribution" value={money(d.totals.profitability.contribution)} note={`On ${money(d.totals.profitability.recognized)} recognized, ${d.totals.profitability.projects} projects`} />}
                {d.totals.profitability && <Total label="Portfolio margin" value={pct(d.totals.profitability.margin)} note="From summed amounts, not an average" />}
              </div>
              <LinesTable columns={["Project", "Status", { label: "Contract", numeric: true }, { label: "Net invoiced", numeric: true }, { label: "Actual cost", numeric: true }, { label: "EAC", numeric: true },
                { label: "Contribution", numeric: true }, { label: "Margin", numeric: true }, "Profitability", { label: "Attention", numeric: true }]} empty={d.rows.length ? undefined : "No projects to show."}>
                {d.rows.map((row) => <tr key={row.projectId}>
                  <Cell><Link className="text-brand hover:underline" href={row.href}>{row.code}</Link><span className="block text-xs text-text-muted">{`${row.name ?? ""}${row.customer ? ` · ${row.customer}` : row.internal ? " · Internal" : ""}`}</span></Cell>
                  <Cell>{row.status.replace(/_/g, " ").toLowerCase()}</Cell>
                  <Cell numeric>{row.revenue ? money(row.revenue.contract) : "—"}</Cell><Cell numeric>{row.revenue ? money(row.revenue.netInvoiced) : "—"}</Cell>
                  <Cell numeric>{row.cost ? money(row.cost.actual) : "—"}</Cell><Cell numeric>{row.cost ? <span className={row.cost.overrun ? "text-danger" : ""}>{money(row.cost.eac)}</span> : "—"}</Cell>
                  <Cell numeric>{row.profitability ? money(row.profitability.contribution) : "—"}</Cell><Cell numeric>{row.profitability ? pct(row.profitability.margin) : "—"}</Cell>
                  <Cell>{row.profitability ? <StatusBadge tone={PROFIT_TONE[row.profitability.status] ?? "neutral"}>{PROFIT_LABEL[row.profitability.status] ?? row.profitability.status}</StatusBadge> : "—"}</Cell>
                  <Cell numeric>{row.attention ? <Link className="text-warning hover:underline" href={`${row.href}&section=reconciliation`}>{row.attention}</Link> : "—"}</Cell>
                </tr>)}
              </LinesTable>
            </>
          )}
        </>
      ) : (
        <Panel title={area.label} actions={"report" in area ? <Link className="text-sm text-brand hover:underline" href={`/projects/reports?report=${area.report}`}>More reports</Link> : undefined}>
          {report.isLoading ? <LoadingState label="Loading" rows={5} /> : report.isError ? <Notice tone={errorStatus(report.error) === 403 ? "warning" : "danger"}>{errorStatus(report.error) === 403 ? "This area needs a permission you do not hold." : errorMessage(report.error)}</Notice>
            : (report.data ?? []).length === 0 ? <p className="text-sm text-text-muted">Nothing to show.</p> : "render" in area ? area.render(report.data as Record<string, unknown>[]) : null}
        </Panel>
      )}
      <p className="text-xs text-text-muted">Project Financials keeps no journals of its own: every figure is read from Project Cost, Project Revenue, Sales and Finance.</p>
    </div>
  );
}
function Total({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5"><span className="text-xs font-medium text-text-muted">{label}</span><span className="text-lg font-semibold tabular-nums">{value}</span>{note && <span className="text-xs text-text-muted">{note}</span>}</div>;
}
