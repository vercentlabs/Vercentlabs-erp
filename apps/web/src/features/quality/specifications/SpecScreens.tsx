"use client";

// Quality — Inspection Specifications. The workspace (every view of the directory, conflicts and configuration exceptions, reports), one
// specification (overview and review, checks, sampling and acceptance, applicability, versions and changes, the inspector preview, documents,
// usage, activity), Quality Settings, and the Quality home's specification panel. Every action follows the version's state and the person's
// permissions; approved content is read-only and changes through a new version.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask, type Field } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  REPORTS, SPEC_BASE, STATUS_TONE, archiveFile, createSpec, dateLabel, errorIssues, errorMessage, errorStatus, exportHref, fileHref, getConflicts, getExceptions, getHistory, getOptions, getOverview,
  getPreview, getReport, getSettings, getSpec, getUsage, listFiles, listSpecs, parseBulkChecks, settingsAction, specAction, uploadFile,
  type Check, type Issue, type Options, type SpecDetail,
} from "./spec-api";

const VIEWS = [{ id: "all", label: "All Specifications" }, { id: "drafts", label: "Drafts" }, { id: "pending", label: "Pending Approval" }, { id: "active", label: "Active" },
  { id: "scheduled", label: "Approved / Scheduled" }, { id: "retired", label: "Superseded / Retired" }, { id: "templates", label: "Templates" },
  { id: "conflicts", label: "Applicability Conflicts" }, { id: "reports", label: "Reports" }];
const DRAFT_VIEWS = ["drafts", "pending", "scheduled"];
const lines = (v: unknown) => String(v ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const denied = (error: unknown, what: string) => (errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description="It needs an inspection specification permission." />
  : <Notice tone="danger">{errorMessage(error)}</Notice>);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality", "specifications") });
};
function useOptions(enabled = true) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "options"), queryFn: () => getOptions().then((r) => r.options), retry: false, enabled, staleTime: 60_000 });
}
const blank = { value: "", label: "—" };
function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return <Notice tone="warning"><span className="font-medium">Before this version can be submitted:</span><ul className="ml-4 list-disc">{issues.map((x, i) => <li key={i}>{x.message}</li>)}</ul></Notice>;
}

// ------------------------------------------------------------------ dialogs
function newSpecAsk(o: Options, onDone: (id: string) => void): Ask {
  return { title: "New inspection specification", confirm: "Create draft", description: "Start with the basics; add the checks, the sampling and where it applies on the next page. Nothing is used by inspections until it is approved and published.",
    fields: [{ name: "name", label: "Name", kind: "text", required: true, description: "For example: USB-C Cable — Incoming Inspection" },
      { name: "description", label: "Purpose", kind: "textarea", required: true },
      { name: "stage", label: "When is it inspected?", kind: "select", initial: "INCOMING", options: o.stages },
      { name: "itemId", label: "Product", kind: "select", options: [blank, ...o.items], description: "Leave empty for a category, a Company default or a template." },
      { name: "itemGroupId", label: "Or a product category", kind: "select", options: [blank, ...o.categories] },
      { name: "samplingMethod", label: "How many units to inspect", kind: "select", initial: "ALL_UNITS", options: o.sampling },
      { name: "sampleValue", label: "Number of units, or percentage", kind: "quantity" },
      { name: "effectiveFrom", label: "Effective from", kind: "date" },
      { name: "isTemplate", label: "This is a reusable template (copied, never used directly)", kind: "checkbox" }],
    run: async (v, key) => {
      const r = await createSpec({ ...v, itemId: v.itemId || undefined, itemGroupId: v.itemId ? undefined : v.itemGroupId || undefined, sampleValue: v.sampleValue || undefined,
        effectiveFrom: v.effectiveFrom || undefined, idempotencyKey: key });
      onDone(r.specificationId);
    } };
}
const CHECK_HELP = "Fill in what applies to the type: limits and unit for a measurement, the target and tolerances for target ± tolerance, the choices for a list (one per line, end an acceptable one with *), what is acceptable for a visual check.";
function checkFields(o: Options, c?: Check): Field[] {
  return [
    { name: "name", label: "What to check", kind: "text", required: true, initial: c?.name ?? "" },
    { name: "checkType", label: "Type of check", kind: "select", initial: c?.type ?? "VISUAL", options: o.checkTypes, description: CHECK_HELP },
    { name: "instructions", label: "How to check", kind: "textarea", initial: c?.instructions ?? "" },
    { name: "acceptanceText", label: "What is acceptable (visual / pass-fail / observation)", kind: "text", initial: c?.acceptanceText ?? "" },
    { name: "unitCode", label: "Unit (measurements)", kind: "select", initial: c?.unit ?? "", options: [blank, ...o.units.map((u) => ({ value: u.code ?? u.label, label: u.label }))] },
    { name: "lowerLimit", label: "Minimum", kind: "quantity", initial: str(c?.lowerLimit) },
    { name: "upperLimit", label: "Maximum", kind: "quantity", initial: str(c?.upperLimit) },
    { name: "targetValue", label: "Target", kind: "quantity", initial: str(c?.targetValue) },
    { name: "lowerTolerance", label: "Tolerance below the target", kind: "quantity", initial: str(c?.lowerTolerance) },
    { name: "upperTolerance", label: "Tolerance above the target", kind: "quantity", initial: str(c?.upperTolerance) },
    { name: "lowerInclusive", label: "The minimum itself is acceptable", kind: "checkbox", initial: c ? c.lowerInclusive : true },
    { name: "upperInclusive", label: "The maximum itself is acceptable", kind: "checkbox", initial: c ? c.upperInclusive : true },
    { name: "decimalPlaces", label: "Decimal places recorded", kind: "quantity", initial: str(c?.decimalPlaces ?? 2) },
    { name: "expectedBoolean", label: "Expected result (pass / fail test)", kind: "select", initial: c?.expectedBoolean === false ? "false" : "true", options: [{ value: "true", label: "Yes — it works / is present" }, { value: "false", label: "No — it must not occur" }] },
    { name: "choices", label: "Choices (one per line; end an acceptable choice with *)", kind: "textarea", initial: (c?.allowedValues ?? []).map((a) => `${a.label}${a.acceptable ? "*" : ""}`).join("\n") },
    { name: "judgement", label: "Written observation is…", kind: "select", initial: c?.judgement ?? "INFORMATIONAL", options: [{ value: "INFORMATIONAL", label: "Information only (never decides a pass)" }, { value: "INSPECTOR_JUDGEMENT", label: "Judged by the inspector" }] },
    { name: "criticality", label: "Importance", kind: "select", initial: c?.criticality ?? "MAJOR", options: o.criticality },
    { name: "required", label: "Required check", kind: "checkbox", initial: c ? c.required : true },
    { name: "allowNa", label: "May be marked not applicable", kind: "checkbox", initial: c?.allowNa ?? false },
    { name: "evidenceRequired", label: "Evidence (photo or record) is required", kind: "checkbox", initial: c?.evidenceRequired ?? false },
    { name: "evidenceNote", label: "What proof is needed", kind: "text", initial: c?.evidenceNote ?? "" },
    { name: "instrumentNote", label: "Instrument / method", kind: "text", initial: c?.instrument ?? "" },
  ];
}
const checkBody = (v: Record<string, string | boolean>) => ({
  name: v.name, checkType: v.checkType, instructions: v.instructions, acceptanceText: v.acceptanceText || null, unitCode: v.unitCode || undefined, lowerLimit: v.lowerLimit, upperLimit: v.upperLimit,
  targetValue: v.targetValue, lowerTolerance: v.lowerTolerance, upperTolerance: v.upperTolerance, lowerInclusive: v.lowerInclusive, upperInclusive: v.upperInclusive, decimalPlaces: v.decimalPlaces,
  expectedBoolean: v.expectedBoolean === "true", allowedValues: lines(v.choices), judgement: v.judgement, criticality: v.checkType === "TEXT_OBSERVATION" && v.judgement === "INFORMATIONAL" ? "INFORMATIONAL" : v.criticality,
  required: v.required, allowNa: v.allowNa, evidenceRequired: v.evidenceRequired, evidenceNote: v.evidenceNote || null, instrumentNote: v.instrumentNote || null,
});

