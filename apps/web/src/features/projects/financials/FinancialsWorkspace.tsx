"use client";

// Projects — a project's Financials tab: a second-level bar (Overview, Costs, Revenue, Billing, Budget, Profitability, Reconciliation) over the
// panels each feature owns. Overview puts the headline figures side by side, each opening its section; Reconciliation gathers every area's
// exceptions and its reconcile check. Each section shows only what the person may see; nothing here keeps financial records of its own.
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { call, errorMessage, errorStatus, type Project } from "../api/projects-api";
import { BudgetForecastPanel, ProjectCostPanel } from "../costing/ProjectCost";
import { ProjectRevenuePanel } from "../revenue/ProjectRevenue";
import { ProjectProfitabilityPanel } from "../profitability/ProjectProfitability";
import { ProjectBillingSection } from "../billable/BillingScreens";

export const FINANCIAL_SECTIONS = [{ id: "overview", label: "Overview" }, { id: "costs", label: "Costs" }, { id: "revenue", label: "Revenue" }, { id: "billing", label: "Billing" },
  { id: "budget", label: "Budget" }, { id: "profitability", label: "Profitability" }, { id: "reconciliation", label: "Reconciliation" }] as const;
type Section = (typeof FINANCIAL_SECTIONS)[number]["id"];

