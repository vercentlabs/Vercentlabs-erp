"use client";

// Assets — Asset Maintenance. The workspace (overview, requests, Work Orders by stage, the technician's own queue, preventive plans, scheduled
// service, exceptions, reports, audit), one request, one Work Order (diagnosis, checklist, parts and vendor costs from their source
// documents, verification and the return to service), one plan, and the asset's Maintenance & Warranty panel. Every action follows the
// Work Order's state and the person's permissions; availability is recomputed from every restriction, never set by hand.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { dateLabel, errorMessage, errorStatus, money } from "../register/register-api";
import {
  CONDITION_OPTIONS, MAINTENANCE_BASE, PRIORITY_OPTIONS, PRIORITY_TONE, REPORT_KINDS, REQUEST_TONE, RESTRICTION_LABEL, TYPE_OPTIONS, WO_TONE, createPlan, createRequest, createWorkOrder, generateDue,
  getAssetPanel, getAudit, getDue, getExceptions, getOptions, getOverview, getPlan, getReport, getRequest, getWorkOrder, listPlans, listRequests, listWorkOrders, maintenanceExportHref, planAction,
  requestAction, workOrderAction, type Option, type RequestRow, type WorkOrderDetail, type WorkOrderRow,
} from "./maintenance-api";

const VIEWS = [{ id: "overview", label: "Overview" }, { id: "requests", label: "Requests" }, { id: "work-orders", label: "Work Orders" }, { id: "mine", label: "My Work" },
  { id: "plans", label: "Preventive Plans" }, { id: "scheduled", label: "Scheduled Maintenance" }, { id: "waiting", label: "Awaiting Parts / Vendor" }, { id: "verification", label: "Pending Verification" },
  { id: "completed", label: "Completed" }, { id: "exceptions", label: "Exceptions" }, { id: "reports", label: "Reports" }, { id: "audit", label: "Audit" }];
const rupees = (v: number | null | undefined) => (v === null || v === undefined ? "—" : money(String(v)));
const lines = (v: unknown) => String(v ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "maintenance") });
};
const denied = (error: unknown, what: string) => (errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description="It needs an asset maintenance permission." /> : <Notice tone="danger">{errorMessage(error)}</Notice>);

// ------------------------------------------------------------------ the dialogs that start work
export function reportProblemAsk(onDone: (id: string) => void, asset?: string): Ask {
  return { title: "Report a problem", confirm: "Report", description: "Describe what is wrong. If the asset may be unsafe to use, say so: its use is restricted at once until someone assesses it.",
    fields: [...(asset ? [] : [{ name: "asset", label: "Asset (code, serial number or tag)", kind: "text" as const, required: true }]),
      { name: "description", label: "What is wrong", kind: "textarea", required: true }, { name: "symptoms", label: "When it happens / what you noticed", kind: "textarea" },
      { name: "safetyConcern", label: "Could it be unsafe to use?", kind: "select", initial: "UNKNOWN", options: [{ value: "YES", label: "Yes — possibly unsafe" }, { value: "NO", label: "No" }, { value: "UNKNOWN", label: "Not sure" }] },
      { name: "priority", label: "How urgent", kind: "select", initial: "NORMAL", options: PRIORITY_OPTIONS }, { name: "observedCondition", label: "Condition you see", kind: "select", options: CONDITION_OPTIONS },
      { name: "distinctIssue", label: "This is a different problem from one already reported", kind: "checkbox" }],
    run: async (v, key) => { const r = await createRequest({ ...v, ...(asset ? { assetId: asset } : {}), observedCondition: v.observedCondition || undefined, idempotencyKey: key }); onDone(r.requestId); } };
}
function workOrderAsk(options: { technicians: Option[]; suppliers: Option[] }, onDone: (id: string) => void, from: { requestId?: string; assetId?: string; title?: string } = {}): Ask {
  return { title: "New Work Order", confirm: "Create", description: "Outside-vendor work, and work estimated at or above the Company's threshold, waits for approval before it starts.",
    fields: [...(from.requestId || from.assetId ? [] : [{ name: "asset", label: "Asset (code, serial number or tag)", kind: "text" as const, required: true }]),
      { name: "title", label: "Title", kind: "text", required: true, initial: from.title ?? "" }, { name: "maintenanceType", label: "Type", kind: "select", initial: "CORRECTIVE", options: TYPE_OPTIONS },
      { name: "priority", label: "Priority", kind: "select", initial: "NORMAL", options: PRIORITY_OPTIONS },
      { name: "execution", label: "Done by", kind: "select", initial: "INTERNAL", options: [{ value: "INTERNAL", label: "Our technician" }, { value: "EXTERNAL", label: "A service vendor" }, { value: "MIXED", label: "Both" }] },
      { name: "technicianUserId", label: "Technician", kind: "select", options: options.technicians }, { name: "supplierId", label: "Service vendor", kind: "select", options: options.suppliers },
      { name: "scheduledStartAt", label: "Start", kind: "datetime" }, { name: "expectedCompletionAt", label: "Target completion", kind: "datetime" },
      { name: "estimateAmount", label: "Estimated cost (approval only — never an actual cost)", kind: "quantity" },
      { name: "checklist", label: "Checklist (one check per line; all required)", kind: "textarea" }, { name: "restrictUse", label: "The asset is out of normal use while the work is done", kind: "checkbox", initial: true }],
    run: async (v, key) => {
      const r = await createWorkOrder({ ...v, requestId: from.requestId, assetId: from.assetId, technicianUserId: v.technicianUserId || undefined, supplierId: v.supplierId || undefined,
        scheduledStartAt: v.scheduledStartAt || undefined, expectedCompletionAt: v.expectedCompletionAt || undefined, estimateAmount: v.estimateAmount === "" ? undefined : v.estimateAmount,
        checklist: lines(v.checklist).map((text) => ({ text })), idempotencyKey: key });
      onDone(r.workOrderId);
    } };
}
function planAsk(options: { technicians: Option[]; suppliers: Option[] }, onDone: (id: string) => void, assetId?: string): Ask {
  return { title: "New preventive plan", confirm: "Create plan", description: "Each due service becomes one Work Order, the given number of days ahead — however often the schedule runs.",
    fields: [...(assetId ? [] : [{ name: "asset", label: "Asset (code, serial number or tag)", kind: "text" as const, required: true }]), { name: "name", label: "Service", kind: "text", required: true },
      { name: "maintenanceType", label: "Type", kind: "select", initial: "PREVENTIVE", options: [{ value: "PREVENTIVE", label: "Preventive service" }, { value: "INSPECTION", label: "Inspection" }] },
      { name: "frequencyType", label: "Repeats", kind: "select", initial: "MONTHS", options: [{ value: "MONTHS", label: "Every N months" }, { value: "DAYS", label: "Every N days" }, { value: "ONCE", label: "Once" }] },
      { name: "interval", label: "N", kind: "quantity", initial: "6" }, { name: "startDate", label: "First service date", kind: "date", required: true },
      { name: "dueRule", label: "Next due date counts from", kind: "select", initial: "SCHEDULED_DATE", options: [{ value: "SCHEDULED_DATE", label: "The scheduled date" }, { value: "COMPLETION_DATE", label: "When the last service was completed" }] },
      { name: "leadDays", label: "Create the Work Order this many days ahead", kind: "quantity", initial: "7" }, { name: "technicianUserId", label: "Technician", kind: "select", options: options.technicians },
      { name: "supplierId", label: "Service vendor", kind: "select", options: options.suppliers }, { name: "checklist", label: "Checklist (one check per line)", kind: "textarea" }],
    run: async (v) => {
      const r = await createPlan({ ...v, assetId, interval: v.frequencyType === "ONCE" ? undefined : Number(v.interval), leadDays: Number(v.leadDays), technicianUserId: v.technicianUserId || undefined,
        supplierId: v.supplierId || undefined, checklist: lines(v.checklist).map((text) => ({ text })) });
      onDone(r.planId);
    } };
}
function useOptions(enabled = true) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "options"), queryFn: getOptions, retry: false, enabled, staleTime: 60_000 });
}

