"use client";

// Quality — Quality Control Points. The workspace (directory views, inspection requirements, conflicts and exceptions, preview, reports),
// one control point (overview, applicability, inspection standard, quality gate, versions, trigger history, linked inspections, activity),
// one inspection requirement (its gate, inspection, waivers and history), and the Quality home's queues. Actions follow the version's state and
// the person's permissions; approved rules change only through a revision, and Quality holds are released by Inventory, never from here.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask, type Field } from "@/shared/ui/AskDialog";
import { STATUS_TONE, dateLabel, errorIssues, errorMessage, errorStatus, getOptions as getSpecOptions } from "../specifications/spec-api";
import {
  QCP_BASE, QCP_REPORTS, REQUIREMENT_TONE, createQcp, decideWaiver, getQcp, getQcpConflicts, getQcpHistory, getQcpOptions, getQcpOverview, getQcpReport, getRequirement, listQcps,
  listRequirements, previewQcp, qcpAction, qcpExportHref, requirementAction, type Options, type QcpDetail, type QcpRule, type Requirement,
} from "./qcp-api";

const VIEWS = [{ id: "all", label: "All Control Points" }, { id: "drafts", label: "Drafts" }, { id: "pending", label: "Pending Approval" }, { id: "active", label: "Active Rules" },
  { id: "future", label: "Future Effective" }, { id: "retired", label: "Retired / Superseded" }, { id: "requirements", label: "Inspection Requirements" },
  { id: "conflicts", label: "Conflicts & Exceptions" }, { id: "preview", label: "Preview" }, { id: "reports", label: "Reports" }];
const blank = { value: "", label: "—" };
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const qty = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(Number(v)));
const denied = (error: unknown, what: string) => (errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description="It needs a quality control point permission." />
  : <Notice tone="danger">{errorMessage(error)}</Notice>);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality", "qcp") });
};
function useOptions(enabled = true) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "options"), queryFn: () => getQcpOptions().then((r) => r.options), retry: false, enabled, staleTime: 60_000 });
}
function useScopeOptions(enabled = true) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "scope-options"), queryFn: () => getSpecOptions().then((r) => r.options), retry: false, enabled, staleTime: 60_000 });
}

// ------------------------------------------------------------------ dialogs
function configFields(o: Options, v?: QcpDetail["selected"], gate = true): Field[] {
  return [
    { name: "triggerEvent", label: "When to check", kind: "select", initial: v?.trigger ?? "INVENTORY_GOODS_RECEIPT_CONFIRMED", options: o.triggers, description: "Only connected triggers can be published." },
    { name: "requirementType", label: "Requirement", kind: "select", initial: v?.requirement ?? "MANDATORY", options: o.requirements },
    ...(gate ? [{ name: "gateType", label: "Quality gate", kind: "select" as const, initial: v?.gate ?? "NONE", options: o.gates, description: "Hold stock keeps the received quantity unavailable until Quality clears it." }] : []),
    { name: "checkpointType", label: "Production checks: when (production trigger only)", kind: "select", initial: v?.checkpoint ?? "OPERATION_COMPLETION", options: o.checkpoints ?? [],
      description: "The first piece of each run, each reported output, or every N units of the order." },
    { name: "checkpointInterval", label: "Every how many units (periodic checks)", kind: "quantity", initial: v?.checkpointInterval === null || v?.checkpointInterval === undefined ? "" : String(v.checkpointInterval) },
    { name: "operationLabel", label: "Operation checked (production trigger)", kind: "text", initial: v?.operationLabel ?? "", description: "For example: Drilling (Op 20)" },
    { name: "specBinding", label: "Which standard", kind: "select", initial: v?.binding ?? "FAMILY", options: o.bindings },
    { name: "specificationId", label: "Inspection specification", kind: "select", initial: v?.specificationId ?? "", options: [blank, ...o.specifications] },
    { name: "specVersionId", label: "Exact version (locked binding only)", kind: "select", initial: v?.specVersionId ?? "", options: [blank, ...o.specVersions] },
    { name: "matchMode", label: "When a more general point also applies", kind: "select", initial: v?.matchMode ?? "OVERRIDE_DEFAULT", options: o.matchModes },
    { name: "purposeCode", label: "Inspection purpose (e.g. GENERAL, ELECTRICAL)", kind: "text", initial: v?.purpose ?? "GENERAL" },
    { name: "waiverAllowed", label: "Authorized waivers are allowed", kind: "checkbox", initial: v ? v.waiverAllowed : true },
    { name: "effectiveFrom", label: "Effective from", kind: "date", initial: v?.effectiveFrom ?? "" },
    { name: "effectiveUntil", label: "Effective until", kind: "date", initial: v?.effectiveUntil ?? "" },
  ];
}
const configBody = (x: Record<string, string | boolean>) => ({ ...x, specificationId: x.specificationId || null, specVersionId: x.specVersionId || null, effectiveFrom: x.effectiveFrom || undefined,
  effectiveUntil: x.effectiveUntil || null, checkpointInterval: x.checkpointInterval || null, operationLabel: x.operationLabel || null });