// ------------------------------------------------------------------ the workspace
export function SpecificationsWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "all");
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inspection Specifications" description="What must be checked, how, what result is acceptable and when. Approved versions are fixed; every inspection keeps the exact version it used." />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Specification views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "conflicts" ? <ConflictsPanel /> : view === "reports" ? <ReportsPanel /> : <DirectoryPanel view={view} key={view} />}
    </div>
  );
}
function DirectoryPanel({ view }: { view: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "list", view, search, stage), queryFn: () => listSpecs(view, search, stage), retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  if (q.isLoading) return <LoadingState label="Loading specifications" rows={4} />;
  if (q.isError) return denied(q.error, "inspection specifications");
  const d = q.data!;
  if (DRAFT_VIEWS.includes(view) && !d.can.drafts) return <Notice tone="info">Drafts and reviews are visible to those who prepare, review or approve specifications.</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Search" value={search} onChange={setSearch} description="Code, name, description or product" />
        <Select label="Stage" selectedKey={stage || "ALL"} onSelectionChange={(k) => setStage(String(k) === "ALL" ? "" : String(k))}
          options={[{ value: "ALL", label: "Every stage" }, ...(options.data?.stages ?? [{ value: "INCOMING", label: "Incoming goods" }, { value: "IN_PROCESS", label: "In-process" }, { value: "FINAL", label: "Final inspection" },
            { value: "PRE_DISPATCH", label: "Pre-dispatch" }, { value: "RETURN", label: "Customer return" }, { value: "MANUAL", label: "Manual / ad hoc" }])]} />
        {d.can.create && options.data && <Button variant="primary" onPress={() => setAsk(newSpecAsk(options.data!, (id) => router.replace(`${SPEC_BASE}/${id}`)))}>New specification</Button>}
        {d.can.export && <a className="self-center text-sm text-brand hover:underline" href={exportHref("register")}>Export register</a>}
      </div>
      <LinesTable columns={["Code", "Name", "Stage", "Applies to", "Active version", "In progress", "Checks", ""]} empty={d.rows.length ? undefined : "No specifications here."}>
        {d.rows.map((r) => (
          <tr key={r.id}>
            <Cell><Link className="font-medium text-brand hover:underline" href={r.href}>{r.code}</Link></Cell>
            <Cell>{r.name}{r.template && <span className="ml-2 text-xs text-text-muted">Template</span>}</Cell><Cell>{r.stageLabel}</Cell>
            <Cell>{r.item ?? (r.category ? `Category ${r.category}` : r.template ? "—" : `${r.rules} rule${r.rules === 1 ? "" : "s"}`)}{r.supplierSpecific && <span className="ml-1 text-xs text-text-muted">· supplier-specific</span>}</Cell>
            <Cell>{r.active ? `v${r.active.number} since ${dateLabel(r.active.effectiveFrom)}` : r.status === "RETIRED" ? <StatusBadge tone="neutral">Retired</StatusBadge> : "—"}</Cell>
            <Cell>{r.open ? <StatusBadge tone={STATUS_TONE[r.open.status] ?? "neutral"}>{`v${r.open.number} ${r.open.statusLabel}`}</StatusBadge> : "—"}</Cell>
            <Cell numeric>{r.checks}</Cell><Cell>{dateLabel(r.updatedAt)}</Cell>
          </tr>))}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function ConflictsPanel() {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "conflicts"), queryFn: getConflicts, retry: false });
  const ex = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "exceptions"), queryFn: () => getExceptions("OPEN"), retry: false });
  if (q.isLoading) return <LoadingState label="Checking applicability" rows={3} />;
  if (q.isError) return denied(q.error, "applicability conflicts");
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Conflicting applicability rules" description="Two equally specific specifications that one inspection could match. Vercentlabs never chooses between them: make one more specific, end one, or deactivate a rule.">
        <LinesTable columns={["Stage", "Applies to", "First", "Second"]} empty={q.data!.conflicts.length ? undefined : "No conflicts."}>
          {q.data!.conflicts.map((x, i) => <tr key={i}><Cell>{x.stageLabel}</Cell><Cell>{x.scope}</Cell>
            <Cell><Link className="text-brand hover:underline" href={x.first.href}>{`${x.first.code} · ${x.first.name}`}</Link></Cell>
            <Cell><Link className="text-brand hover:underline" href={x.second.href}>{`${x.second.code} · ${x.second.name}`}</Link></Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Configuration exceptions" description="Met while a source workflow looked for its specification: a required inspection without one, or two applicable specifications. The goods stay on hold until Quality decides.">
        <LinesTable columns={["Exception", "Item", "Supplier / site", "Source", "Raised", ""]} empty={ex.data?.rows.length ? undefined : "No open exceptions."}>
          {(ex.data?.rows ?? []).map((x) => <tr key={x.id}><Cell>{x.label}</Cell><Cell>{x.item ?? "—"}</Cell><Cell>{[x.supplier, x.site].filter(Boolean).join(" · ") || "—"}</Cell>
            <Cell>{x.sourceHref ? <Link className="text-brand hover:underline" href={x.sourceHref}>{x.source}</Link> : x.source}</Cell><Cell>{formatDateTime(x.raisedAt)}</Cell>
            <Cell>{ex.data?.can.resolve && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Resolve the exception", confirm: "Resolve", description: "Say what was done (for example: the specification was approved, or a rule was made more specific).",
              fields: [{ name: "note", label: "Resolution", kind: "textarea", required: true }, { name: "dismiss", label: "Dismiss (no action needed)", kind: "checkbox" }],
              run: async (v) => { await settingsAction("resolve-exception", { exceptionId: x.id, note: v.note, dismiss: v.dismiss }); await refresh(); } })}>Resolve</Button>}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState("register");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "report", kind), queryFn: () => getReport(kind), retry: false });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Report" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={REPORTS.map((r) => ({ value: r.id, label: r.label }))} />
        <a className="self-center text-sm text-brand hover:underline" href={exportHref(kind)}>Export CSV</a>
      </div>
      {q.isLoading ? <LoadingState label="Preparing the report" rows={3} /> : q.isError ? denied(q.error, "this report") : (
        <LinesTable columns={q.data!.columns.map((c) => c.replace(/_/g, " "))} empty={q.data!.rows.length ? undefined : "Nothing to report."}>
          {q.data!.rows.map((r, i) => <tr key={i}>{q.data!.columns.map((c, j) => <Cell key={c}>{j === 0 && r.href ? <Link className="text-brand hover:underline" href={r.href}>{str(r[c])}</Link>
            : /_(from|until|at|used)$/.test(c) && r[c] ? dateLabel(str(r[c])) : str(r[c]) || "—"}</Cell>)}</tr>)}
        </LinesTable>)}
      {kind === "coverage-gaps" && <p className="text-xs text-text-muted">Only items a mandatory Quality Control Point requires inspecting are listed; an item without a specification is not a defect by itself.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ one specification
const TABS = [{ id: "overview", label: "Overview" }, { id: "checks", label: "Checks" }, { id: "sampling", label: "Sampling & Acceptance" }, { id: "applicability", label: "Applicability" },
  { id: "versions", label: "Versions & Changes" }, { id: "preview", label: "Inspector Preview" }, { id: "documents", label: "Documents" }, { id: "usage", label: "Used By" }, { id: "activity", label: "Activity & Audit" }];
export function SpecificationDetailScreen({ specId }: { specId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const refresh = useRefresh();
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const versionId = params.get("version") ?? undefined;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [failure, setFailure] = useState<{ message: string; issues: Issue[] } | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "detail", specId, versionId ?? ""), queryFn: () => getSpec(specId, versionId), retry: false });
  const options = useOptions(Boolean(q.data && (q.data.can.edit || q.data.can.applicability || q.data.can.copy)));
  if (q.isLoading) return <LoadingState label="Loading the specification" rows={5} />;
  if (q.isError) return denied(q.error, "this specification");
  const d = q.data!;
  const v = d.selected;
  const go = (id: string) => { setTab(id); router.replace(`${pathname}?${new URLSearchParams({ ...(versionId ? { version: versionId } : {}), tab: id })}`, { scroll: false }); };
  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setFailure(null);
    try { const r = await specAction(specId, action, { versionId: v.id, version: v.version, ...body }); await refresh(); return r; }
    catch (error) { setFailure({ message: errorMessage(error), issues: errorIssues(error) }); throw error; }
  };
  const note = (title: string, confirm: string, action: string, required = true, description?: string): Ask => ({ title, confirm, description,
    fields: [{ name: "note", label: "Note", kind: "textarea", required }], run: async (x) => { await run(action, { note: x.note }); } });
  const actions: ReactNode[] = [];
  if (d.can.submit) actions.push(<Button key="submit" variant="primary" onPress={() => run("submit").catch(() => undefined)}>Submit for review</Button>);
  if (d.can.approve) actions.push(<Button key="approve" variant="primary" onPress={() => setAsk({ title: `Approve version ${v.number}`, confirm: "Approve", description: "Approval fixes this version's criteria. Publish it to make it effective from its date.",
    fields: [{ name: "note", label: "Approval note", kind: "textarea", required: d.policy.approvalNoteRequired }, { name: "publish", label: "Publish now as well (when you may publish)", kind: "checkbox", initial: true }],
    run: async (x) => { await run("approve", { note: x.note, publish: x.publish, contentHash: undefined }); } })}>Approve</Button>);
  if (d.can.review) actions.push(<Button key="changes" variant="secondary" onPress={() => setAsk(note("Request changes", "Send back", "request-changes", true, "Say what needs to change; the preparer edits the draft and submits again."))}>Request changes</Button>,
    <Button key="reject" variant="danger" onPress={() => setAsk(note("Reject this version", "Reject", "reject"))}>Reject</Button>);
  if (d.can.publish) actions.push(<Button key="publish" variant="primary" onPress={() => run("publish").catch(() => undefined)}>{`Publish (effective ${dateLabel(v.effectiveFrom)})`}</Button>);
  if (d.can.revise) actions.push(<Button key="revise" variant="secondary" onPress={() => setAsk({ title: "Create a revision", confirm: "Create revision", description: "A new draft version with the same checks. The current version stays in force until the revision is approved and takes effect.",
    fields: [{ name: "reason", label: "Why is it revised?", kind: "textarea", required: true }, { name: "effectiveFrom", label: "Effective from", kind: "date" }],
    run: async (x, key) => { const r = await specAction<{ versionId: string }>(specId, "revise", { reason: x.reason, effectiveFrom: x.effectiveFrom || undefined, idempotencyKey: key }); await refresh();
      router.replace(`${SPEC_BASE}/${specId}?version=${r.versionId}&tab=checks`); } })}>Create revision</Button>);
  if (d.can.copy && options.data) actions.push(<Button key="copy" variant="secondary" onPress={() => setAsk({ title: d.template ? "Use this template" : "Copy as a new specification", confirm: "Copy",
    fields: [{ name: "name", label: "Name", kind: "text", required: true, initial: d.template ? d.name.replace(/template/i, "").trim() : `${d.name} (copy)` },
      { name: "itemId", label: "Product", kind: "select", options: [blank, ...options.data!.items] }, { name: "itemGroupId", label: "Or a product category", kind: "select", options: [blank, ...options.data!.categories] },
      { name: "asTemplate", label: "Keep it a template", kind: "checkbox" }],
    run: async (x, key) => { const r = await specAction<{ specificationId: string }>(specId, "copy", { name: x.name, itemId: x.itemId || null, itemGroupId: x.itemId ? null : x.itemGroupId || null,
      asTemplate: x.asTemplate, versionId: v.id, idempotencyKey: key }); router.replace(`${SPEC_BASE}/${r.specificationId}`); } })}>{d.template ? "Use template" : "Copy"}</Button>);
  if (d.can.retire) actions.push(<Button key="retire" variant="danger" onPress={() => setAsk({ title: "Retire this specification", confirm: "Retire", tone: "danger",
    description: "It will not be used for new inspections. Inspections already created keep their version, and the history stays.", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (x) => { await specAction(specId, "retire", { reason: x.reason, version: d.version }); await refresh(); } })}>Retire</Button>);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${d.code} · ${d.name}`} description={[`Version ${v.number}`, d.stageLabel, d.item ? `${d.item.code} · ${d.item.name}` : d.category ? `Category ${d.category.name}` : d.template ? "Template" : "Applies through its rules",
        `Effective ${dateLabel(v.effectiveFrom)}${v.effectiveUntil ? ` – ${dateLabel(v.effectiveUntil)}` : ""}`].join(" · ")} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[v.status] ?? "neutral"}>{v.statusLabel}</StatusBadge>
        {d.status === "RETIRED" && <StatusBadge tone="neutral">Specification retired</StatusBadge>}
        {d.active && d.active.id !== v.id && <Link className="text-sm text-brand hover:underline" href={`${SPEC_BASE}/${specId}?version=${d.active.id}`}>{`Active: version ${d.active.number}`}</Link>}
        {d.open && d.open.id !== v.id && <Link className="text-sm text-brand hover:underline" href={`${SPEC_BASE}/${specId}?version=${d.open.id}`}>{`Revision in progress: version ${d.open.number}`}</Link>}
        <span className="ml-auto flex flex-wrap gap-2">{actions}</span>
      </div>
      {failure && <Notice tone="danger">{failure.message}{failure.issues.length > 1 && <ul className="ml-4 list-disc">{failure.issues.map((x, i) => <li key={i}>{x.message}</li>)}</ul>}</Notice>}
      {!d.operational && <Notice tone="info">{`${d.stageLabel} inspections are defined here; their source workflow does not yet resolve specifications automatically, so they are used through inspections started by Quality.`}</Notice>}
      {d.conflicts.length > 0 && <Notice tone="warning">{`This specification's rules overlap ${d.conflicts.map((x) => x.conflictsWith).join(", ")} for the same scope. Resolve it on the Applicability tab before publishing.`}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => go(String(k))}>
        <TabList aria-label="Specification sections">{TABS.map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
      </Tabs>
      {tab === "overview" && <OverviewTab d={d} onEdit={() => setAsk({ title: "Edit details", confirm: "Save", fields: [
        { name: "name", label: "Name", kind: "text", required: true, initial: d.name }, { name: "description", label: "Purpose", kind: "textarea", initial: d.description },
        { name: "effectiveFrom", label: "Effective from", kind: "date", initial: v.effectiveFrom }, { name: "effectiveUntil", label: "Effective until", kind: "date", initial: v.effectiveUntil ?? "" },
        ...(v.number > 1 ? [{ name: "revisionReason", label: "Reason for this revision", kind: "textarea" as const, required: true, initial: v.revisionReason ?? "" }] : [])],
        run: async (x) => { await run("edit", { ...x, effectiveUntil: x.effectiveUntil || null }); } })} />}
      {tab === "checks" && <ChecksTab d={d} options={options.data} run={run} setAsk={setAsk} />}
      {tab === "sampling" && <SamplingTab d={d} options={options.data} run={run} setAsk={setAsk} />}
      {tab === "applicability" && <ApplicabilityTab d={d} options={options.data} setAsk={setAsk} />}
      {tab === "versions" && <VersionsTab d={d} />}
      {tab === "preview" && <PreviewTab specId={specId} versionId={v.id} />}
      {tab === "documents" && <DocumentsTab d={d} />}
      {tab === "usage" && <UsageTab specId={specId} />}
      {tab === "activity" && <ActivityTab d={d} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function OverviewTab({ d, onEdit }: { d: SpecDetail; onEdit: () => void }) {
  const v = d.selected;
  const step = (n: number, label: string, done: boolean, detail: string) => (
    <li className="flex gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? "bg-brand text-white" : "border border-border"}`}>{n}</span>
      <span><span className="font-medium">{label}</span><span className="block text-xs text-text-muted">{detail}</span></span></li>);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Specification" actions={d.can.edit ? <Button size="compact" variant="secondary" onPress={onEdit}>Edit details</Button> : undefined}>
        <FactList items={[["Code", d.code], ["Purpose", d.description || "—"], ["Inspection stage", d.stageLabel], ["Product", d.item ? `${d.item.code} · ${d.item.name}${d.item.active ? "" : " (inactive)"}` : "—"],
          ["Category", d.category?.name ?? "—"], ["Method", v.methodLabel], ["Version", `${v.number} — ${v.statusLabel}`], ["Effective", `${dateLabel(v.effectiveFrom)}${v.effectiveUntil ? ` – ${dateLabel(v.effectiveUntil)}` : " onwards"}`],
          ["Created", `${formatDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ""}`], ...(d.legacyPlanCode ? [["Carried over from plan", d.legacyPlanCode] as [string, ReactNode]] : []),
          ...(d.retiredAt ? [["Retired", `${formatDateTime(d.retiredAt)}${d.retiredBy ? ` by ${d.retiredBy}` : ""} — ${d.retireReason ?? ""}`] as [string, ReactNode]] : [])]} />
      </Panel>
      <Panel title="Review & publish" description="Validate, review, approve, then publish: an approved version takes effect on its date and is never edited.">
        <ol className="flex flex-col gap-2 text-sm">
          {step(1, "Basic information", Boolean(d.name && d.description), "Name, purpose, product and stage")}
          {step(2, "Inspection checks", v.checks.length > 0, `${v.checks.length} check${v.checks.length === 1 ? "" : "s"}`)}
          {step(3, "Sampling & acceptance", true, `${v.sampling.sentence} ${v.decision.label}.`)}
          {step(4, "Applicability", d.template || d.rules.some((r) => r.status === "ACTIVE"), d.template ? "A template is copied, not applied" : `${d.rules.filter((r) => r.status === "ACTIVE").length} active rule(s)`)}
          {step(5, "Review & publish", Boolean(v.publishedAt), v.publishedAt ? `Published ${formatDateTime(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy}` : ""}`
            : v.approvedAt ? `Approved ${formatDateTime(v.approvedAt)}${v.approvedBy ? ` by ${v.approvedBy}` : ""}` : v.submittedAt ? `Submitted ${formatDateTime(v.submittedAt)}${v.submittedBy ? ` by ${v.submittedBy}` : ""}` : "Not yet submitted")}
        </ol>
        {v.reviewNote && <Notice tone="warning">{`Reviewer: ${v.reviewNote}`}</Notice>}
        <Issues issues={v.issues} />
        {v.integrity && <p className="text-xs text-text-muted">{v.integrity.intact ? "The approved content is intact (its fingerprint matches the approval)." : "The content no longer matches its approval fingerprint — report this to your administrator."}</p>}
      </Panel>
    </div>
  );
}
type TabProps = { d: SpecDetail; options?: Options; run: (action: string, body?: Record<string, unknown>) => Promise<unknown>; setAsk: (a: Ask | null) => void };
function ChecksTab({ d, options, run, setAsk }: TabProps) {
  const v = d.selected;
  const edit = d.can.edit && options;
  const move = (index: number, by: number) => {
    const ids = v.checks.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    return run("reorder", { order: ids }).catch(() => undefined);
  };
  return (
    <div className="flex flex-col gap-3">
      {edit && <span className="flex flex-wrap gap-2">
        <Button variant="primary" onPress={() => setAsk({ title: "Add a check", confirm: "Add", fields: checkFields(options!), run: async (x) => { await run("add-checks", { checks: [checkBody(x)] }); } })}>Add check</Button>
        <Button variant="secondary" onPress={() => setAsk({ title: "Add several checks", confirm: "Add all", description: "One check per line: Name | range 0.95-1.05 M · Name | target 10 -0.1 +0.15 MM · Name | yes/no · Name | choice Good*, Minor*, Severe · Name | visual No cracks · Name | note. End a name with ! for a critical check.",
          fields: [{ name: "text", label: "Checks", kind: "textarea", required: true }], run: async (x) => { await run("add-checks", { checks: parseBulkChecks(String(x.text)) }); } })}>Bulk entry</Button>
      </span>}
      {!d.can.edit && v.status !== "DRAFT" && <p className="text-sm text-text-muted">{EDITABLE_HINT[v.status] ?? "This version's checks are fixed."}</p>}
      <LinesTable columns={["#", "Check", "How to check", "Acceptable", "Importance", "Required", "Proof", ""]} empty={v.checks.length ? undefined : "No checks yet."}>
        {v.checks.map((c, i) => (
          <tr key={c.id}>
            <Cell>{c.sequence}</Cell>
            <Cell><span className="font-medium">{c.name}</span><span className="block text-xs text-text-muted">{`${c.code} · ${c.typeLabel}`}</span></Cell>
            <Cell>{c.instructions || "—"}{c.instrument && <span className="block text-xs text-text-muted">{`Use: ${c.instrument}`}</span>}</Cell>
            <Cell>{c.acceptable}</Cell>
            <Cell><StatusBadge tone={c.criticality === "CRITICAL" ? "danger" : c.criticality === "MAJOR" ? "warning" : "neutral"}>{c.criticalityLabel}</StatusBadge></Cell>
            <Cell>{c.required ? "Yes" : "Optional"}{c.allowNa && <span className="block text-xs text-text-muted">N/A allowed</span>}</Cell>
            <Cell>{c.evidenceRequired ? c.evidenceNote || "Required" : "—"}</Cell>
            <Cell>{edit && <span className="flex flex-wrap gap-1">
              <Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Edit ${c.name}`, confirm: "Save", fields: checkFields(options!, c), run: async (x) => { await run("update-check", { characteristicId: c.id, ...checkBody(x) }); } })}>Edit</Button>
              {i > 0 && <Button size="compact" variant="secondary" onPress={() => move(i, -1)}>↑</Button>}
              {i < v.checks.length - 1 && <Button size="compact" variant="secondary" onPress={() => move(i, 1)}>↓</Button>}
              <Button size="compact" variant="danger" onPress={() => run("remove-check", { characteristicId: c.id }).catch(() => undefined)}>Remove</Button></span>}</Cell>
          </tr>))}
      </LinesTable>
      <Issues issues={v.issues} />
    </div>
  );
}
const EDITABLE_HINT: Record<string, string> = { PENDING_REVIEW: "Waiting for review: the content is locked until the reviewer decides.", APPROVED: "Approved: create a revision to change the criteria.",
  ACTIVE: "In force: create a revision to change the criteria.", SUPERSEDED: "Superseded: kept unchanged for the inspections that used it.", RETIRED: "Retired.", REJECTED: "Rejected." };