// ------------------------------------------------------------------ workspace
export function MaintenanceWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  const wo = (v: string) => <WorkOrdersPanel view={v} key={v} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Maintenance" description="Reported problems, repairs and preventive servicing. An asset returns to normal use only after its repair is verified; costs are those Inventory, Procurement and Finance confirmed." />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Maintenance views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" && <OverviewPanel onOpen={select} />}
      {view === "requests" && <RequestsPanel />}
      {view === "work-orders" && wo("open")}
      {view === "mine" && wo("mine")}
      {view === "plans" && <PlansPanel />}
      {view === "scheduled" && <ScheduledPanel />}
      {view === "waiting" && wo("waiting")}
      {view === "verification" && wo("verification")}
      {view === "completed" && wo("completed")}
      {view === "exceptions" && <ExceptionsPanel />}
      {view === "reports" && <ReportsPanel />}
      {view === "audit" && <AuditPanel />}
    </div>
  );
}
function OverviewPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "overview"), queryFn: getOverview, retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  if (q.isLoading) return <LoadingState label="Loading maintenance" rows={3} />;
  if (q.isError) return denied(q.error, "maintenance");
  const d = q.data!;
  const tile = (label: string, value: number | null, view: string) => value === null ? null : (
    <button type="button" key={label} onClick={() => onOpen(view)} className="rounded-md border border-border bg-surface p-3 text-left hover:border-brand">
      <span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{value}</span></button>);
  return (
    <div className="flex flex-col gap-4">
      {(d.safetyRequests ?? 0) > 0 && <Notice tone="danger">{`${d.safetyRequests} asset${d.safetyRequests === 1 ? " is" : "s are"} restricted after a safety report.`}</Notice>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tile("Open requests", d.openRequests, "requests")}{tile("Open Work Orders", d.openWorkOrders, "work-orders")}{tile("My work", d.myWork, "mine")}
        {tile("Awaiting approval", d.pendingApproval, "work-orders")}{tile("Awaiting parts / vendor", d.waiting, "waiting")}{tile("Pending verification", d.pendingVerification, "verification")}
        {tile("Overdue", d.overdue, "exceptions")}{tile("Assets under maintenance", d.underMaintenance, "work-orders")}{tile("Service due in 30 days", d.dueSoon, "scheduled")}{tile("Exceptions", d.exceptions, "exceptions")}
      </div>
      <span className="flex flex-wrap gap-2">
        {d.can.request && <Button variant="primary" onPress={() => setAsk(reportProblemAsk((id) => router.replace(`${MAINTENANCE_BASE}/requests/${id}`)))}>Report a problem</Button>}
        {d.can.create && options.data && <Button variant="secondary" onPress={() => setAsk(workOrderAsk(options.data!, (id) => router.replace(`${MAINTENANCE_BASE}/work-orders/${id}`)))}>New Work Order</Button>}
        {d.can.export && <Link className="self-center text-sm text-brand hover:underline" href={maintenanceExportHref}>Export Work Orders</Link>}
      </span>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function RequestsPanel() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("open");
  const [search, setSearch] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "requests", view, search), queryFn: () => listRequests(view, search), retry: false });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select label="Show" size="compact" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={[{ value: "open", label: "Open" }, { value: "accepted", label: "Accepted" }, { value: "safety", label: "Safety concerns" }, { value: "closed", label: "Closed / rejected" }, { value: "all", label: "All" }]} />
        <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Request, asset or problem" />
        <span className="flex items-end">{q.data?.can.request && <Button size="compact" variant="primary" onPress={() => setAsk(reportProblemAsk((id) => router.replace(`${MAINTENANCE_BASE}/requests/${id}`)))}>Report a problem</Button>}</span>
      </div>
      {q.isLoading ? <LoadingState label="Loading requests" rows={3} /> : q.isError ? denied(q.error, "maintenance requests") : (
        <LinesTable columns={["Request", "Asset", "Problem", "Priority", "Safety", "Status", "Work Order", "Reported"]} empty={q.data!.rows.length ? undefined : "No requests here."}>
          {q.data!.rows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link></Cell><Cell>{r.asset}</Cell><Cell>{r.description}</Cell>
            <Cell><StatusBadge tone={PRIORITY_TONE[r.priority] ?? "neutral"}>{r.priority.toLowerCase()}</StatusBadge></Cell><Cell>{r.safetyConcern === "YES" ? <span className="text-danger">Possibly unsafe</span> : r.safetyConcern === "NO" ? "No" : "Not sure"}</Cell>
            <Cell><StatusBadge tone={REQUEST_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge></Cell><Cell>{r.workOrderId ? <Link className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/work-orders/${r.workOrderId}`}>{r.workOrder}</Link> : "—"}</Cell>
            <Cell>{`${r.reportedBy ?? ""} · ${dateLabel(r.reportedAt)}`}</Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function WorkOrderTable({ rows, empty }: { rows: WorkOrderRow[]; empty: string }) {
  return (
    <LinesTable columns={["Work Order", "Asset", "Title", "Priority", "Status", "Technician / vendor", "Target", ""]} empty={rows.length ? undefined : empty}>
      {rows.map((w) => <tr key={w.id}><Cell><Link className="text-brand hover:underline" href={w.href}>{w.number}</Link><span className="block text-xs text-text-muted">{w.typeLabel}{w.plan ? ` · ${w.plan}` : ""}</span></Cell>
        <Cell>{w.asset}</Cell><Cell>{w.title}</Cell><Cell><StatusBadge tone={PRIORITY_TONE[w.priority] ?? "neutral"}>{w.priority.toLowerCase()}</StatusBadge></Cell>
        <Cell><StatusBadge tone={WO_TONE[w.status] ?? "neutral"}>{w.statusLabel}</StatusBadge>{w.outcomeLabel && <span className="block text-xs text-text-muted">{w.outcomeLabel}</span>}</Cell>
        <Cell>{[w.technician, w.supplier].filter(Boolean).join(" · ") || "Unassigned"}</Cell><Cell>{w.expectedCompletionAt ? dateLabel(w.expectedCompletionAt) : "—"}</Cell>
        <Cell>{w.overdue && <span className="text-danger">Overdue</span>}</Cell></tr>)}
    </LinesTable>
  );
}
function WorkOrdersPanel({ view: initial }: { view: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [search, setSearch] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "work-orders", view, search), queryFn: () => listWorkOrders(view, search), retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  const filterable = ["open", "approval", "in_progress", "overdue", "preventive", "cancelled", "all"].includes(view);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {filterable && <Select label="Show" size="compact" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={[{ value: "open", label: "All open" }, { value: "approval", label: "Draft / awaiting approval" },
          { value: "in_progress", label: "In progress" }, { value: "overdue", label: "Overdue" }, { value: "preventive", label: "Preventive" }, { value: "cancelled", label: "Cancelled" }, { value: "all", label: "All" }]} />}
        <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Work Order, asset or title" />
        <span className="flex items-end">{q.data?.can.create && options.data && <Button size="compact" variant="primary" onPress={() => setAsk(workOrderAsk(options.data!, (id) => router.replace(`${MAINTENANCE_BASE}/work-orders/${id}`)))}>New Work Order</Button>}</span>
      </div>
      {q.isLoading ? <LoadingState label="Loading Work Orders" rows={3} /> : q.isError ? denied(q.error, "Work Orders") : <WorkOrderTable rows={q.data!.rows} empty={view === "mine" ? "Nothing assigned to you." : "No Work Orders here."} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function PlansPanel() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const refresh = useRefresh();
  const [view, setView] = useState("active");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "plans", view), queryFn: () => listPlans(view), retry: false });
  const options = useOptions(Boolean(q.data?.can.manage));
  const generate = async () => { try { const r = await generateDue(); setNote(`${r.generated} Work Order${r.generated === 1 ? "" : "s"} created for services now due.`); await refresh(); } catch (e) { setNote(errorMessage(e)); } };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select label="Show" size="compact" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={[{ value: "active", label: "Active" }, { value: "due", label: "Due in 30 days" }, { value: "overdue", label: "Overdue" }, { value: "paused", label: "Paused / inactive" }, { value: "all", label: "All" }]} />
        <span className="flex items-end gap-2 sm:col-span-2">{q.data?.can.manage && options.data && <Button size="compact" variant="primary" onPress={() => setAsk(planAsk(options.data!, (id) => router.replace(`${MAINTENANCE_BASE}/plans/${id}`)))}>New plan</Button>}
          {q.data?.can.manage && <Button size="compact" variant="secondary" onPress={generate}>Create due Work Orders now</Button>}</span>
      </div>
      {note && <Notice tone="info">{note}</Notice>}
      {q.isLoading ? <LoadingState label="Loading plans" rows={3} /> : q.isError ? denied(q.error, "preventive plans") : (
        <LinesTable columns={["Plan", "Asset", "Service", "Repeats", "Next due", "Last done", "Technician / vendor", "Status"]} empty={q.data!.rows.length ? undefined : "No plans here."}>
          {q.data!.rows.map((p) => <tr key={p.id}><Cell><Link className="text-brand hover:underline" href={p.href}>{p.number}</Link></Cell><Cell>{p.asset}</Cell><Cell>{p.name}</Cell><Cell>{p.frequency}</Cell>
            <Cell>{p.overdue ? <span className="text-danger">{dateLabel(p.nextDueDate)}</span> : dateLabel(p.nextDueDate)}</Cell><Cell>{dateLabel(p.lastCompletedDate)}</Cell>
            <Cell>{[p.technician, p.supplier].filter(Boolean).join(" · ") || "—"}</Cell><Cell>{p.status.toLowerCase()}</Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function ScheduledPanel() {
  const workspace = useWorkspaceContext();
  const due = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "due"), queryFn: () => getDue(90), retry: false });
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Scheduled Work Orders"><WorkOrdersPanel view="scheduled" /></Panel>
      <Panel title="Service due in the next 90 days">
        {due.isLoading ? <LoadingState label="Loading" rows={3} /> : due.isError ? denied(due.error, "scheduled service") : (
          <LinesTable columns={["Due", "Asset", "Service", "Plan", "Technician / vendor"]} empty={due.data!.length ? undefined : "Nothing due."}>
            {due.data!.map((d, i) => <tr key={i}><Cell>{d.overdue ? <span className="text-danger">{dateLabel(d.dueDate)}</span> : dateLabel(d.dueDate)}</Cell><Cell>{d.asset}</Cell><Cell>{d.name}</Cell>
              <Cell><Link className="text-brand hover:underline" href={d.href}>{d.plan}</Link></Cell><Cell>{[d.technician, d.supplier].filter(Boolean).join(" · ") || "—"}</Cell></tr>)}
          </LinesTable>
        )}
      </Panel>
    </div>
  );
}
function ExceptionsPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "exceptions"), queryFn: getExceptions, retry: false });
  if (q.isLoading) return <LoadingState label="Loading exceptions" rows={3} />;
  if (q.isError) return denied(q.error, "maintenance exceptions");
  return (
    <LinesTable columns={["Exception", "Record", "Asset", "Detail"]} empty={q.data!.length ? undefined : "No exceptions."}>
      {q.data!.map((e, i) => <tr key={i}><Cell>{e.label}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.number}</Link></Cell><Cell>{e.asset}</Cell><Cell>{e.detail}</Cell></tr>)}
    </LinesTable>
  );
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(REPORT_KINDS[0].id);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "report", kind), queryFn: () => getReport(kind), retry: false });
  const rows = q.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => !["href", "assetId", "planId", "linkId", "id"].includes(x)) : [];
  const flat = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} />}>
      {kind.startsWith("costs") && <Notice tone="neutral">Approved estimates, committed purchase orders and actual costs Finance and Inventory confirmed are shown separately; a billed order is counted once, on its bill.</Notice>}
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
          {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{flat(r[x])}</Link> : flat(r[x])}</Cell>)}</tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}
function AuditPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "audit"), queryFn: getAudit, retry: false });
  if (q.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (q.isError) return denied(q.error, "the maintenance history");
  return (
    <LinesTable columns={["When", "Record", "Asset", "Action", "Change", "By", "Reason"]} empty={q.data!.length ? undefined : "Nothing recorded yet."}>
      {q.data!.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.record ?? "—"}</Cell><Cell>{e.asset ?? "—"}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase()}</Cell>
        <Cell>{e.from || e.to ? `${e.from ?? "—"} → ${e.to ?? "—"}` : ""}</Cell><Cell>{e.by}</Cell><Cell>{e.reason ?? ""}</Cell></tr>)}
    </LinesTable>
  );
}
function History({ events }: { events: Array<{ id: string; action: string; from: string | null; to: string | null; reason: string | null; by: string; at: string }> }) {
  return (
    <Panel title="Activity">
      <LinesTable columns={["When", "What", "By", "Note"]} empty={events.length ? undefined : "Nothing yet."}>
        {events.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase()}{e.to && e.to !== e.from ? ` → ${e.to.replace(/_/g, " ").toLowerCase()}` : ""}</Cell><Cell>{e.by}</Cell><Cell>{e.reason ?? ""}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}

// ------------------------------------------------------------------ one request
export function MaintenanceRequestScreen({ requestId }: { requestId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "request", requestId), queryFn: () => getRequest(requestId), retry: false });
  const options = useOptions(Boolean(q.data?.can.createWorkOrder));
  if (q.isLoading) return <LoadingState label="Loading request" rows={4} />;
  if (q.isError) return denied(q.error, "this request");
  const r = q.data!;
  const triage = (decision: string, title: string, extra: Ask["fields"] = []): Ask => ({ title, confirm: title, fields: [{ name: "note", label: decision === "ACCEPT" ? "Note" : "Reason", kind: "textarea", required: decision !== "ACCEPT" }, ...extra],
    tone: decision === "REJECT" ? "danger" : "primary", run: async (v) => { await requestAction(r.id, "triage", { ...v, decision }); await refresh(); } });
  const safeField: Ask["fields"] = r.safetyRestriction?.status === "ACTIVE" ? [{ name: "safetyAssessed", label: "Assessed: the asset is safe to use (releases this report's safety restriction)", kind: "checkbox" }] : [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${r.number} · ${r.asset}`} description={r.description}
        primaryAction={<span className="flex flex-wrap gap-2">
          {r.can.createWorkOrder && options.data && <Button variant="primary" onPress={() => setAsk(workOrderAsk(options.data!, (id) => router.replace(`${MAINTENANCE_BASE}/work-orders/${id}`), { requestId: r.id, title: r.description.slice(0, 200) }))}>Create Work Order</Button>}
          {r.can.triage && <Button variant="secondary" onPress={() => setAsk(triage("ACCEPT", "Accept"))}>Accept</Button>}
          {r.can.triage && <Button variant="secondary" onPress={() => setAsk(triage("NEEDS_INFORMATION", "Ask for information"))}>Ask for information</Button>}
          {r.can.triage && <Button variant="secondary" onPress={() => setAsk(triage("DUPLICATE", "Mark duplicate", [{ name: "duplicateOf", label: "Original request number", kind: "text", required: true }, ...safeField]))}>Duplicate</Button>}
          {r.can.triage && <Button variant="secondary" onPress={() => setAsk(triage("REJECT", "Reject", safeField))}>Reject</Button>}
          {r.can.respond && <Button variant="primary" onPress={() => setAsk({ title: "Add information", confirm: "Send", fields: [{ name: "note", label: "Information", kind: "textarea", required: true }], run: async (v) => { await requestAction(r.id, "respond", v); await refresh(); } })}>Add information</Button>}
        </span>} />
      {r.safetyRestriction?.status === "ACTIVE" && <Notice tone="danger">{`Use is restricted for safety since ${formatDateTime(r.safetyRestriction.since)}, until the asset is assessed or repaired.`}</Notice>}
      {r.status === "NEEDS_INFORMATION" && r.triageNote && <Notice tone="warning">{`More information needed: ${r.triageNote}`}</Notice>}
      <Panel title="Request"><FactList columns={3} items={[["Status", <StatusBadge key="s" tone={REQUEST_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge>], ["Type", r.typeLabel], ["Priority", r.priority.toLowerCase()],
        ["Possibly unsafe", r.safetyConcern === "YES" ? "Yes" : r.safetyConcern === "NO" ? "No" : "Not sure"], ["Condition seen", r.observedCondition?.toLowerCase() ?? "—"], ["Reported", `${r.reportedBy ?? ""} · ${formatDateTime(r.reportedAt)}`],
        ["Location then", r.location ?? "—"], ["Custodian then", r.custodian ?? "—"], ["Work Order", r.workOrderId ? <Link key="w" className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/work-orders/${r.workOrderId}`}>{`${r.workOrder} · ${r.workOrderStatus}`}</Link> : "—"],
        ...(r.duplicateOf ? [["Duplicate of", r.duplicateOf] as [string, string]] : []), ...(r.symptoms ? [["Details", r.symptoms] as [string, string]] : []), ...(r.triageNote ? [["Triage note", r.triageNote] as [string, string]] : [])]} /></Panel>
      <History events={r.events} />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ one Work Order
const DECISIONS = [{ value: "RETURN_TO_SERVICE", label: "Return to normal service" }, { value: "RETURN_WITH_LIMITATIONS", label: "Return with a limitation" }, { value: "KEEP_RESTRICTED", label: "Keep restricted — more work needed" },
  { value: "NOT_REPAIRABLE", label: "Not repairable — refer for retirement review" }];
export function MaintenanceWorkOrderScreen({ workOrderId }: { workOrderId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "work-order", workOrderId), queryFn: () => getWorkOrder(workOrderId), retry: false });
  const options = useOptions(Boolean(q.data?.can.assign || q.data?.can.followUp));
  if (q.isLoading) return <LoadingState label="Loading Work Order" rows={5} />;
  if (q.isError) return denied(q.error, "this Work Order");
  const w = q.data!;
  const act = (action: string, title: string, confirm: string, description: string, fields: Ask["fields"] = [], tone: "primary" | "danger" = "primary", shape?: (v: Record<string, string | boolean>) => Record<string, unknown>): Ask => ({
    title, confirm, description, fields, tone,
    run: async (v, key) => { const r = await workOrderAction<{ message?: string | null; note?: string | null }>(w.id, action, { ...(shape ? shape(v) : v), expectedVersion: w.version, commandId: key }); setResult(r.message ?? r.note ?? null); await refresh(); } });
  const reason = [{ name: "reason", label: "Reason", kind: "textarea" as const, required: true }];
  const checks = w.checklist.map((k) => ({ name: `check${k.lineNumber}`, label: `${k.text}${k.mandatory ? " (required)" : ""}`, kind: "select" as const, initial: k.result ?? "",
    options: [{ value: "PASS", label: "Pass" }, { value: "FAIL", label: "Fail" }, { value: "NOT_APPLICABLE", label: "Not applicable" }] }));
  const record = act("record", "Record the work", "Save", "Diagnosis, work done and check results are kept on the Work Order.", [
    { name: "diagnosis", label: "Diagnosis", kind: "textarea", initial: w.diagnosis ?? "" }, { name: "rootCause", label: "Root cause", kind: "textarea", initial: w.rootCause ?? "" },
    { name: "workPerformed", label: "Work performed", kind: "textarea", initial: w.workPerformed ?? "" }, { name: "remainingIssues", label: "Remaining issues", kind: "textarea", initial: w.remainingIssues ?? "" },
    { name: "recommendation", label: "Recommendation", kind: "textarea", initial: w.recommendation ?? "" }, ...checks], "primary",
    (v) => ({ diagnosis: v.diagnosis, rootCause: v.rootCause, workPerformed: v.workPerformed, remainingIssues: v.remainingIssues, recommendation: v.recommendation,
      checklist: w.checklist.filter((k) => v[`check${k.lineNumber}`]).map((k) => ({ lineNumber: k.lineNumber, result: v[`check${k.lineNumber}`] })) }));
  const facts: Array<[string, ReactNode]> = [["Status", <StatusBadge key="s" tone={WO_TONE[w.status] ?? "neutral"}>{w.statusLabel}</StatusBadge>], ["Outcome", w.outcomeLabel ?? "—"], ["Type", w.typeLabel],
    ["Priority", w.priority.toLowerCase()], ["Done by", w.execution === "INTERNAL" ? "Our technician" : w.execution === "EXTERNAL" ? "Service vendor" : "Technician and vendor"], ["Technician", w.technician ?? "—"],
    ["Vendor", w.supplier ?? "—"], ["Start", w.actualStartAt ? formatDateTime(w.actualStartAt) : w.scheduledStartAt ? `Planned ${formatDateTime(w.scheduledStartAt)}` : "—"],
    ["Target completion", w.expectedCompletionAt ? formatDateTime(w.expectedCompletionAt) : "—"], ["Work completed", w.workCompletedAt ? formatDateTime(w.workCompletedAt) : "—"],
    ["Request", w.requestId ? <Link key="r" className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/requests/${w.requestId}`}>{w.request}</Link> : "—"],
    ["Plan", w.planId ? <Link key="p" className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/plans/${w.planId}`}>{w.plan}</Link> : "—"],
    ["Condition", `${w.intakeCondition?.toLowerCase() ?? "—"} at intake · ${w.completionCondition?.toLowerCase() ?? "—"} at completion`], ["Approval", w.approvalRequired ? "Required" : "Not required"],
    ...(w.transfer ? [["Vendor trip", <Link key="t" className="text-brand hover:underline" href={w.transfer.href}>{`${w.transfer.number} · ${w.transfer.status.toLowerCase()}`}</Link>] as [string, ReactNode]] : []),
    ...(w.followUpOf ? [["Follow-up of", <Link key="f" className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/work-orders/${w.followUpOf.id}`}>{w.followUpOf.number}</Link>] as [string, ReactNode]] : [])];
  const live = w.restrictions.filter((x) => x.status === "ACTIVE");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${w.number} · ${w.title}`} description={`${w.asset} · custodian ${w.assetDetail.custodian ?? "none"} · registered location ${w.location ?? "—"}`}
        primaryAction={<span className="flex flex-wrap gap-2">
          {w.can.submit && <Button variant="primary" onPress={() => setAsk(act("submit", "Submit", "Submit", "The Work Order goes for approval when it needs it."))}>Submit</Button>}
          {w.can.approve && <Button variant="primary" onPress={() => setAsk(act("approve", "Approve the work", "Approve", `Authorize ${w.title}${w.estimate !== null ? ` (estimate ${rupees(w.estimate)})` : ""}.`, [{ name: "note", label: "Note", kind: "textarea" }]))}>Approve</Button>}
          {w.can.start && <Button variant="primary" onPress={() => setAsk(act("start", "Start work", "Start", w.restrictUse ? "From now the asset is under maintenance and not available for normal use. Its custodian stays on record." : "Work starts; the asset stays in use.",
            [{ name: "intakeCondition", label: "Condition at intake", kind: "select", required: true, options: CONDITION_OPTIONS }]))}>Start work</Button>}
          {w.can.record && <Button variant="secondary" onPress={() => setAsk(record)}>Record work</Button>}
          {w.can.record && w.status === "IN_PROGRESS" && <Button variant="secondary" onPress={() => setAsk(act("waiting", "Waiting", "Save", "The waiting time is recorded; it is not working time.", [{ name: "waitingFor", label: "Waiting for", kind: "select", required: true, options: [{ value: "PARTS", label: "Parts" }, { value: "VENDOR", label: "The vendor" }] }, { name: "note", label: "Note", kind: "textarea" }]))}>Waiting…</Button>}
          {w.can.record && w.status !== "IN_PROGRESS" && <Button variant="secondary" onPress={() => setAsk(act("waiting", "Resume work", "Resume", "Work continues.", [], "primary", () => ({ waitingFor: "NONE" })))}>Resume</Button>}
          {w.can.complete && <Button variant="primary" onPress={() => setAsk(act("complete", "Complete the work", "Complete", "The technician's work is finished. The asset stays restricted until someone verifies the repair.",
            [{ name: "workPerformed", label: "Work performed", kind: "textarea", required: !w.workPerformed, initial: w.workPerformed ?? "" }, { name: "completionCondition", label: "Condition at completion", kind: "select", required: true, options: CONDITION_OPTIONS }]))}>Complete work</Button>}
          {w.can.verify && <Button variant="primary" onPress={() => setAsk(act("verify", "Verify the repair", "Record verification", "Confirm it is this asset, record the checks and decide whether it may return to use.",
            [{ name: "identifier", label: `Scan or type ${w.assetDetail.number}'s code, serial or tag`, kind: "text", required: true }, { name: "finalCondition", label: "Final condition", kind: "select", required: true, options: CONDITION_OPTIONS },
              { name: "testsPassed", label: "Safety and functional checks passed", kind: "checkbox" }, { name: "testResults", label: "Test results", kind: "textarea" }, { name: "decision", label: "Decision", kind: "select", required: true, options: DECISIONS },
              { name: "notes", label: "Notes (the limitation, if any)", kind: "textarea" }]))}>Verify</Button>}
          {w.can.release && <Button variant="primary" onPress={() => setAsk(act("return-to-service", "Return to service", "Return to service", "Releases this Work Order's restriction (and its request's safety restriction). Any other restriction, transfer or hold stays in force.", [{ name: "note", label: "Note", kind: "textarea" }]))}>Return to service</Button>}
          {w.can.followUp && options.data && <Button variant="secondary" onPress={() => setAsk(workOrderAsk(options.data!, (id) => router.replace(`${MAINTENANCE_BASE}/work-orders/${id}`), { assetId: w.assetId, title: `Follow-up: ${w.title}`.slice(0, 200) }))}>Follow-up Work Order</Button>}
          {w.can.reopen && <Button variant="secondary" onPress={() => setAsk(act("reopen", "Reopen", "Reopen", "A controlled correction: the Work Order is open again and restricts use again.", reason))}>Reopen</Button>}
          {w.can.cancel && <Button variant="secondary" onPress={() => setAsk(act("cancel", "Cancel the Work Order", "Cancel Work Order", "Its own restriction is released. Parts already issued stay issued; return unused parts through Inventory.", reason, "danger"))}>Cancel</Button>}
        </span>} />
      {result && <Notice tone="warning">{result}</Notice>}
      {w.legacy && <Notice tone="neutral">Carried over from the earlier maintenance list.</Notice>}
      {w.overdue && <Notice tone="danger">Past its target completion.</Notice>}
      {w.warranty.status === "POTENTIALLY_COVERED" && <Notice tone="info">{`${w.warranty.label} (until ${dateLabel(w.warranty.endDate)}${w.warranty.provider ? `, ${w.warranty.provider}` : ""}). Coverage is never assumed.`}</Notice>}
      {live.length > 0 && <Notice tone={live.some((x) => x.type !== "LIMITATION") ? "warning" : "neutral"}>{live.map((x) => `${RESTRICTION_LABEL[x.type]}${x.own ? "" : ` (from ${x.source ?? "another record"})`}`).join(" · ")}</Notice>}
      <Panel title="Work Order"><FactList columns={3} items={facts} /></Panel>
      <Panel title="Diagnosis and repair notes"><FactList columns={2} items={[["Problem", w.problem ?? "—"], ["Diagnosis", w.diagnosis ?? "—"], ["Root cause", w.rootCause ?? "—"], ["Work performed", w.workPerformed ?? "—"],
        ["Remaining issues", w.remainingIssues ?? "—"], ["Recommendation", w.recommendation ?? "—"]]} /></Panel>
      {w.checklist.length > 0 && <Panel title="Checklist"><LinesTable columns={["#", "Check", "Result", "Notes", "By"]}>
        {w.checklist.map((k) => <tr key={k.lineNumber}><Cell>{k.lineNumber}</Cell><Cell>{k.text}{k.mandatory ? "" : " (optional)"}</Cell><Cell>{k.result ? k.result.replace(/_/g, " ").toLowerCase() : "—"}</Cell><Cell>{k.notes ?? ""}</Cell><Cell>{k.by ?? ""}</Cell></tr>)}
      </LinesTable></Panel>}
      <CostPanel w={w} onAsk={setAsk} act={act} />
      <Panel title="Verification and return to service">
        <LinesTable columns={["When", "Verifier", "Final condition", "Checks", "Decision", "Notes"]} empty={w.verifications.length ? undefined : "Not verified yet."}>
          {w.verifications.map((v) => <tr key={v.id}><Cell>{formatDateTime(v.at)}</Cell><Cell>{v.verifier ?? "—"}</Cell><Cell>{v.finalCondition.toLowerCase()}</Cell><Cell>{v.testsPassed ? "Passed" : "Not passed"}</Cell>
            <Cell>{DECISIONS.find((d) => d.value === v.decision)?.label ?? v.decision}</Cell><Cell>{v.notes ?? ""}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {w.restrictions.length > 0 && <Panel title="Restrictions on this asset"><LinesTable columns={["Restriction", "Source", "Since", "Ended", "Reason"]}>
        {w.restrictions.map((x) => <tr key={x.id}><Cell>{RESTRICTION_LABEL[x.type]}</Cell><Cell>{x.source ?? "—"}</Cell><Cell>{formatDateTime(x.since)}</Cell><Cell>{x.ended ? formatDateTime(x.ended) : "Active"}</Cell><Cell>{x.releaseReason ?? x.reason ?? ""}</Cell></tr>)}
      </LinesTable></Panel>}
      {w.followUps.length > 0 && <Panel title="Follow-up Work Orders"><LinesTable columns={["Work Order", "Status"]}>{w.followUps.map((f) => <tr key={f.id}><Cell><Link className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/work-orders/${f.id}`}>{f.number}</Link></Cell><Cell>{f.status}</Cell></tr>)}</LinesTable></Panel>}
      <History events={w.events} />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
type ActFn = (action: string, title: string, confirm: string, description: string, fields?: Ask["fields"], tone?: "primary" | "danger", shape?: (v: Record<string, string | boolean>) => Record<string, unknown>) => Ask;
function CostPanel({ w, onAsk, act }: { w: WorkOrderDetail; onAsk: (a: Ask) => void; act: ActFn }) {
  const actions = <span className="flex flex-wrap gap-2">
    {w.can.parts && <Button size="compact" variant="secondary" onPress={() => onAsk(act("link-parts", "Link a goods issue", "Link", `Inventory issues the parts with ${w.number} as the reference; link the posted goods issue here. Its value is the parts cost.`, [{ name: "goodsIssue", label: "Goods issue number", kind: "text", required: true }]))}>Link parts issue</Button>}
    {w.can.vendorCost && <Button size="compact" variant="secondary" onPress={() => onAsk(act("link-vendor", "Link a vendor document", "Link", "A posted supplier bill is the actual cost; a confirmed purchase order is a commitment until it is billed.",
      [{ name: "sourceType", label: "Document", kind: "select", required: true, options: [{ value: "SUPPLIER_BILL", label: "Supplier bill" }, { value: "PURCHASE_ORDER", label: "Purchase order" }] }, { name: "source", label: "Number", kind: "text", required: true }]))}>Link vendor document</Button>}
    {w.can.warranty && <Button size="compact" variant="secondary" onPress={() => onAsk(act("warranty", "Warranty claim", "Save", "Record the claim with the provider; coverage is never assumed.",
      [{ name: "warrantyClaimReference", label: "Claim reference", kind: "text", initial: w.warranty.claimReference ?? "" }, { name: "warrantyClaimStatus", label: "Outcome", kind: "select", initial: w.warranty.claimStatus ?? "", options: [{ value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "DENIED", label: "Denied" }] }]))}>Warranty claim</Button>}
  </span>;
  const c = w.cost;
  return (
    <Panel title="Parts, vendor services and costs" actions={actions}>
      <FactList columns={3} items={[["Warranty", w.warranty.label], ["Claim", w.warranty.claimReference ? `${w.warranty.claimReference} · ${(w.warranty.claimStatus ?? "pending").toLowerCase()}` : "—"],
        ...(c ? [["Approved estimate", rupees(c.estimate)], ["Committed (purchase orders)", rupees(c.committed)], ["Actual — parts", rupees(c.parts)], ["Actual — vendor services", rupees(c.externalService)],
          ["Actual total", c.actualConfirmed ? rupees(c.actual) : "Not yet confirmed"], ["Capital improvement (Finance)", rupees(c.capitalImprovement)]] as Array<[string, string]> : [])]} />
      {c?.message && <Notice tone="neutral">{c.message}</Notice>}
      {c && c.lines.length > 0 && <LinesTable columns={["Source", "Number", "Role", { label: "Amount", numeric: true }, "Source status", "Counted", ""]}>
        {c.lines.map((l) => <tr key={l.id}><Cell>{l.sourceType.replace(/_/g, " ").toLowerCase()}</Cell><Cell>{l.source ?? "—"}</Cell><Cell>{l.role.replace(/_/g, " ").toLowerCase()}</Cell><Cell numeric>{rupees(l.amount)}</Cell>
          <Cell>{l.sourceStatus ?? "missing"}</Cell><Cell>{l.counted ? "Yes" : <span className="text-text-muted">{l.note}</span>}</Cell>
          <Cell><Button size="compact" variant="secondary" onPress={() => onAsk(act("unlink", "Unlink", "Unlink", "The document stays in Inventory or Finance; it is no longer this Work Order's cost.", [{ name: "reason", label: "Reason", kind: "textarea", required: true }], "danger", (v) => ({ ...v, linkId: l.id })))}>Unlink</Button></Cell></tr>)}
      </LinesTable>}
    </Panel>
  );
}

// ------------------------------------------------------------------ one plan
export function MaintenancePlanScreen({ planId }: { planId: string }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "plan", planId), queryFn: () => getPlan(planId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading plan" rows={4} />;
  if (q.isError) return denied(q.error, "this plan");
  const p = q.data!;
  const status = (to: string, label: string): Ask => ({ title: label, confirm: label, fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await planAction(p.id, "update", { ...v, status: to }); await refresh(); } });
  const change: Ask = { title: "Change the plan", confirm: "Save", description: "A change is a new version of the plan; Work Orders already created keep what they were given.",
    fields: [{ name: "name", label: "Service", kind: "text", required: true, initial: p.name }, { name: "interval", label: p.frequencyType === "DAYS" ? "Every N days" : "Every N months", kind: "quantity", initial: p.interval ? String(p.interval) : "" },
      { name: "nextDueDate", label: "Next due", kind: "date", initial: p.nextDueDate ?? "" }, { name: "leadDays", label: "Days ahead", kind: "quantity", initial: String(p.leadDays) }, { name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await planAction(p.id, "update", { ...v, interval: v.interval === "" ? undefined : Number(v.interval), leadDays: Number(v.leadDays), nextDueDate: v.nextDueDate || undefined }); await refresh(); } };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${p.number} · ${p.name}`} description={p.asset}
        primaryAction={p.can.manage ? <span className="flex flex-wrap gap-2"><Button variant="secondary" onPress={() => setAsk(change)}>Change</Button>
          {p.status === "ACTIVE" ? <Button variant="secondary" onPress={() => setAsk(status("PAUSED", "Pause"))}>Pause</Button> : <Button variant="primary" onPress={() => setAsk(status("ACTIVE", "Resume"))}>Resume</Button>}
          {p.status !== "INACTIVE" && <Button variant="secondary" onPress={() => setAsk(status("INACTIVE", "End the plan"))}>End</Button>}</span> : undefined} />
      {p.overdue && <Notice tone="danger">{`Service was due ${dateLabel(p.nextDueDate)}.`}</Notice>}
      <Panel title="Plan"><FactList columns={3} items={[["Status", p.status.toLowerCase()], ["Repeats", p.frequency], ["Next due", dateLabel(p.nextDueDate)], ["Counted from", p.dueRuleLabel], ["Created ahead", `${p.leadDays} days`],
        ["Last completed", dateLabel(p.lastCompletedDate)], ["Technician", p.technician ?? "—"], ["Vendor", p.supplier ?? "—"], ["Version", String(p.version)]]} /></Panel>
      {p.checklist.length > 0 && <Panel title="Checklist">{<ul className="list-disc pl-5 text-sm">{p.checklist.map((x, i) => <li key={i}>{x.text}</li>)}</ul>}</Panel>}
      <Panel title="Occurrences"><LinesTable columns={["Due", "#", "Status", "Work Order", "Outcome"]} empty={p.occurrences.length ? undefined : "None yet: the first is created ahead of its due date."}>
        {p.occurrences.map((o) => <tr key={o.id}><Cell>{dateLabel(o.dueDate)}</Cell><Cell>{o.index}</Cell><Cell>{o.status.toLowerCase()}</Cell>
          <Cell>{o.workOrderId ? <Link className="text-brand hover:underline" href={`${MAINTENANCE_BASE}/work-orders/${o.workOrderId}`}>{`${o.workOrder} · ${o.workOrderStatus}`}</Link> : "—"}</Cell><Cell>{o.outcome ?? "—"}</Cell></tr>)}
      </LinesTable></Panel>
      <History events={p.events} />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's Maintenance & Warranty panel
export function AssetMaintenancePanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "maintenance", "asset", assetId), queryFn: () => getAssetPanel(assetId), retry: false });
  const options = useOptions(Boolean(q.data?.can.create || q.data?.can.plans));
  if (q.isLoading) return <LoadingState label="Loading maintenance" rows={3} />;
  if (q.isError) return errorStatus(q.error) === 403 ? null : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const req = (r: RequestRow) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link></Cell><Cell>{r.description}</Cell><Cell>{r.statusLabel}</Cell><Cell>{dateLabel(r.reportedAt)}</Cell></tr>;
  return (
    <div className="flex flex-col gap-4">
      {d.restrictions.length > 0 && <Notice tone={d.restrictions.some((x) => x.type !== "LIMITATION") ? "warning" : "neutral"}>{d.restrictions.map((x) => `${RESTRICTION_LABEL[x.type]}${x.reason ? `: ${x.reason}` : ""}`).join(" · ")}</Notice>}
      <FactList title="Maintenance" columns={3} items={[["Open repairs", String(d.active.length)], ["Open requests", String(d.openRequests.length)], ["Next service", dateLabel(d.nextServiceDate)],
        ["Downtime", `${d.downtime.hours} hours (${d.downtime.periods} period${d.downtime.periods === 1 ? "" : "s"})`], ["Warranty", d.warranty.label], ...(d.costs ? [["Maintenance cost (confirmed)", rupees(d.costs.actual)] as [string, string], ["Committed", rupees(d.costs.committed)] as [string, string]] : [])]} />
      <span className="flex flex-wrap gap-2">
        {d.can.request && <Button size="compact" variant="primary" onPress={() => setAsk(reportProblemAsk((id) => router.push(`${MAINTENANCE_BASE}/requests/${id}`), assetId))}>Report a problem</Button>}
        {d.can.create && options.data && <Button size="compact" variant="secondary" onPress={() => setAsk(workOrderAsk(options.data!, (id) => router.push(`${MAINTENANCE_BASE}/work-orders/${id}`), { assetId }))}>New Work Order</Button>}
        {d.can.plans && options.data && <Button size="compact" variant="secondary" onPress={() => setAsk(planAsk(options.data!, (id) => router.push(`${MAINTENANCE_BASE}/plans/${id}`), assetId))}>New preventive plan</Button>}
      </span>
      {d.openRequests.length > 0 && <Panel title="Open requests"><LinesTable columns={["Request", "Problem", "Status", "Reported"]}>{d.openRequests.map(req)}</LinesTable></Panel>}
      <Panel title="Active repairs"><WorkOrderTable rows={d.active} empty="No open Work Orders." /></Panel>
      {d.plans.length > 0 && <Panel title="Preventive plans"><LinesTable columns={["Plan", "Service", "Repeats", "Next due", "Status"]}>
        {d.plans.map((p) => <tr key={p.id}><Cell><Link className="text-brand hover:underline" href={p.href}>{p.number}</Link></Cell><Cell>{p.name}</Cell><Cell>{p.frequency}</Cell><Cell>{dateLabel(p.nextDueDate)}</Cell><Cell>{p.status.toLowerCase()}</Cell></tr>)}
      </LinesTable></Panel>}
      <Panel title="Maintenance history"><WorkOrderTable rows={d.history} empty="No past maintenance." /></Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