function newQcpAsk(o: Options, scope: { items: Array<{ value: string; label: string }>; categories: Array<{ value: string; label: string }> }, gate: boolean, onDone: (id: string) => void): Ask {
  return { title: "New quality control point", confirm: "Create draft", description: "When a check is required, which approved specification it uses, and whether stock waits for Quality. Nothing is enforced until it is approved and published.",
    fields: [{ name: "name", label: "Name", kind: "text", required: true, description: "For example: Incoming Cable Inspection" }, { name: "description", label: "Purpose", kind: "textarea" },
      ...configFields(o, undefined, gate), { name: "itemId", label: "Applies to the product", kind: "select", options: [blank, ...scope.items] },
      { name: "itemGroupId", label: "Or the category", kind: "select", options: [blank, ...scope.categories] }],
    run: async (x, key) => {
      const rules = x.itemId ? [{ scope: "ITEM", itemId: x.itemId }] : x.itemGroupId ? [{ scope: "CATEGORY", itemGroupId: x.itemGroupId }] : [];
      const r = await createQcp({ ...configBody(x), name: x.name, description: x.description, rules, idempotencyKey: key });
      onDone(r.controlPointId);
    } };
}

// ------------------------------------------------------------------ the workspace
export function ControlPointsWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "all");
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Quality Control Points" description="When a quality check is required, which approved standard it uses, and whether the goods wait for Quality. Inspections record the results; Inventory keeps the stock." />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Control point views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "requirements" ? <RequirementsPanel /> : view === "conflicts" ? <ConflictsPanel /> : view === "preview" ? <PreviewPanel /> : view === "reports" ? <ReportsPanel /> : <DirectoryPanel view={view} key={view} />}
    </div>
  );
}
function DirectoryPanel({ view }: { view: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "list", view, search), queryFn: () => listQcps(view, search), retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  const scope = useScopeOptions(Boolean(q.data?.can.create));
  if (q.isLoading) return <LoadingState label="Loading control points" rows={4} />;
  if (q.isError) return denied(q.error, "quality control points");
  const d = q.data!;
  if (["drafts", "pending", "future"].includes(view) && !d.can.drafts) return <Notice tone="info">Drafts and approvals are visible to those who prepare or approve control points.</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Search" value={search} onChange={setSearch} description="Code, name or purpose" />
        {d.can.create && options.data && scope.data && <Button variant="primary" onPress={() => setAsk(newQcpAsk(options.data!, scope.data!, true, (id) => router.replace(`${QCP_BASE}/${id}`)))}>New control point</Button>}
        {d.can.export && <a className="self-center text-sm text-brand hover:underline" href={qcpExportHref("register")}>Export register</a>}
      </div>
      <LinesTable columns={["Code", "Name", "When", "Requirement", "Gate", "Standard", "Active version", "In progress", "Open requirements"]} empty={d.rows.length ? undefined : "No control points here."}>
        {d.rows.map((r) => <tr key={r.id}><Cell><Link className="font-medium text-brand hover:underline" href={r.href}>{r.code}</Link></Cell><Cell>{r.name}</Cell><Cell>{r.trigger}</Cell>
          <Cell>{r.requirement}</Cell><Cell>{r.gate}</Cell><Cell>{r.specification ?? "By applicability"}</Cell>
          <Cell>{r.active ? `v${r.active.number} since ${dateLabel(r.active.effectiveFrom)}` : r.status === "RETIRED" ? <StatusBadge tone="neutral">Retired</StatusBadge> : "—"}</Cell>
          <Cell>{r.open ? <StatusBadge tone={STATUS_TONE[r.open.status] ?? "neutral"}>{`v${r.open.number} ${r.open.statusLabel}`}</StatusBadge> : "—"}</Cell><Cell numeric>{r.openRequirements}</Cell></tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function RequirementsTable({ rows }: { rows: Requirement[] }) {
  return (
    <LinesTable columns={["Requirement", "Source", "Item", "Standard", "Inspection", "Controlled", "Status", "Outcome"]} empty={rows.length ? undefined : "No inspection requirements here."}>
      {rows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{`${r.controlPoint} · ${r.purpose}`}</Link>{r.blocking && <span className="block text-xs text-text-muted">Holds stock</span>}</Cell>
        <Cell>{r.sourceHref ? <Link className="text-brand hover:underline" href={r.sourceHref}>{r.source}</Link> : r.source ?? "—"}</Cell><Cell>{r.item ?? "—"}</Cell>
        <Cell>{r.specification ?? "—"}</Cell><Cell>{r.inspection ? <Link className="text-brand hover:underline" href={r.inspection.href}>{r.inspection.number}</Link> : "—"}</Cell>
        <Cell numeric>{qty(r.controlled)}</Cell><Cell><StatusBadge tone={REQUIREMENT_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge></Cell><Cell>{r.outcome ?? "—"}</Cell></tr>)}
    </LinesTable>
  );
}
function RequirementsPanel() {
  const workspace = useWorkspaceContext();
  const [view, setView] = useState("open");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "requirements", view), queryFn: () => listRequirements(view), retry: false });
  return (
    <div className="flex flex-col gap-3">
      <Select label="Show" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={[{ value: "open", label: "Inspections required" }, { value: "awaiting-clearance", label: "Stock awaiting Quality clearance" },
        { value: "all", label: "Every requirement" }]} />
      {q.isLoading ? <LoadingState label="Loading requirements" rows={3} /> : q.isError ? denied(q.error, "inspection requirements") : <RequirementsTable rows={q.data!.rows} />}
    </div>
  );
}
function ConflictsPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "conflicts"), queryFn: getQcpConflicts, retry: false });
  if (q.isLoading) return <LoadingState label="Checking the rules" rows={3} />;
  if (q.isError) return denied(q.error, "conflicts");
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Overlapping rules" description="Two active points replace the general rule for the same scope and purpose. Vercentlabs never chooses between them.">
        <LinesTable columns={["When", "Purpose", "First", "Second"]} empty={q.data!.overlaps.length ? undefined : "No overlapping rules."}>
          {q.data!.overlaps.map((x, i) => <tr key={i}><Cell>{x.trigger}</Cell><Cell>{x.purpose}</Cell><Cell><Link className="text-brand hover:underline" href={x.first.href}>{x.first.code}</Link></Cell>
            <Cell><Link className="text-brand hover:underline" href={x.second.href}>{x.second.code}</Link></Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Requirements held by an exception" description="A conflict or a missing approved specification: the stock stays restricted until Quality corrects the configuration and re-evaluates.">
        <RequirementsTable rows={q.data!.exceptions} />
      </Panel>
    </div>
  );
}
function PreviewPanel() {
  const scope = useScopeOptions();
  const [input, setInput] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof previewQcp>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = scope.data;
  const set = (k: string) => (v: unknown) => setInput((x) => ({ ...x, [k]: String(v ?? "") }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">Test the rules against an example goods receipt: nothing is created.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Product" selectedKey={input.itemId || null} onSelectionChange={set("itemId")} options={o?.items ?? []} />
        <Select label="Supplier" selectedKey={input.supplierId || null} onSelectionChange={set("supplierId")} options={[blank, ...(o?.suppliers ?? [])]} />
        <Select label="Site" selectedKey={input.warehouseId || null} onSelectionChange={set("warehouseId")} options={[blank, ...(o?.sites ?? [])]} />
        <TextField label="Receipt date" type="date" value={input.date ?? ""} onChange={set("date")} />
        <Button variant="primary" isDisabled={!input.itemId} onPress={async () => { setError(null); try { setResult(await previewQcp({ ...input, trigger: "INVENTORY_GOODS_RECEIPT_CONFIRMED" })); } catch (e) { setError(errorMessage(e)); } }}>Preview</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {result && <Panel title={result.holdsStock ? "The received quantity would be held until Quality clears it" : "The received quantity would not be held"}>
        <LinesTable columns={["Control point", "Requirement", "Gate", "Purpose", "Standard"]} empty={result.requirements.length ? undefined : "No control point applies: no inspection is required."}>
          {result.requirements.map((r) => <tr key={r.code}><Cell>{`${r.code} · ${r.name}`}</Cell><Cell>{r.requirement}</Cell><Cell>{r.gate}</Cell><Cell>{r.purpose}</Cell><Cell>{r.specification ?? <span className="text-danger">{r.problem}</span>}</Cell></tr>)}
        </LinesTable>
        {result.conflicts.map((k) => <Notice key={k.purpose} tone="warning">{`Conflict for ${k.purpose}: ${k.controlPoints.map((x) => x.code).join(", ")} apply equally. The receipt would be held with a configuration exception.`}</Notice>)}
      </Panel>}
    </div>
  );
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState("register");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "report", kind), queryFn: () => getQcpReport(kind), retry: false });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Report" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={QCP_REPORTS.map((r) => ({ value: r.id, label: r.label }))} />
        <a className="self-center text-sm text-brand hover:underline" href={qcpExportHref(kind)}>Export CSV</a>
      </div>
      {q.isLoading ? <LoadingState label="Preparing the report" rows={3} /> : q.isError ? denied(q.error, "this report") : (
        <LinesTable columns={q.data!.columns.map((c) => c.replace(/_/g, " "))} empty={q.data!.rows.length ? undefined : "Nothing to report."}>
          {q.data!.rows.map((r, i) => <tr key={i}>{q.data!.columns.map((c, j) => <Cell key={c}>{j === 0 && r.href ? <Link className="text-brand hover:underline" href={r.href}>{str(r[c])}</Link>
            : /(_from|_until|_at|^at|^date)$/.test(c) && r[c] ? dateLabel(str(r[c])) : str(r[c]) || "—"}</Cell>)}</tr>)}
        </LinesTable>)}
      <p className="text-xs text-text-muted">Required, created, performed, passed, failed, waived and released quantities are reported separately; they are not interchangeable.</p>
    </div>
  );
}