function SamplingTab({ d, options, run, setAsk }: TabProps) {
  const v = d.selected;
  const s = v.sampling;
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Sampling & acceptance" actions={d.can.edit && options ? <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Sampling & acceptance", confirm: "Save",
        description: "A fixed or percentage sample is deterministic and reproducible; it is not a certified AQL plan.",
        fields: [{ name: "samplingMethod", label: "How many units to inspect", kind: "select", initial: s.method, options: options!.sampling },
          { name: "sampleValue", label: "Number of units, or percentage", kind: "quantity", initial: str(s.value) },
          { name: "roundingRule", label: "Rounding of a percentage", kind: "select", initial: s.rounding, options: options!.rounding },
          { name: "sampleMinimum", label: "At least (units)", kind: "quantity", initial: str(s.minimum) }, { name: "sampleMaximum", label: "At most (units)", kind: "quantity", initial: str(s.maximum) },
          { name: "lotContext", label: "Lot / batch", kind: "select", initial: s.lotContext, options: [{ value: "NONE", label: "Not by lot" }, { value: "PER_LOT", label: "Sample each lot / batch" }, { value: "PER_SERIAL", label: "Each serial number" }] },
          { name: "samplingInstructions", label: "How to select the samples", kind: "textarea", initial: s.instructions ?? "" },
          { name: "decisionRule", label: "How the results decide", kind: "select", initial: v.decision.rule, options: options!.decisions },
          { name: "allowedMajorDefects", label: "Allowed major defective samples", kind: "quantity", initial: str(v.decision.allowedMajor) },
          { name: "allowedMinorDefects", label: "Allowed minor defective samples", kind: "quantity", initial: str(v.decision.allowedMinor) }],
        run: async (x) => { await run("edit", { ...x, sampleValue: x.sampleValue || null, sampleMinimum: x.sampleMinimum || null, sampleMaximum: x.sampleMaximum || null,
          allowedMajorDefects: x.allowedMajorDefects === "" ? null : x.allowedMajorDefects, allowedMinorDefects: x.allowedMinorDefects === "" ? null : x.allowedMinorDefects }); } })}>Edit</Button> : undefined}>
        <FactList items={[["Method", v.methodLabel], ["Sample", s.sentence], ["Lot / batch", s.lotContext === "NONE" ? "Not by lot" : s.lotContext === "PER_LOT" ? "Each lot / batch" : "Each serial number"],
          ["Selection", s.instructions ?? "—"], ["Decision", v.decision.label + (v.decision.rule === "COUNT_BASED" ? ` — up to ${v.decision.allowedMajor ?? 0} major and ${v.decision.allowedMinor ?? 0} minor defective samples` : "")],
          ["Critical checks", "A failed critical check always fails the inspection and blocks automatic acceptance."]]} />
      </Panel>
      <p className="text-xs text-text-muted">A sample passing is not the lot&apos;s acceptance: the inspection proposes an outcome, and authorized Quality and Inventory decisions release or reject the goods.</p>
    </div>
  );
}
function ApplicabilityTab({ d, options, setAsk }: Omit<TabProps, "run">) {
  const refresh = useRefresh();
  const rules = d.rules;
  if (d.template) return <Notice tone="info">A template applies to nothing until it is copied for a product, a category or the Company.</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">The most specific rule decides: item + supplier + site, then item + supplier or site, then the item, then its category, then the Company default. Two equally specific specifications are a conflict for Quality to resolve, never a silent choice.</p>
      {d.can.applicability && options && <span><Button variant="primary" onPress={() => setAsk({ title: "Add an applicability rule", confirm: "Add rule",
        fields: [{ name: "scope", label: "Applies to", kind: "select", initial: "ITEM", options: options!.scopes }, { name: "itemId", label: "Item", kind: "select", options: [blank, ...options!.items] },
          { name: "itemGroupId", label: "Category", kind: "select", options: [blank, ...options!.categories] }, { name: "supplierId", label: "Only from this supplier", kind: "select", options: [blank, ...options!.suppliers] },
          { name: "warehouseId", label: "Only at this site", kind: "select", options: [blank, ...options!.sites] }, { name: "effectiveFrom", label: "From", kind: "date" }, { name: "effectiveUntil", label: "Until", kind: "date" },
          { name: "reason", label: "Why (required for a supplier-specific rule)", kind: "textarea" }],
        run: async (x) => { await specAction(d.id, "add-rule", { ...x, itemId: x.itemId || undefined, itemGroupId: x.itemGroupId || undefined, supplierId: x.supplierId || undefined, warehouseId: x.warehouseId || undefined,
          effectiveFrom: x.effectiveFrom || undefined, effectiveUntil: x.effectiveUntil || undefined }); await refresh(); } })}>Add rule</Button></span>}
      <LinesTable columns={["Applies to", "Scope", "Specificity", "From", "Until", "Status", "Reason", ""]} empty={rules.length ? undefined : "No rules: this specification applies to nothing yet."}>
        {rules.map((r) => <tr key={r.id}><Cell>{r.describe}</Cell><Cell>{r.scopeLabel}</Cell><Cell numeric>{r.specificity}</Cell><Cell>{dateLabel(r.effectiveFrom)}</Cell><Cell>{dateLabel(r.effectiveUntil)}</Cell>
          <Cell><StatusBadge tone={r.status === "ACTIVE" ? "success" : "neutral"}>{r.status === "ACTIVE" ? "Active" : "Inactive"}</StatusBadge></Cell><Cell>{r.reason ?? r.deactivationReason ?? "—"}</Cell>
          <Cell>{d.can.applicability && r.status === "ACTIVE" && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Deactivate the rule", confirm: "Deactivate", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
            run: async (x) => { await specAction(d.id, "deactivate-rule", { ruleId: r.id, reason: x.reason }); await refresh(); } })}>Deactivate</Button>}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}
