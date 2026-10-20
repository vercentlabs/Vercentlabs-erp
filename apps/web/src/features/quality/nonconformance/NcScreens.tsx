"use client";

// Quality — Nonconformances (NCR). The workspace (overview, every queue with its count, reports) and one NCR: overview with the affected
// population and the source inspection's failed checks, containment & investigation, actions, verification & closure, dependencies outside
// Quality, evidence and activity. The NCR moves Open → Under review → Action required → Verification pending → Resolved → Closed; each step
// is a server-checked command and nothing recorded is ever rewritten.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MetricStrip, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { dateLabel, errorMessage, errorStatus } from "../specifications/spec-api";
import { NC_BASE, SEVERITY_TONE, STATUS_TONE, STEPS, STEP_LABEL, ncApi, num, type NcCounts, type NcDetail, type NcOptions, type NcRow } from "./nc-api";

function Denied({ error, what }: { error: unknown; what: string }) {
  return errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description="It needs the nonconformance view permission." />
    : <Notice tone="danger">{errorMessage(error)}</Notice>;
}
const useKey = (...parts: string[]) => scopedQueryKey(useWorkspaceContext(), "quality", "nc", ...parts);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality", "nc") });
};
function useOptions(enabled = true) {
  return useQuery({ queryKey: useKey("options"), queryFn: ncApi.options, retry: false, enabled, staleTime: 60_000 });
}
const severityBadge = (row: { severity: string; severityLabel: string }) => <StatusBadge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>{row.severityLabel}</StatusBadge>;

// ------------------------------------------------------------------ the workspace
const VIEWS: Array<{ id: string; label: string; count?: keyof NcCounts }> = [{ id: "overview", label: "Overview" }, { id: "open", label: "All Open", count: "open" },
  { id: "mine", label: "Assigned to Me", count: "mine" }, { id: "new", label: "New", count: "new" }, { id: "review", label: "Under Review", count: "review" },
  { id: "action", label: "Action Required", count: "action" }, { id: "verification", label: "Verification Pending", count: "verification" }, { id: "overdue", label: "Overdue", count: "overdue" },
  { id: "resolved", label: "Resolved", count: "resolved" }, { id: "closed", label: "Closed" }, { id: "cancelled", label: "Cancelled" }, { id: "reports", label: "Reports" }];