// ------------------------------------------------------------------ one control point
const TABS = [{ id: "overview", label: "Overview" }, { id: "applicability", label: "Applicability" }, { id: "standard", label: "Inspection Standard" }, { id: "gate", label: "Quality Gate" },
  { id: "versions", label: "Version History" }, { id: "triggers", label: "Trigger History" }, { id: "inspections", label: "Linked Inspections" }, { id: "activity", label: "Activity & Audit" }];
export function ControlPointDetailScreen({ pointId }: { pointId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const refresh = useRefresh();
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const versionId = params.get("version") ?? undefined;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "detail", pointId, versionId ?? ""), queryFn: () => getQcp(pointId, versionId), retry: false });
  const options = useOptions(Boolean(q.data && (q.data.can.edit || q.data.can.copy)));
  const scope = useScopeOptions(Boolean(q.data && (q.data.can.edit || q.data.can.manual)));
  if (q.isLoading) return <LoadingState label="Loading the control point" rows={5} />;
  if (q.isError) return denied(q.error, "this control point");
  const d = q.data!;
  const v = d.selected;
  const go = (id: string) => { setTab(id); router.replace(`${pathname}?${new URLSearchParams({ ...(versionId ? { version: versionId } : {}), tab: id })}`, { scroll: false }); };
  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setFailure(null);
    try { await qcpAction(pointId, action, { versionId: v.id, version: v.version, ...body }); await refresh(); }
    catch (error) { const issues = errorIssues(error); setFailure(issues.length > 1 ? issues.map((x) => x.message).join(" · ") : errorMessage(error)); throw error; }
  };
  const note = (title: string, confirm: string, action: string): Ask => ({ title, confirm, fields: [{ name: "note", label: "Note", kind: "textarea", required: true }], run: async (x) => { await run(action, { note: x.note }); } });
  const setRules = (rules: QcpRule[] | Array<Record<string, unknown>>) => run("edit", { rules: rules.map((r) => ({ scope: (r as QcpRule).scope, itemId: (r as QcpRule).itemId, itemGroupId: (r as QcpRule).itemGroupId,
    supplierId: (r as QcpRule).supplierId, warehouseId: (r as QcpRule).warehouseId })) });
  const actions: ReactNode[] = [];
  if (d.can.edit && options.data) actions.push(<Button key="edit" variant="secondary" onPress={() => setAsk({ title: "Configure", confirm: "Save", fields: [
    { name: "name", label: "Name", kind: "text", required: true, initial: d.name }, { name: "description", label: "Purpose", kind: "textarea", initial: d.description },
    ...configFields(options.data!, v, d.can.gate), ...(v.number > 1 ? [{ name: "revisionReason", label: "Reason for this revision", kind: "textarea" as const, required: true, initial: v.revisionReason ?? "" }] : [])],
    run: async (x) => { await run("edit", configBody(x)); } })}>Configure</Button>);
  if (d.can.submit) actions.push(<Button key="submit" variant="primary" onPress={() => run("submit").catch(() => undefined)}>Submit for approval</Button>);
  if (d.can.approve) actions.push(<Button key="approve" variant="primary" onPress={() => setAsk({ title: `Approve version ${v.number}`, confirm: "Approve", fields: [{ name: "note", label: "Approval note", kind: "textarea" },
    { name: "publish", label: "Publish now as well (when you may publish)", kind: "checkbox", initial: true }], run: async (x) => { await run("approve", { note: x.note, publish: x.publish }); } })}>Approve</Button>);
  if (d.can.review) actions.push(<Button key="changes" variant="secondary" onPress={() => setAsk(note("Request changes", "Send back", "request-changes"))}>Request changes</Button>,
    <Button key="reject" variant="danger" onPress={() => setAsk(note("Reject this version", "Reject", "reject"))}>Reject</Button>);
  if (d.can.publish) actions.push(<Button key="publish" variant="primary" onPress={() => run("publish").catch(() => undefined)}>{`Publish (effective ${dateLabel(v.effectiveFrom)})`}</Button>);
  if (d.can.revise) actions.push(<Button key="revise" variant="secondary" onPress={() => setAsk({ title: "Create a revision", confirm: "Create revision", description: "The current version stays in force until the revision is approved and takes effect. Existing requirements keep their version.",
    fields: [{ name: "reason", label: "Why is it revised?", kind: "textarea", required: true }, { name: "effectiveFrom", label: "Effective from", kind: "date" }],
    run: async (x, key) => { const r = await qcpAction<{ versionId: string }>(pointId, "revise", { reason: x.reason, effectiveFrom: x.effectiveFrom || undefined, idempotencyKey: key }); await refresh();
      router.replace(`${QCP_BASE}/${pointId}?version=${r.versionId}`); } })}>Create revision</Button>);
  if (d.can.copy) actions.push(<Button key="copy" variant="secondary" onPress={() => setAsk({ title: "Copy as a new control point", confirm: "Copy", fields: [{ name: "name", label: "Name", kind: "text", required: true, initial: `${d.name} (copy)` }],
    run: async (x, key) => { const r = await qcpAction<{ controlPointId: string }>(pointId, "copy", { name: x.name, idempotencyKey: key }); router.replace(`${QCP_BASE}/${r.controlPointId}`); } })}>Copy</Button>);
  if (d.can.manual && scope.data) actions.push(<Button key="manual" variant="primary" onPress={() => setAsk({ title: "Start an inspection", confirm: "Start", fields: [
    { name: "itemId", label: "Product", kind: "select", options: scope.data!.items, required: true }, { name: "warehouseId", label: "Site", kind: "select", options: [blank, ...scope.data!.sites] },
    { name: "quantity", label: "Quantity to inspect", kind: "quantity", initial: "1", required: true }, { name: "reason", label: "Why", kind: "textarea", required: true }],
    run: async (x, key) => { const r = await qcpAction<{ inspectionId: string }>(pointId, "manual-inspection", { ...x, warehouseId: x.warehouseId || undefined, idempotencyKey: key }); router.replace(`/quality/incoming/${r.inspectionId}`); } })}>Start inspection</Button>);
  if (d.can.retire) actions.push(<Button key="retire" variant="danger" onPress={() => setAsk({ title: "Retire this control point", confirm: "Retire", tone: "danger",
    description: "It stops applying to new transactions. Stock already held under it stays held until its requirements are resolved.", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (x) => { await qcpAction(pointId, "retire", { reason: x.reason }); await refresh(); } })}>Retire</Button>);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${d.code} · ${d.name}`} description={[`Version ${v.number}`, v.stageLabel, v.triggerLabel, v.requirementLabel, v.gateLabel].join(" · ")} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[v.status] ?? "neutral"}>{v.statusLabel}</StatusBadge>
        {d.status === "RETIRED" && <StatusBadge tone="neutral">Control point retired</StatusBadge>}
        {d.active && d.active.id !== v.id && <Link className="text-sm text-brand hover:underline" href={`${QCP_BASE}/${pointId}?version=${d.active.id}`}>{`Active: version ${d.active.number}`}</Link>}
        {d.open && d.open.id !== v.id && <Link className="text-sm text-brand hover:underline" href={`${QCP_BASE}/${pointId}?version=${d.open.id}`}>{`Revision in progress: version ${d.open.number}`}</Link>}
        <span className="ml-auto flex flex-wrap gap-2">{actions}</span>
      </div>
      {failure && <Notice tone="danger">{failure}</Notice>}
      {!v.triggerEnabled && <Notice tone="warning">{`${v.triggerLabel} is not yet connected to its workflow, so this control point cannot be published.`}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => go(String(k))}>
        <TabList aria-label="Control point sections">{TABS.map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
      </Tabs>
      {tab === "overview" && <Panel title="Control point">
        <FactList items={[["Code", d.code], ["Purpose", d.description || "—"], ["Stage", v.stageLabel], ["When", v.triggerLabel], ...(v.checkpoint ? [["Production check", `${v.checkpointLabel ?? v.checkpoint}${v.checkpoint === "PERIODIC" && v.checkpointInterval ? ` (every ${v.checkpointInterval} units)` : ""}${v.operationLabel ? ` · ${v.operationLabel}` : ""}`] as [string, string]] : []),
          ["Requirement", v.requirementLabel], ["Gate", v.gateLabel],
          ["Version", `${v.number} — ${v.statusLabel}`], ["Effective", `${dateLabel(v.effectiveFrom)}${v.effectiveUntil ? ` – ${dateLabel(v.effectiveUntil)}` : " onwards"}`],
          ["Open requirements", `${d.requirements.open} of ${d.requirements.total}`], ...(d.carriedOver ? [["Origin", "Carried over from an inspection requirement rule"] as [string, ReactNode]] : [])]} />
        {v.reviewNote && <Notice tone="warning">{`Reviewer: ${v.reviewNote}`}</Notice>}
        {v.issues.length > 0 && <Notice tone="warning"><span className="font-medium">Before this version can be submitted:</span><ul className="ml-4 list-disc">{v.issues.map((x, i) => <li key={i}>{x.message}</li>)}</ul></Notice>}
        {v.integrity && !v.integrity.intact && <Notice tone="danger">The rule no longer matches its approval fingerprint — report this to your administrator.</Notice>}
      </Panel>}
      {tab === "applicability" && <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">The most specific rule decides, as for specifications: product + supplier + site, then product + supplier or site, then the product, then its category, then the Company default.</p>
        {d.can.edit && scope.data && <span><Button variant="primary" onPress={() => setAsk({ title: "Add an applicability rule", confirm: "Add", fields: [
          { name: "scope", label: "Applies to", kind: "select", initial: "ITEM", options: [{ value: "ITEM", label: "A product" }, { value: "CATEGORY", label: "A category" }, { value: "COMPANY_DEFAULT", label: "Every product (Company default)" }] },
          { name: "itemId", label: "Product", kind: "select", options: [blank, ...scope.data!.items] }, { name: "itemGroupId", label: "Category", kind: "select", options: [blank, ...scope.data!.categories] },
          { name: "supplierId", label: "Only from this supplier", kind: "select", options: [blank, ...scope.data!.suppliers] }, { name: "warehouseId", label: "Only at this site", kind: "select", options: [blank, ...scope.data!.sites] }],
          run: async (x) => { await setRules([...v.rules, { scope: x.scope, itemId: x.itemId || null, itemGroupId: x.itemGroupId || null, supplierId: x.supplierId || null, warehouseId: x.warehouseId || null } as unknown as QcpRule]); } })}>Add rule</Button></span>}
        <LinesTable columns={["Applies to", "Scope", "Specificity", ""]} empty={v.rules.length ? undefined : "No rules: this control point applies to nothing yet."}>
          {v.rules.map((r) => <tr key={r.id}><Cell>{r.describe}</Cell><Cell>{r.scopeLabel}</Cell><Cell numeric>{r.specificity}</Cell>
            <Cell>{d.can.edit && <Button size="compact" variant="secondary" onPress={() => setRules(v.rules.filter((x) => x.id !== r.id)).catch(() => undefined)}>Remove</Button>}</Cell></tr>)}
        </LinesTable>
      </div>}
      {tab === "standard" && <Panel title="Inspection standard">
        <FactList items={[["Binding", v.bindingLabel], ["Specification", v.standard ? <Link key="s" className="text-brand hover:underline" href={v.standard.href}>{`${v.standard.code} · ${v.standard.name}`}</Link> : "Whichever specification applies to the product"],
          ["Version used", v.binding === "LOCKED" ? `Version ${v.standard?.lockedVersion ?? "—"} only` : v.standard?.activeVersion ? `Version in force on the source date (now v${v.standard.activeVersion})` : "Resolved on the source date"],
          ["Purpose", v.purpose], ["With other points", v.matchModeLabel]]} />
        <p className="text-xs text-text-muted">Each requirement records the exact specification version it used; a later specification revision never changes it.</p>
      </Panel>}
      {tab === "gate" && <Panel title="Quality gate">
        <FactList items={[["Requirement", v.requirementLabel], ["Gate", v.gateLabel], ["Waivers", v.waiverAllowed ? "Allowed with approval by a second authorized person (never for a failed critical check)" : "Not allowed"]]} />
        <p className="text-sm text-text-secondary">{v.gate === "HOLD_STOCK" ? "The whole received quantity goes on quality hold when the receipt posts. It is released only up to what every blocking requirement allows: passed, accepted in part, or waived. Rejected quantity stays restricted for its return or disposition workflow."
          : v.requirement === "ADVISORY" ? "An inspection is created, but stock is never held by this point." : "Inspections are required, but stock is not held by this point."}</p>
      </Panel>}
      {tab === "versions" && <div className="flex flex-col gap-3">
        <LinesTable columns={["Version", "Status", "Effective", "Reason for change"]}>
          {d.versions.map((x) => <tr key={x.id}><Cell><Link className="text-brand hover:underline" href={`${QCP_BASE}/${pointId}?version=${x.id}&tab=versions`}>{`Version ${x.number}${x.current ? " (shown)" : ""}`}</Link></Cell>
            <Cell><StatusBadge tone={STATUS_TONE[x.status] ?? "neutral"}>{x.statusLabel}</StatusBadge></Cell><Cell>{`${dateLabel(x.effectiveFrom)}${x.effectiveUntil ? ` – ${dateLabel(x.effectiveUntil)}` : ""}`}</Cell><Cell>{x.revisionReason ?? "—"}</Cell></tr>)}
        </LinesTable>
        {v.comparison && <Panel title={`Changes from version ${v.comparison.from}`}><ul className="ml-4 list-disc text-sm">
          {v.comparison.changes.map((x) => <li key={x.field}>{`${x.field.replace(/_/g, " ")}: ${str(x.before) || "—"} → ${str(x.after) || "—"}`}</li>)}
          {v.comparison.rulesAdded.map((x) => <li key={`a${x}`}>{`Applies to ${x}`}</li>)}{v.comparison.rulesRemoved.map((x) => <li key={`r${x}`}>{`No longer applies to ${x}`}</li>)}
        </ul></Panel>}
      </div>}
      {tab === "triggers" && <TriggerHistory pointId={pointId} can={d.can.history} />}
      {tab === "inspections" && <LinkedRequirements pointId={pointId} />}
      {tab === "activity" && <Activity pointId={pointId} can={d.can.history} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function TriggerHistory({ pointId, can }: { pointId: string; can: boolean }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "history", pointId), queryFn: () => getQcpHistory(pointId), retry: false, enabled: can });
  if (!can) return <PermissionState title="You can't see the trigger history" description="It needs the control point history permission." />;
  if (q.isLoading) return <LoadingState label="Loading the trigger history" rows={3} />;
  if (q.isError) return denied(q.error, "the trigger history");
  return (
    <LinesTable columns={["Source", "Date", "Outcome", "Control points", "Requirements", "Held"]} empty={q.data!.triggers.length ? undefined : "No source transaction has been evaluated against this point yet."}>
      {q.data!.triggers.map((t) => <tr key={t.id}><Cell>{t.sourceHref ? <Link className="text-brand hover:underline" href={t.sourceHref}>{t.source}</Link> : t.source}</Cell><Cell>{dateLabel(t.date)}</Cell>
        <Cell>{t.outcomeLabel}</Cell><Cell>{t.controlPoints.join(", ")}</Cell><Cell numeric>{t.requirements}</Cell><Cell>{t.forcedHold ? "Yes" : "No"}</Cell></tr>)}
    </LinesTable>
  );
}
function LinkedRequirements({ pointId }: { pointId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "linked", pointId), queryFn: () => listRequirements("all", pointId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading linked inspections" rows={3} />;
  if (q.isError) return denied(q.error, "linked inspections");
  return <RequirementsTable rows={q.data!.rows} />;
}
const ACTION_LABEL: Record<string, string> = { CREATED: "Created", COPIED: "Copied", DRAFT_UPDATED: "Draft edited", SUBMITTED: "Submitted for approval", CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Rejected", APPROVED: "Approved", PUBLISHED: "Published", ACTIVATED: "Took effect", SUPERSEDED: "Superseded", REVISION_CREATED: "Revision started", RETIRED: "Retired",
  CARRIED_OVER: "Carried over", REQUIREMENT_CREATED: "Requirement created", INSPECTION_COMPLETED: "Inspection completed", SOURCE_REVERSED: "Source reversed", REEVALUATED: "Re-evaluated",
  CONFLICT_DECIDED: "Conflict decided", WAIVER_REQUESTED: "Waiver requested", WAIVER_APPROVED: "Waiver approved", WAIVER_REJECTED: "Waiver rejected", MANUAL_INSPECTION_REQUESTED: "Inspection requested" };
function Activity({ pointId, can }: { pointId: string; can: boolean }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "history", pointId), queryFn: () => getQcpHistory(pointId), retry: false, enabled: can });
  if (!can) return <PermissionState title="You can't see this control point's history" description="It needs the control point history permission." />;
  if (q.isLoading) return <LoadingState label="Loading the history" rows={3} />;
  if (q.isError) return denied(q.error, "the history");
  return <HistoryList entries={q.data!.events.map((e) => ({ summary: `${ACTION_LABEL[e.action] ?? e.action}${e.version ? ` — version ${e.version}` : ""}`, at: e.at, actor: e.by,
    detail: e.note ? <span className="text-sm text-text-secondary">{e.note}</span> : undefined }))} />;
}

// ------------------------------------------------------------------ one inspection requirement
export function RequirementDetailScreen({ obligationId }: { obligationId: string }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "requirement", obligationId), queryFn: () => getRequirement(obligationId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the requirement" rows={4} />;
  if (q.isError) return denied(q.error, "this requirement");
  const r = q.data!;
  const act = (action: string, body: Record<string, unknown>) => requirementAction(r.id, action, body).then(() => refresh());
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${r.controlPoint} · ${r.purpose}`} description={[r.source, r.item, r.specification].filter(Boolean).join(" · ")} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={REQUIREMENT_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge>
        {r.sourceReversed && <StatusBadge tone="neutral">Source reversed</StatusBadge>}
        <span className="ml-auto flex flex-wrap gap-2">
          {r.can.reevaluate && <Button variant="primary" onPress={() => setAsk({ title: "Re-evaluate", confirm: "Re-evaluate", description: "Look for the approved specification again; if one now applies, its inspection is created.",
            fields: [{ name: "note", label: "Note", kind: "textarea" }], run: async (x) => { await act("reevaluate", { note: x.note }); } })}>Re-evaluate</Button>}
          {r.can.decideConflict && <Button variant="primary" onPress={() => setAsk({ title: "Decide the conflict", confirm: "Decide", description: "Two equally specific control points applied. Decide whether this one applies to this source.",
            fields: [{ name: "decision", label: "Decision", kind: "select", initial: "KEEP", options: [{ value: "KEEP", label: "This control point applies" }, { value: "NOT_APPLICABLE", label: "Not applicable to this source" }] },
              { name: "note", label: "Why", kind: "textarea", required: true }], run: async (x) => { await act("decide-conflict", x); } })}>Decide conflict</Button>}
          {r.can.waive && <Button variant="secondary" onPress={() => setAsk({ title: "Request a waiver", confirm: "Request", description: "A controlled deviation, approved by another authorized person. It is shown as a deviation, never as a pass.",
            fields: [{ name: "requestedDisposition", label: "Requested", kind: "select", initial: "RELEASE", options: [{ value: "RELEASE", label: "Release" }, { value: "CONDITIONAL_USE", label: "Conditional use" }] },
              { name: "quantity", label: "Quantity", kind: "quantity", initial: qty(r.controlled), required: true }, { name: "reason", label: "Reason", kind: "textarea", required: true },
              { name: "riskJustification", label: "Risk and justification", kind: "textarea", required: true }, { name: "conditions", label: "Conditions", kind: "textarea" },
              { name: "evidenceReference", label: "Evidence reference", kind: "text" }], run: async (x, key) => { await act("request-waiver", { ...x, idempotencyKey: key }); } })}>Request waiver</Button>}
          {r.can.decide && r.openWaiverId && <Button variant="primary" onPress={() => setAsk({ title: "Decide the waiver", confirm: "Decide", fields: [
            { name: "decision", label: "Decision", kind: "select", initial: "APPROVE", options: [{ value: "APPROVE", label: "Approve" }, { value: "REJECT", label: "Reject" }] }, { name: "note", label: "Note", kind: "textarea", required: true }],
            run: async (x) => { await decideWaiver(r.openWaiverId!, x); await refresh(); } })}>Decide waiver</Button>}
        </span>
      </div>
      <Panel title="Requirement">
        <FactList items={[["Control point", <Link key="c" className="text-brand hover:underline" href={`${QCP_BASE}/${r.controlPointId}`}>{`${r.controlPoint} v${r.version}`}</Link>],
          ["Source", r.sourceHref ? <Link key="s" className="text-brand hover:underline" href={r.sourceHref}>{r.source}</Link> : r.source ?? "—"],
          ["Standard", r.specificationHref ? <Link key="p" className="text-brand hover:underline" href={r.specificationHref}>{r.specification}</Link> : r.specification ?? "—"],
          ["Inspection", r.inspection ? <Link key="i" className="text-brand hover:underline" href={r.inspection.href}>{`${r.inspection.number} (${r.inspection.status.replace(/_/g, " ")})`}</Link> : "—"],
          ["Controlled quantity", qty(r.controlled)], ["Accepted / rejected", `${qty(r.accepted)} / ${qty(r.rejected)}`], ["Outcome", r.outcome ?? "—"], ["Holds stock", r.blocking ? "Yes" : "No"],
          ...(r.holdHref ? [["Quality hold", <Link key="h" className="text-brand hover:underline" href={r.holdHref}>Open the Inventory hold</Link>] as [string, ReactNode]] : [])]} />
      </Panel>
      {r.gate && <Notice tone={r.gate.open.length ? "warning" : "info"}>{r.gate.open.length ? `Stock stays restricted until ${r.gate.open.join(", ")} ${r.gate.open.length === 1 ? "is" : "are"} cleared.`
        : `Quality has cleared ${r.gate.allowance} for release; ${r.gate.released} released so far. Release happens in Inventory (the receipt's held goods or the Quality Hold).`}</Notice>}
      {r.waivers.length > 0 && <Panel title="Waivers">
        <LinesTable columns={["Status", "Requested", "Quantity", "Reason", "Risk", "Decided"]}>
          {r.waivers.map((w) => <tr key={w.id}><Cell>{w.status.toLowerCase()}</Cell><Cell>{`${w.disposition === "CONDITIONAL_USE" ? "Conditional use" : "Release"} · ${w.requestedBy ?? ""} ${formatDateTime(w.requestedAt)}`}</Cell>
            <Cell numeric>{qty(w.quantity)}</Cell><Cell>{w.reason}</Cell><Cell>{w.risk}</Cell><Cell>{w.decidedAt ? `${w.decidedBy ?? ""} ${formatDateTime(w.decidedAt)} — ${w.note ?? ""}` : "—"}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      <HistoryList entries={r.events.map((e) => ({ summary: ACTION_LABEL[e.action] ?? e.action, at: e.at, actor: e.by, detail: e.note ? <span className="text-sm text-text-secondary">{e.note}</span> : undefined }))} />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the Quality home's queues
export function ControlPointsHomePanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "qcp", "overview"), queryFn: getQcpOverview, retry: false });
  if (q.isLoading || q.isError) return null;
  const c = q.data!.counts;
  const tile = (label: string, value: unknown, href: string) => value === undefined ? null : (
    <Link key={label} href={href} className="rounded-md border border-border bg-surface p-3 hover:border-brand"><span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{String(value)}</span></Link>);
  return (
    <Panel title="Quality control" description="Inspections required, stock awaiting clearance and exceptions.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Inspections required", c.inspectionsRequired, `${QCP_BASE}?view=requirements`)}{tile("Stock awaiting clearance", c.awaitingClearance, `${QCP_BASE}?view=requirements`)}
        {tile("Quality control exceptions", c.exceptions, `${QCP_BASE}?view=conflicts`)}{tile("Waivers to decide", c.waiversPending, `${QCP_BASE}?view=reports`)}
        {tile("Control points pending approval", c.approvalsPending, `${QCP_BASE}?view=pending`)}{tile("Active control points", c.activeControlPoints, `${QCP_BASE}?view=active`)}
      </div>
    </Panel>
  );
}