function VersionsTab({ d }: { d: SpecDetail }) {
  const c = d.selected.comparison;
  return (
    <div className="flex flex-col gap-4">
      <LinesTable columns={["Version", "Status", "Effective", "Approved", "Reason for change"]}>
        {d.versions.map((x) => <tr key={x.id}><Cell><Link className="text-brand hover:underline" href={`${SPEC_BASE}/${d.id}?version=${x.id}&tab=versions`}>{`Version ${x.number}${x.current ? " (shown)" : ""}`}</Link></Cell>
          <Cell><StatusBadge tone={STATUS_TONE[x.status] ?? "neutral"}>{x.statusLabel}</StatusBadge></Cell><Cell>{`${dateLabel(x.effectiveFrom)}${x.effectiveUntil ? ` – ${dateLabel(x.effectiveUntil)}` : ""}`}</Cell>
          <Cell>{x.approvedAt ? formatDateTime(x.approvedAt) : "—"}</Cell><Cell>{x.revisionReason ?? "—"}</Cell></tr>)}
      </LinesTable>
      {c && <Panel title={`Changes from version ${c.from}`}>
        {!c.changes.length && !c.added.length && !c.removed.length && !c.modified.length ? <p className="text-sm text-text-muted">No changes to the criteria yet.</p> : (
          <ul className="ml-4 list-disc text-sm">
            {c.modified.map((m) => <li key={m.code}>{`${m.name}: ${m.before} → ${m.after}`}</li>)}
            {c.added.map((x) => <li key={`a${x}`}>{`Added check ${x}`}</li>)}{c.removed.map((x) => <li key={`r${x}`}>{`Removed check ${x}`}</li>)}
            {c.changes.map((x) => <li key={x.field}>{`${x.field.replace(/_/g, " ")}: ${str(x.before) || "—"} → ${str(x.after) || "—"}`}</li>)}
          </ul>)}
      </Panel>}
    </div>
  );
}
function PreviewTab({ specId, versionId }: { specId: string; versionId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "preview", versionId), queryFn: () => getPreview(specId, versionId), retry: false });
  if (q.isLoading) return <LoadingState label="Preparing the preview" rows={3} />;
  if (q.isError) return denied(q.error, "the preview");
  const p = q.data!;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <div><span className="text-lg font-semibold">{p.title}</span><span className="block text-sm text-text-muted">{`${p.code} · Version ${p.version} · ${p.stage} · ${p.method}${p.draft ? " · DRAFT PREVIEW" : ""}`}</span></div>
      <Notice tone="info">{`${p.sampling} ${p.decision}.`}</Notice>
      <LinesTable columns={["#", "What to check", "How to check", "What is acceptable", "What proof is needed"]}>
        {p.rows.map((r) => <tr key={r.sequence}><Cell>{r.sequence}</Cell><Cell><span className="font-medium">{r.check}</span>{r.critical && <span className="ml-2 text-xs text-danger">Critical</span>}
          {!r.required && <span className="ml-2 text-xs text-text-muted">Optional</span>}{r.notApplicableAllowed && <span className="ml-2 text-xs text-text-muted">N/A allowed</span>}</Cell>
          <Cell>{r.how}</Cell><Cell>{r.acceptable}</Cell><Cell>{r.proof ?? "—"}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}
function DocumentsTab({ d }: { d: SpecDetail }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "quality", "specifications", "files", d.id);
  const q = useQuery({ queryKey: key, queryFn: () => listFiles(d.id), retry: false, enabled: d.can.documents });
  if (!d.can.documents) return <PermissionState title="You can't see this specification's documents" description="It needs the specification documents permission." />;
  return (
    <div className="flex flex-col gap-3">
      {d.can.upload && <label className="text-sm">Add a drawing, standard, test procedure or reference photo
        <input className="mt-1 block text-sm" type="file" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError(null);
          try { await uploadFile(d.id, file); await client.invalidateQueries({ queryKey: key }); } catch (failure) { setError(errorMessage(failure)); }
          e.target.value = "";
        }} /></label>}
      {error && <Notice tone="danger">{error}</Notice>}
      <LinesTable columns={["Document", "Added", ""]} empty={q.data?.files.length ? undefined : "No documents."}>
        {(q.data?.files ?? []).map((f) => <tr key={f.id}><Cell><a className="text-brand hover:underline" href={fileHref(d.id, f.id)}>{f.fileName}</a></Cell><Cell>{formatDateTime(f.uploadedAt)}</Cell>
          <Cell>{d.can.upload && <Button size="compact" variant="secondary" onPress={async () => { await archiveFile(d.id, f.id).catch((x) => setError(errorMessage(x))); await client.invalidateQueries({ queryKey: key }); }}>Archive</Button>}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}
function UsageTab({ specId }: { specId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "usage", specId), queryFn: () => getUsage(specId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading linked inspections" rows={3} />;
  if (q.isError) return denied(q.error, "linked inspections");
  return (
    <LinesTable columns={["Inspection", "Version", "Item", "Source", "Lot / sample", "Chosen by", "Status", "Created"]} empty={q.data!.inspections.length ? undefined : "No inspection has used this specification yet."}>
      {q.data!.inspections.map((x) => <tr key={x.id}><Cell><Link className="text-brand hover:underline" href={x.href}>{x.number}</Link></Cell><Cell>{`v${x.version}`}</Cell><Cell>{x.item ?? "—"}</Cell>
        <Cell>{x.source.replace(/_/g, " ")}</Cell><Cell>{`${Number(x.lot)} / ${Number(x.sample)}`}</Cell><Cell>{x.method === "RULE" ? "Applicability rule" : x.method === "CARRIED_OVER" ? "Carried over" : "Selected"}</Cell>
        <Cell>{x.status.replace(/_/g, " ")}</Cell><Cell>{formatDateTime(x.at)}</Cell></tr>)}
    </LinesTable>
  );
}
const ACTION_LABEL: Record<string, string> = { CREATED: "Created", COPIED: "Copied", DRAFT_UPDATED: "Draft edited", CHECKS_ADDED: "Checks added", CHECK_UPDATED: "Check edited", CHECK_REMOVED: "Check removed",
  CHECKS_REORDERED: "Checks reordered", SUBMITTED: "Submitted for review", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected", APPROVED: "Approved", PUBLISHED: "Published", ACTIVATED: "Took effect",
  SUPERSEDED: "Superseded", REVISION_CREATED: "Revision started", RETIRED: "Retired", RULE_ADDED: "Applicability rule added", RULE_DEACTIVATED: "Applicability rule deactivated",
  DOCUMENT_ADDED: "Document added", DOCUMENT_ARCHIVED: "Document archived", CARRIED_OVER: "Carried over from a quality plan" };
function ActivityTab({ d }: { d: SpecDetail }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "history", d.id), queryFn: () => getHistory(d.id), retry: false, enabled: d.can.history });
  if (!d.can.history) return <PermissionState title="You can't see this specification's history" description="It needs the specification history permission." />;
  if (q.isLoading) return <LoadingState label="Loading the history" rows={4} />;
  if (q.isError) return denied(q.error, "the history");
  return <HistoryList entries={q.data!.events.map((e) => ({ summary: `${ACTION_LABEL[e.action] ?? e.action}${e.version ? ` — version ${e.version}` : ""}`, at: e.at, actor: e.by, detail: e.note ? <span className="text-sm text-text-secondary">{e.note}</span> : undefined }))} />;
}