export function NonconformanceWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const counts = useQuery({ queryKey: useKey("counts"), queryFn: ncApi.counts, retry: false });
  const options = useOptions(!counts.isError);
  if (counts.isError) return <Denied error={counts.error} what="nonconformances" />;
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  const c = counts.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Nonconformances" description="What was found wrong, how much is affected, how it was contained, why it happened, what was done about it and whether that worked. Each NCR is closed only once its actions are verified and closure is authorized."
        primaryAction={options.data?.canCreate ? <Button variant="primary" onPress={() => setAsk(newNcAsk(options.data!, (id) => router.push(`${NC_BASE}/${id}`)))}>Raise NCR</Button> : undefined} />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Nonconformance views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.count && c ? `${v.label} (${c[v.count] ?? 0})` : v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" ? <Overview onSelect={select} /> : view === "reports" ? <Reports /> : <Queue view={view} key={view} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function newNcAsk(o: NcOptions, onDone: (id: string) => void): Ask {
  return { title: "Raise a nonconformance", confirm: "Raise NCR",
    description: "Record what was found. An NCR raised from an inspection's disposition carries its failed checks; this one is raised by hand (a complaint, an audit finding, a supplier problem).",
    fields: [{ name: "title", label: "Title", kind: "text", required: true }, { name: "description", label: "What is wrong", kind: "textarea", required: true },
      { name: "severity", label: "Severity", kind: "select", required: true, initial: "major", options: o.severities },
      { name: "sourceType", label: "Where it was found", kind: "select", initial: "manual", options: o.sources },
      { name: "itemId", label: "Item affected", kind: "select", options: o.items }, { name: "affectedQuantity", label: "Quantity affected", kind: "quantity" },
      { name: "inspectionId", label: "Inspection (optional)", kind: "select", options: o.inspections },
      { name: "ownerUserId", label: "Accountable owner", kind: "select", options: o.members }, { name: "dueDate", label: "Due", kind: "date" }],
    run: async (v, key) => {
      const body = Object.fromEntries(Object.entries(v).filter(([, value]) => value !== ""));
      const made = await ncApi.create({ ...body, idempotencyKey: key });
      onDone(made.id);
    } };
}
function Overview({ onSelect }: { onSelect: (view: string) => void }) {
  const q = useQuery({ queryKey: useKey("dashboard"), queryFn: ncApi.dashboard, retry: false });
  if (q.isLoading) return <LoadingState label="Loading the overview" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="the overview" />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <MetricStrip metrics={[{ label: "Open NCRs", value: num(d.counts.open) }, { label: "Critical open", value: num(d.bySeverity.critical) },
        { label: "Action required", value: num(d.counts.action) }, { label: "Awaiting verification", value: num(d.counts.verification) },
        { label: "Overdue NCRs", value: num(d.counts.overdue) }, { label: "Overdue actions", value: num(d.overdueActions) },
        { label: "Raised / closed (90 days)", value: `${num(d.raised90)} / ${num(d.closed90)}` }, { label: "Average days to close", value: d.averageDays === null ? "—" : String(d.averageDays) }]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Queue view="mine" compact title="Assigned to me" onMore={() => onSelect("mine")} />
        <Queue view="action" compact title="Action required" onMore={() => onSelect("action")} />
        <Queue view="verification" compact title="Awaiting verification" onMore={() => onSelect("verification")} />
      </div>
      <p className="text-xs text-text-muted">{`Counted from the NCRs and their actions. ${d.ineffectiveActions} action${d.ineffectiveActions === 1 ? " was" : "s were"} verified as not effective; ${d.reopened} NCR${d.reopened === 1 ? " was" : "s were"} reopened.`}</p>
    </div>
  );
}
function Queue({ view, compact, title, onMore }: { view: string; compact?: boolean; title?: string; onMore?: () => void }) {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const q = useQuery({ queryKey: useKey("list", view, search, severity), queryFn: () => ncApi.list(view, search, severity), retry: false });
  if (q.isLoading) return <LoadingState label="Loading nonconformances" rows={compact ? 2 : 4} />;
  if (q.isError) return <Denied error={q.error} what="nonconformances" />;
  const rows = q.data!.rows;
  if (compact) {
    return (
      <Panel title={title ?? ""} actions={rows.length > 5 && onMore ? <Button size="compact" variant="ghost" onPress={onMore}>{`All ${rows.length}`}</Button> : undefined}>
        {rows.length ? <ul className="flex flex-col gap-2 text-sm">{rows.slice(0, 5).map((r) => <li key={r.id}><Link className="font-medium text-brand hover:underline" href={`${NC_BASE}/${r.id}`}>{r.number}</Link>
          <span className="block text-xs text-text-muted">{[r.severityLabel, r.title, r.dueDate ? `due ${dateLabel(r.dueDate)}` : null].filter(Boolean).join(" · ")}</span></li>)}</ul>
          : <p className="text-sm text-text-muted">Nothing here.</p>}
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Search" value={search} onChange={setSearch} description="NCR, title, item, supplier or inspection" />
        <Select label="Severity" selectedKey={severity || "any"} onSelectionChange={(k) => setSeverity(k === "any" ? "" : String(k))}
          options={[{ value: "any", label: "Any" }, { value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }]} />
      </div>
      <NcTable rows={rows} />
    </div>
  );
}
function NcTable({ rows }: { rows: NcRow[] }) {
  return (
    <LinesTable columns={["NCR", "Severity", "Item / source", { label: "Affected", numeric: true }, "Owner", "Due", "Actions", "Status"]} empty={rows.length ? undefined : "No nonconformances here."}>
      {rows.map((r) => (
        <tr key={r.id}>
          <Cell><Link className="font-medium text-brand hover:underline" href={`${NC_BASE}/${r.id}`}>{r.number}</Link><span className="block text-xs text-text-muted">{r.title}</span></Cell>
          <Cell>{severityBadge(r)}</Cell>
          <Cell>{r.item ? `${r.item.code} · ${r.item.name}` : "—"}<span className="block text-xs text-text-muted">{[r.sourceLabel, r.supplier].filter(Boolean).join(" · ")}</span></Cell>
          <Cell numeric>{num(r.affected)}</Cell><Cell>{r.owner?.name ?? "Unassigned"}</Cell>
          <Cell>{r.dueDate ? <span className={r.overdue ? "text-danger" : undefined}>{`${r.overdue ? "Overdue · " : ""}${dateLabel(r.dueDate)}`}</span> : "—"}</Cell>
          <Cell>{r.openActions ? `${r.openActions} open${r.overdueActions ? ` · ${r.overdueActions} overdue` : ""}` : "—"}</Cell>
          <Cell><StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge>{r.reopened > 0 && <span className="block text-xs text-text-muted">{`Reopened ${r.reopened}×`}</span>}</Cell>
        </tr>))}
    </LinesTable>
  );
}
function Reports() {
  const options = useOptions();
  const [kind, setKind] = useState("register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: useKey("report", kind, from, to), queryFn: () => ncApi.report(kind, from, to), retry: false });
  const columns = q.data ? [...new Set(q.data.rows.flatMap((r) => Object.keys(r)))] : [];
  const show = (v: unknown, c: string) => (v === null || v === undefined || v === "" ? "—" : /(_at|^due)$/.test(c) ? formatDateTime(String(v)) : typeof v === "number" ? num(v) : String(v));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Report" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={options.data?.reports ?? [{ value: "register", label: "Nonconformance register" }]} />
        <TextField label="From" type="date" value={from} onChange={setFrom} /><TextField label="To" type="date" value={to} onChange={setTo} />
        {options.data?.canExport && <a className="self-center text-sm text-brand hover:underline" href={ncApi.csvHref(kind, from, to)}>Export CSV</a>}
      </div>
      {q.isLoading ? <LoadingState label="Preparing the report" rows={3} /> : q.isError ? <Denied error={q.error} what="this report" /> : (
        <LinesTable columns={columns.map((c) => c.replace(/_/g, " "))} empty={q.data!.rows.length ? undefined : "Nothing to report."}>
          {q.data!.rows.map((r, i) => <tr key={i}>{columns.map((c) => <Cell key={c}>{show(r[c], c)}</Cell>)}</tr>)}
        </LinesTable>)}
    </div>
  );
}

// ------------------------------------------------------------------ one NCR
const TABS = [{ id: "overview", label: "Overview" }, { id: "investigation", label: "Containment & Investigation" }, { id: "actions", label: "Actions" },
  { id: "verification", label: "Verification & Closure" }, { id: "dependencies", label: "Dependencies" }, { id: "evidence", label: "Evidence" }, { id: "activity", label: "Activity & Audit" }];
type Run = (action: string, body?: Record<string, unknown>) => Promise<unknown>;

export function NonconformanceDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const refresh = useRefresh();
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const q = useQuery({ queryKey: useKey("detail", id), queryFn: () => ncApi.get(id), retry: false });
  const options = useOptions(Boolean(q.data));
  if (q.isLoading) return <LoadingState label="Loading the nonconformance" rows={5} />;
  if (q.isError) return <Denied error={q.error} what="this nonconformance" />;
  const d = q.data!;
  const o = options.data;
  const go = (next: string) => { setTab(next); router.replace(`${pathname}?tab=${next}`, { scroll: false }); };
  const run: Run = async (action, body = {}) => {
    setFailure(null);
    try { const r = await ncApi.action(id, action, { version: d.rowVersion, ...body }); await refresh(); return r; }
    catch (error) { setFailure(errorMessage(error)); await refresh(); throw error; }
  };
  const ask$ = (a: Ask) => setAsk(a);
  const actions: ReactNode[] = [];
  const primary = (key: string, label: string, onPress: () => void) => actions.push(<Button key={key} variant="primary" onPress={onPress}>{label}</Button>);
  if (d.can.startReview) primary("review", "Start review", () => { run("start-review").catch(() => undefined); });
  if (d.can.requireAction) primary("require", "Confirm action plan", () => { run("require-action").then(() => go("actions")).catch(() => undefined); });
  if (d.can.submit) primary("submit", "Submit for verification", () => { run("submit").then(() => go("verification")).catch(() => undefined); });
  if (d.can.verify) primary("verify", "Verify", () => ask$(verifyAsk(o, run)));
  if (d.can.close) primary("close", "Close NCR", () => ask$({ title: "Close the nonconformance", confirm: "Close", description: "Closure is final unless someone with the closure permission reopens it.",
    fields: [{ name: "note", label: "Closure note", kind: "textarea", required: true }], run: async (v) => { await run("close", v); } }));
  if (d.can.assign && o) actions.push(<Button key="assign" variant="secondary" onPress={() => ask$({ title: "Assign the accountable owner", confirm: "Save",
    fields: [{ name: "ownerUserId", label: "Owner", kind: "select", required: true, initial: d.owner?.id ?? "", options: o.members }], run: async (v) => { await run("assign", v); } })}>
    {d.owner ? "Reassign" : "Assign owner"}</Button>);
  if (d.can.reopen) actions.push(<Button key="reopen" variant="secondary" onPress={() => ask$({ title: "Reopen the nonconformance", confirm: "Reopen", description: "It goes back under review; everything recorded so far stays.",
    fields: [{ name: "reason", label: "Why is it reopened?", kind: "textarea", required: true }], run: async (v) => { await run("reopen", v); } })}>Reopen</Button>);
  if (d.can.cancel) actions.push(<Button key="cancel" variant="danger" onPress={() => ask$({ title: "Cancel the nonconformance", confirm: "Cancel NCR", tone: "danger",
    description: "Only an NCR raised in error, before anything was carried out, is cancelled. Its history stays.",
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await run("cancel", v); } })}>Cancel</Button>);
  const nextStep = d.status === "OPEN" ? (d.owner ? "Start the review." : "Assign an accountable owner, then start the review.")
    : d.status === "UNDER_REVIEW" ? `Record the containment${d.containment ? " ✓" : ""}, the root cause${d.investigation ? " ✓" : ""} and at least one corrective action, then confirm the action plan.`
    : d.status === "ACTION_REQUIRED" ? `Complete every action (${d.actions.filter((a) => a.status === "OPEN").length} open), then submit for verification.`
    : d.status === "VERIFICATION_PENDING" ? "Someone who completed none of the actions verifies whether they were effective."
    : d.status === "RESOLVED" ? "Resolved. Close it once the dependencies that block closure are settled." : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${d.number} · ${d.title}`} description={[d.sourceLabel, d.item ? `${d.item.code} · ${d.item.name}` : null, d.supplier, d.affected ? `${num(d.affected)} affected` : null].filter(Boolean).join(" · ")} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.statusLabel}</StatusBadge>{severityBadge(d)}
        {d.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
        {d.inspection && <Link className="text-sm text-brand hover:underline" href={d.inspection.href}>{`From inspection ${d.inspection.number}`}</Link>}
        <span className="ml-auto flex flex-wrap gap-2">{actions}</span>
      </div>
      <ol className="flex flex-wrap gap-2 text-xs">{STEPS.map((s, i) => {
        const at = STEPS.indexOf(d.status as (typeof STEPS)[number]);
        return <li key={s} className={`rounded-full px-3 py-1 ${i < at ? "bg-surface-muted text-text-secondary" : i === at ? "bg-brand text-white" : "border border-border text-text-muted"}`}>{STEP_LABEL[s]}</li>;
      })}</ol>
      {failure && <Notice tone="danger">{failure}</Notice>}
      {nextStep && d.status !== "CANCELLED" && <Notice tone="info">{nextStep}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => go(String(k))}>
        <TabList aria-label="Nonconformance sections">{TABS.map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
      </Tabs>
      {tab === "overview" && <OverviewTab d={d} o={o} run={run} ask={ask$} />}
      {tab === "investigation" && <InvestigationTab d={d} o={o} run={run} ask={ask$} />}
      {tab === "actions" && <ActionsTab d={d} o={o} run={run} ask={ask$} />}
      {tab === "verification" && <VerificationTab d={d} />}
      {tab === "dependencies" && <DependenciesTab d={d} o={o} run={run} ask={ask$} />}
      {tab === "evidence" && <EvidenceTab d={d} />}
      {tab === "activity" && <HistoryList entries={d.history.map((e) => ({ summary: e.label, at: e.at, actor: e.actor, detail: e.detail ? <span className="text-sm text-text-secondary">{e.detail}</span> : undefined }))} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
type TabProps = { d: NcDetail; o?: NcOptions; run: Run; ask: (a: Ask) => void };
function verifyAsk(o: NcOptions | undefined, run: Run): Ask {
  return { title: "Verify the actions", confirm: "Record verification",
    description: "Check that the corrective actions removed the cause (for example: the next lots inspected, the process audited). If they were not effective, plan the further action needed.",
    fields: [{ name: "effective", label: "Were the actions effective?", kind: "select", required: true, options: [{ value: "true", label: "Yes — effective" }, { value: "false", label: "No — not effective" }] },
      { name: "summary", label: "How was it verified?", kind: "textarea", required: true },
      { name: "resolution", label: "Resolution (if effective)", kind: "textarea" },
      { name: "newActionType", label: "Further action type (if not effective)", kind: "select", initial: "CORRECTIVE", options: o?.actionTypes ?? [] },
      { name: "newAction", label: "Further action (if not effective)", kind: "textarea" }],
    run: async (v) => {
      const effective = v.effective === "true";
      await run("verify", { effective, summary: v.summary, resolution: effective ? v.resolution : undefined,
        newAction: effective ? undefined : { actionType: v.newActionType || "CORRECTIVE", description: v.newAction } });
    } };
}
function OverviewTab({ d, o, run, ask }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="The nonconformance" actions={d.can.edit && o ? <Button size="compact" variant="secondary" onPress={() => ask({ title: "Edit the details", confirm: "Save",
        fields: [{ name: "title", label: "Title", kind: "text", initial: d.title, required: true }, { name: "description", label: "What is wrong", kind: "textarea", initial: d.description, required: true },
          { name: "severity", label: "Severity", kind: "select", initial: d.severity, options: o.severities }, { name: "defectCode", label: "Defect code", kind: "text", initial: d.defectCode ?? "" },
          { name: "dueDate", label: "Due", kind: "date", initial: d.dueDate ? String(d.dueDate).slice(0, 10) : "" }],
        run: async (v) => { await run("update", { ...v, dueDate: v.dueDate || null }); } })}>Edit</Button> : undefined}>
        <FactList items={[["NCR", d.number], ["Severity", severityBadge(d)], ["What is wrong", d.description], ["Found in", d.sourceLabel], ["Category", d.category ?? "—"],
          ["Defect code", d.defectCode ?? "—"], ["Detected", `${formatDateTime(d.detectedAt)}${d.detectedBy ? ` by ${d.detectedBy}` : ""}`], ["Accountable owner", d.owner?.name ?? "Unassigned"],
          ["Due", d.dueDate ? dateLabel(d.dueDate) : "—"], ["Quantity detected / affected", `${num(d.detected)} / ${num(d.affected)}`]]} />
      </Panel>
      <Panel title="Affected population" description="The exact goods this NCR concerns.">
        <LinesTable columns={["Item", "Batch / serial", "Warehouse", { label: "Quantity", numeric: true }, "Note"]} empty={d.items.length ? undefined : "No items recorded."}>
          {d.items.map((x) => <tr key={x.id}><Cell>{x.item ?? "—"}</Cell><Cell>{x.batch ?? x.serial ?? "—"}</Cell><Cell>{x.warehouse ?? "—"}</Cell><Cell numeric>{num(x.quantity)}</Cell><Cell>{x.description ?? "—"}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.observations.length > 0 && <Panel title="Failed checks from the inspection" description="Kept exactly as recorded on the inspection.">
        <LinesTable columns={["Sample", "Check", "Importance", "Recorded", "Why"]}>
          {d.observations.map((x) => <tr key={x.id}><Cell>{x.sample ?? "—"}</Cell><Cell>{x.characteristic}</Cell><Cell>{x.criticality}</Cell><Cell>{x.value ?? "—"}</Cell><Cell>{x.reason ?? x.outcome}</Cell></tr>)}
        </LinesTable>
      </Panel>}
    </div>
  );
}
function InvestigationTab({ d, o, run, ask }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Containment" description="What was done straight away so the affected goods do no more harm (segregated, held, customers told)."
        actions={d.can.contain ? <Button size="compact" variant="secondary" onPress={() => ask({ title: "Record the containment", confirm: "Save",
          fields: [{ name: "containmentAction", label: "Containment done", kind: "textarea", required: true, initial: d.containment?.action ?? "" },
            { name: "containmentDue", label: "Containment complete by", kind: "date", initial: d.containment?.due ? String(d.containment.due).slice(0, 10) : "" }],
          run: async (v) => { await run("contain", { ...v, containmentDue: v.containmentDue || null }); } })}>{d.containment ? "Update" : "Record containment"}</Button> : undefined}>
        {d.containment ? <FactList items={[["Containment", d.containment.action], ["Complete by", d.containment.due ? dateLabel(d.containment.due) : "—"],
          ["Recorded", `${d.containment.at ? formatDateTime(d.containment.at) : "—"}${d.containment.by ? ` by ${d.containment.by}` : ""}`]]} /> : <p className="text-sm text-text-muted">Not recorded yet.</p>}
      </Panel>
      <Panel title="Investigation" description="Why it happened: the root cause and how it was found."
        actions={d.can.investigate && o ? <Button size="compact" variant="secondary" onPress={() => ask({ title: "Record the root cause", confirm: "Save",
          fields: [{ name: "method", label: "Method", kind: "select", required: true, initial: d.investigation?.method ?? "FIVE_WHYS", options: o.methods },
            { name: "rootCause", label: "Root cause", kind: "textarea", required: true, initial: d.investigation?.rootCause ?? "" },
            { name: "summary", label: "Investigation notes", kind: "textarea", initial: d.investigation?.summary ?? "" }],
          run: async (v) => { await run("investigate", v); } })}>{d.investigation ? "Update" : "Record root cause"}</Button> : undefined}>
        {d.investigation ? <FactList items={[["Root cause", d.investigation.rootCause], ["Method", d.investigation.methodLabel ?? "—"], ["Notes", d.investigation.summary ?? "—"],
          ["Recorded", `${d.investigation.at ? formatDateTime(d.investigation.at) : "—"}${d.investigation.by ? ` by ${d.investigation.by}` : ""}`]]} /> : <p className="text-sm text-text-muted">Not recorded yet.</p>}
      </Panel>
    </div>
  );
}
function ActionsTab({ d, o, run, ask }: TabProps) {
  const completeAsk = (a: NcDetail["actions"][number]): Ask => ({ title: `Complete action ${a.sequence}`, confirm: "Mark done",
    description: `${a.typeLabel}: ${a.description}. Attach the proof on the Evidence tab first, then pick it here.`,
    fields: [{ name: "note", label: "What was done", kind: "textarea", required: true }, ...d.files.map((f) => ({ name: `file:${f.id}`, label: `Evidence: ${f.fileName}`, kind: "checkbox" as const }))],
    run: async (v) => { await run("complete-action", { actionId: a.id, note: v.note, evidenceFileIds: Object.entries(v).filter(([k, x]) => k.startsWith("file:") && x === true).map(([k]) => k.slice(5)) }); } });
  return (
    <Panel title="Actions" description="Containment, correction, corrective and preventive actions — each with an owner and a due date, completed with what was done. Actions are cancelled with a reason, never deleted."
      actions={d.can.addAction && o ? <Button size="compact" variant="primary" onPress={() => ask({ title: "Plan an action", confirm: "Add action",
        fields: [{ name: "actionType", label: "Type", kind: "select", required: true, initial: "CORRECTIVE", options: o.actionTypes }, { name: "description", label: "Action", kind: "textarea", required: true },
          { name: "ownerUserId", label: "Owner", kind: "select", initial: d.owner?.id ?? "", options: o.members }, { name: "dueDate", label: "Due", kind: "date" }],
        run: async (v) => { await run("add-action", { ...v, dueDate: v.dueDate || null, ownerUserId: v.ownerUserId || null }); } })}>Add action</Button> : undefined}>
      <LinesTable columns={["#", "Type", "Action", "Owner", "Due", "Status", "Done", "Effective", ""]} empty={d.actions.length ? undefined : "No actions planned yet."}>
        {d.actions.map((a) => <tr key={a.id}><Cell numeric>{a.sequence}</Cell><Cell>{a.typeLabel}</Cell><Cell>{a.description}{a.cancelReason && <span className="block text-xs text-text-muted">{`Cancelled: ${a.cancelReason}`}</span>}</Cell>
          <Cell>{a.owner ?? "—"}</Cell><Cell>{a.dueDate ? <span className={a.overdue ? "text-danger" : undefined}>{dateLabel(a.dueDate)}</span> : "—"}</Cell>
          <Cell><StatusBadge tone={a.status === "DONE" ? "success" : a.status === "CANCELLED" ? "neutral" : a.overdue ? "danger" : "warning"}>{a.status === "OPEN" ? (a.overdue ? "Overdue" : "Open") : a.status === "DONE" ? "Done" : "Cancelled"}</StatusBadge></Cell>
          <Cell>{a.completedAt ? `${a.note ?? ""} — ${a.completedBy ?? ""}, ${formatDateTime(a.completedAt)}${a.evidence.length ? ` · ${a.evidence.length} file${a.evidence.length === 1 ? "" : "s"}` : ""}` : "—"}</Cell>
          <Cell>{a.effectiveness ? <StatusBadge tone={a.effectiveness === "EFFECTIVE" ? "success" : "danger"}>{a.effectiveness === "EFFECTIVE" ? "Effective" : "Not effective"}</StatusBadge> : "—"}</Cell>
          <Cell>{a.status === "OPEN" && d.can.completeAction && <span className="flex gap-1"><Button size="compact" variant="secondary" onPress={() => ask(completeAsk(a))}>Done</Button>
            {d.can.addAction && <Button size="compact" variant="ghost" onPress={() => ask({ title: `Cancel action ${a.sequence}`, confirm: "Cancel action", tone: "danger",
              fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await run("cancel-action", { actionId: a.id, reason: v.reason }); } })}>Cancel</Button>}</span>}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
function VerificationTab({ d }: { d: NcDetail }) {
  const stamp = (s: { at: string | null; by: string | null } | null) => (s?.at ? `${formatDateTime(s.at)}${s.by ? ` by ${s.by}` : ""}` : "—");
  return (
    <Panel title="Verification, resolution and closure" description="The verifier completed none of the actions; a major or critical NCR is closed by someone other than its owner.">
      <FactList items={[["Verification", d.verification?.summary ?? "Not verified yet"], ["Verified", stamp(d.verification)], ["Resolution", d.resolution?.summary ?? "—"],
        ["Resolved", stamp(d.resolution)], [d.status === "CANCELLED" ? "Cancelled" : "Closure", d.closure?.note ?? "—"], [d.status === "CANCELLED" ? "Cancelled at" : "Closed", stamp(d.closure)],
        ["Reopened", d.reopened ? `${d.reopened} time${d.reopened === 1 ? "" : "s"}` : "Never"]]} />
    </Panel>
  );
}
function DependenciesTab({ d, o, run, ask }: TabProps) {
  return (
    <Panel title="Dependencies outside Quality" description="Supplier claims, credit notes, customer complaints … An NCR can be resolved while these are still open; the ones marked as blocking must be settled before it is closed. Rejection cases and hold cases come from the inspection's dispositions."
      actions={d.can.link && o ? <Button size="compact" variant="secondary" onPress={() => ask({ title: "Add a dependency", confirm: "Add",
        fields: [{ name: "linkType", label: "Type", kind: "select", required: true, initial: "SUPPLIER_CLAIM", options: o.linkTypes }, { name: "reference", label: "Reference", kind: "text", required: true },
          { name: "note", label: "Note", kind: "textarea" }, { name: "blocksClosure", label: "Must be settled before the NCR is closed", kind: "checkbox" }],
        run: async (v) => { await run("add-link", v); } })}>Add dependency</Button> : undefined}>
      <LinesTable columns={["Dependency", "Reference", "Note", "Blocks closure", "Status", ""]} empty={d.dependencies.length ? undefined : "No dependencies."}>
        {d.dependencies.map((x) => <tr key={`${x.kind}-${x.id}`}><Cell>{x.label}</Cell><Cell>{x.href ? <Link className="text-brand hover:underline" href={x.href}>{x.reference}</Link> : x.reference}</Cell>
          <Cell>{x.note ?? "—"}{x.doneNote && <span className="block text-xs text-text-muted">{`Settled: ${x.doneNote}`}</span>}</Cell><Cell>{x.blocking ? "Yes" : "No"}</Cell>
          <Cell>{x.status.replace(/_/g, " ").toLowerCase()}</Cell>
          <Cell>{x.kind === "LINK" && x.status === "OPEN" && d.can.link && <Button size="compact" variant="secondary" onPress={() => ask({ title: `Settle ${x.reference}`, confirm: "Mark settled",
            fields: [{ name: "note", label: "How was it settled?", kind: "textarea", required: true }], run: async (v) => { await run("complete-link", { linkId: x.id, note: v.note }); } })}>Settled</Button>}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
function EvidenceTab({ d }: { d: NcDetail }) {
  const refresh = useRefresh();
  const [error, setError] = useState<string | null>(null);
  const used = new Set(d.actions.flatMap((a) => a.evidence));
  return (
    <div className="flex flex-col gap-3">
      {d.can.upload && <label className="text-sm">Add a photo, investigation record or proof of an action
        <input className="mt-1 block text-sm" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.txt,.xlsx,.docx" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError(null);
          try { await ncApi.upload(d.id, file); await refresh(); } catch (failure) { setError(errorMessage(failure)); }
          e.target.value = "";
        }} /></label>}
      {error && <Notice tone="danger">{error}</Notice>}
      <LinesTable columns={["Document", "Added", "Proof of an action", ""]} empty={d.files.length ? undefined : "No evidence yet."}>
        {d.files.map((f) => <tr key={f.id}><Cell><a className="text-brand hover:underline" href={ncApi.evidenceHref(d.id, f.id)}>{f.fileName}</a></Cell><Cell>{formatDateTime(f.uploadedAt)}</Cell>
          <Cell>{used.has(f.id) ? "Yes" : "—"}</Cell>
          <Cell>{d.can.upload && !used.has(f.id) && !["RESOLVED"].includes(d.status) && <Button size="compact" variant="secondary" onPress={async () => { await ncApi.remove(d.id, f.id).catch((x) => setError(errorMessage(x))); await refresh(); }}>Remove</Button>}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}

// ------------------------------------------------------------------ the Quality home's panel
export function NonconformanceHomePanel() {
  const q = useQuery({ queryKey: useKey("dashboard"), queryFn: ncApi.dashboard, retry: false });
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  const tile = (label: string, value: string, href: string) => (
    <Link key={label} href={href} className="rounded-md border border-border bg-surface p-3 hover:border-brand"><span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{value}</span></Link>);
  return (
    <Panel title="Nonconformances" description="Open NCRs and their actions." actions={<Link className="text-sm text-brand hover:underline" href={NC_BASE}>Open</Link>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile("Open", num(d.counts.open), `${NC_BASE}?view=open`)}{tile("Critical", num(d.bySeverity.critical), `${NC_BASE}?view=open`)}
        {tile("Action required", num(d.counts.action), `${NC_BASE}?view=action`)}{tile("Awaiting verification", num(d.counts.verification), `${NC_BASE}?view=verification`)}
        {tile("Overdue", num(d.counts.overdue), `${NC_BASE}?view=overdue`)}{tile("Overdue actions", num(d.overdueActions), `${NC_BASE}?view=action`)}
      </div>
    </Panel>
  );
}