export function ProjectFinancialsWorkspace({ project }: { project: Project }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = FINANCIAL_SECTIONS.find((row) => row.id === params.get("section"))?.id ?? "overview";
  const [section, setSection] = useState<Section>(initial);
  const open = (id: Section) => { setSection(id); router.replace(`${pathname}?tab=financials&section=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <Tabs selectedKey={section} onSelectionChange={(key) => open(String(key) as Section)}>
        <TabList aria-label="Financial sections">{FINANCIAL_SECTIONS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {section === "overview" && <FinancialOverview projectId={project.id} onOpen={open} />}
      {section === "costs" && <ProjectCostPanel projectId={project.id} />}
      {section === "revenue" && <ProjectRevenuePanel projectId={project.id} />}
      {section === "billing" && <ProjectBillingSection project={project} />}
      {section === "budget" && <BudgetForecastPanel projectId={project.id} />}
      {section === "profitability" && <ProjectProfitabilityPanel projectId={project.id} />}
      {section === "reconciliation" && <ReconciliationSection projectId={project.id} />}
    </div>
  );
}

const money = (value: string | null | undefined) => (value === null || value === undefined ? "—" : `${Number(value) < 0 ? "−" : ""}₹${Math.abs(Number(value)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
type ProfitSummary = { actual: { recognized: string | null; cost: string; contribution: string | null; margin: number | null }; forecast: { margin: number | null; eac: string | null } | null;
  commercial: { contract: string | null; netInvoiced: string; collected: string; outstanding: string } | null; budget: { total: string | null; forecastVariance: string | null }; internal: boolean };
type CostSummary = { actual: string; budget: { set?: false; total?: string }; eac: string | null };
type RevenueSummary = { contract: { value: string | null }; invoiced: { net: string }; recognized: { available: boolean; total: string | null } | null; collections: { settled: string; outstanding: string } | null };
function Card({ label, value, note, onOpen }: { label: string; value: string; note?: string; onOpen?: () => void }) {
  return (
    <button type="button" disabled={!onOpen} onClick={onOpen} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left enabled:hover:border-brand">
      <span className="text-xs font-medium text-text-muted">{label}</span><span className="text-lg font-semibold tabular-nums">{value}</span>{note && <span className="text-xs text-text-muted">{note}</span>}
    </button>
  );
}
function FinancialOverview({ projectId, onOpen }: { projectId: string; onOpen: (section: Section) => void }) {
  const workspace = useWorkspaceContext();
  const profit = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "profitability", projectId, "", ""), queryFn: () => call<{ summary: ProfitSummary }>(`/${projectId}/profitability`).then((r) => r.summary), retry: false });
  const cost = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cost", projectId), queryFn: () => call<{ summary: CostSummary }>(`/${projectId}/costs`).then((r) => r.summary), retry: false });
  const revenue = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "revenue", projectId), queryFn: () => call<{ summary: RevenueSummary }>(`/${projectId}/revenue`).then((r) => r.summary), retry: false });
  if (profit.isLoading || cost.isLoading || revenue.isLoading) return <LoadingState label="Loading the financial overview" rows={3} />;
  const p = profit.data;
  const c = cost.data;
  const r = revenue.data;
  if (!p && !c && !r) return <Notice tone="warning">{errorStatus(profit.error) === 403 || errorStatus(cost.error) === 403 ? "Project financials need the cost, revenue or profitability permission." : errorMessage(profit.error)}</Notice>;
  return (
    <Panel title="Financial overview" description="Contract value, recognized revenue, actual cost, collections and the forecast margin are separate measures; select one to open its section.">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {r && <Card label="Contract value" value={r.contract.value === null ? "No contract" : money(r.contract.value)} note={`Net invoiced ${money(r.invoiced.net)}`} onOpen={() => onOpen("revenue")} />}
        {r?.recognized && <Card label="Recognized revenue" value={r.recognized.available ? money(r.recognized.total) : "Not available"} note="Finance postings" onOpen={() => onOpen("revenue")} />}
        {c && <Card label="Actual cost" value={money(c.actual)} note={c.budget.set === false ? "Budget not set" : `Budget ${money(c.budget.total)}`} onOpen={() => onOpen("costs")} />}
        {c && <Card label="Estimate at completion" value={c.eac === null ? "Not estimated" : money(c.eac)} onOpen={() => onOpen("budget")} />}
        {r?.collections && <Card label="Collected (gross)" value={money(r.collections.settled)} note={`${money(r.collections.outstanding)} outstanding`} onOpen={() => onOpen("revenue")} />}
        {p && !p.internal && <Card label="Actual contribution" value={p.actual.contribution === null ? "Unavailable" : money(p.actual.contribution)} note={p.actual.margin === null ? "Margin N/A" : `${p.actual.margin}% margin`} onOpen={() => onOpen("profitability")} />}
        {p?.forecast && !p.internal && <Card label="Forecast margin" value={p.forecast.margin === null ? "N/A" : `${p.forecast.margin}%`} note={p.forecast.eac === null ? "No estimate to complete" : undefined} onOpen={() => onOpen("profitability")} />}
      </div>
    </Panel>
  );
}
type Exception = { kind: string; message: string };
const AREAS = [
  { id: "costs", label: "Cost", exceptions: (id: string) => call<{ rows: Exception[] }>(`/${id}/costs/exceptions`), reconcile: (id: string) => call<{ consistent: boolean; checks: Array<{ label: string; ok: boolean; details: string[] }> }>(`/${id}/costs/reconciliation`) },
  { id: "revenue", label: "Revenue", exceptions: (id: string) => call<{ rows: Exception[] }>(`/${id}/revenue/exceptions`), reconcile: (id: string) => call<{ consistent: boolean; checks: Array<{ label: string; ok: boolean; details: string[] }> }>(`/${id}/revenue/reconciliation`) },
  { id: "profitability", label: "Profitability", exceptions: (id: string) => call<{ rows: Exception[] }>(`/${id}/profitability/exceptions`), reconcile: (id: string) => call<{ consistent: boolean; checks: Array<{ label: string; ok: boolean; details: string[] }> }>(`/${id}/profitability/reconciliation`) },
] as const;
function ReconciliationSection({ projectId }: { projectId: string }) {
  return <div className="flex flex-col gap-4">{AREAS.map((area) => <AreaExceptions key={area.id} projectId={projectId} area={area} />)}</div>;
}
function AreaExceptions({ projectId, area }: { projectId: string; area: (typeof AREAS)[number] }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "reconciliation", area.id, projectId), queryFn: () => area.exceptions(projectId), retry: false });
  const [result, setResult] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  if (q.isLoading) return <LoadingState label={`Loading ${area.label.toLowerCase()} exceptions`} rows={2} />;
  if (q.isError && (errorStatus(q.error) === 403 || errorStatus(q.error) === 404)) return null;
  const check = async () => {
    try { const r = await area.reconcile(projectId); setResult({ tone: r.consistent ? "success" : "warning", text: r.consistent ? "Everything matches its source." : r.checks.filter((x) => !x.ok).map((x) => `${x.label}: ${x.details.join(", ")}`).join(" · ") }); }
    catch (failure) { setResult({ tone: errorStatus(failure) === 403 ? "warning" : "danger", text: errorStatus(failure) === 403 ? "Reconciling this area needs Finance's permission." : errorMessage(failure) }); }
  };
  const rows = q.data?.rows ?? [];
  return (
    <Panel title={`${area.label} · ${rows.length} exception${rows.length === 1 ? "" : "s"}`} actions={<Button size="compact" variant="ghost" onPress={check}>Reconcile</Button>}>
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      {q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : rows.length === 0 ? <p className="text-sm text-text-muted">Nothing needs reconciling.</p>
        : <ul className="flex flex-col gap-1 text-sm">{rows.map((row, i) => <li key={i}>{row.message}</li>)}</ul>}
    </Panel>
  );
}