// ------------------------------------------------------------------ Quality Settings
export function QualitySettingsScreen() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "settings"), queryFn: getSettings, retry: false });
  const refresh = () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality", "specifications") });
  if (q.isLoading) return <LoadingState label="Loading Quality Settings" rows={4} />;
  if (q.isError) return denied(q.error, "Quality Settings");
  const s = q.data!;
  const savePolicy = async (patch: Record<string, boolean>) => {
    setSaving(null);
    try { await settingsAction("policy", { ...s.policy, ...patch }); await refresh(); } catch (error) { setSaving(errorMessage(error)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Quality Settings" description="The approval policy for specifications and control points, the quality gate policies, and which inspection stages are connected to their source workflows." />
      <Panel title="Approval policy (specifications and control points)">
        <div className="flex flex-col gap-2">
          <Checkbox isSelected={s.policy.prohibitSelfApproval} isDisabled={!s.can.manage} onChange={(x) => savePolicy({ prohibitSelfApproval: x })}>The person who prepared or submitted a version cannot approve it</Checkbox>
          <Checkbox isSelected={s.policy.approvalNoteRequired} isDisabled={!s.can.manage} onChange={(x) => savePolicy({ approvalNoteRequired: x })}>An approval needs a note</Checkbox>
          {saving && <Notice tone="danger">{saving}</Notice>}
        </div>
      </Panel>
      <Panel title="Quality gate policies" description="Where an inspection is required, and whether stock waits for Quality, is decided by Quality Control Points. A trigger can be used only once its workflow enforces it."
        actions={<Link className="text-sm text-brand hover:underline" href="/quality/control-points">Quality Control Points</Link>}>
        <LinesTable columns={["Trigger", "Stage", "Connected", "Gates it supports"]}>
          {s.gates.map((g) => <tr key={g.value}><Cell>{g.label}</Cell><Cell>{g.stage}</Cell><Cell>{g.enabled ? <StatusBadge tone="success">Connected</StatusBadge> : <StatusBadge tone="neutral">Not yet connected</StatusBadge>}</Cell>
            <Cell>{g.gates.map((x) => x === "NONE" ? "No restriction" : x === "HOLD_STOCK" ? "Hold stock" : x === "BLOCK_DISPATCH" ? "Block dispatch" : "Block production progress").join(", ")}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Inspection stage defaults" description="A stage is marked connected only once its source workflow resolves specifications end to end.">
        <LinesTable columns={["Stage", "Connected", "Source"]}>
          {s.stages.map((x) => <tr key={x.value}><Cell>{x.label}</Cell><Cell>{x.operational ? <StatusBadge tone="success">Connected</StatusBadge> : <StatusBadge tone="neutral">Defined</StatusBadge>}</Cell><Cell>{x.integration}</Cell></tr>)}
        </LinesTable>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ the Quality home's specification panel
export function SpecificationsHomePanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "specifications", "overview"), queryFn: getOverview, retry: false });
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  const tile = (label: string, value: number | undefined, href: string) => value === undefined ? null : (
    <Link key={label} href={href} className="rounded-md border border-border bg-surface p-3 hover:border-brand"><span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{value}</span></Link>);
  return (
    <Panel title="Inspection specifications" description="Quality actions requiring attention." actions={d.can.create ? <Link className="text-sm text-brand hover:underline" href={`${SPEC_BASE}?view=all`}>New specification</Link> : undefined}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Active", d.counts.active, `${SPEC_BASE}?view=active`)}{tile("Drafts", d.counts.drafts, `${SPEC_BASE}?view=drafts`)}{tile("Pending approval", d.counts.pending, `${SPEC_BASE}?view=pending`)}
        {tile("Approved, not yet effective", d.counts.scheduled, `${SPEC_BASE}?view=scheduled`)}{tile("Applicability conflicts", d.counts.conflicts, `${SPEC_BASE}?view=conflicts`)}
        {tile("Configuration exceptions", d.counts.exceptions, `${SPEC_BASE}?view=conflicts`)}
      </div>
      {d.pending.length > 0 && <LinesTable columns={["Waiting for approval", "Version", "Submitted"]}>
        {d.pending.map((p) => <tr key={p.id}><Cell><Link className="text-brand hover:underline" href={p.href}>{`${p.code} · ${p.name}`}</Link></Cell><Cell>{`v${p.version}`}</Cell><Cell>{formatDateTime(p.submittedAt)}</Cell></tr>)}
      </LinesTable>}
    </Panel>
  );
}
