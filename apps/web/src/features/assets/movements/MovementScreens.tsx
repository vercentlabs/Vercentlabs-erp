"use client";

// Assets — Asset Movement History. One chronological, read-only account of how each asset moved and changed hands, built from the records
// that own each fact (opening, location, custody handovers, assignments, transfers, observations, maintenance, disposal). Related steps sit
// under one transfer or handover; observations are labelled as such, pending steps as pending; a correction keeps the original beside it.
// The Company directory is filtered and paged on the server; the position on a past date is reconstructed, never invented.
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
import { errorMessage, errorStatus, getOptions } from "../register/register-api";
import {
  CERTAINTY_OPTIONS, CERTAINTY_TONE, EVENT_OPTIONS, ISSUE_LABEL, MOVEMENTS_BASE, MOVEMENT_REPORT_KINDS, decideCorrection, getAsOf, getAssetMovements, getCorrections, getMovement, getMovementExceptions,
  getMovementReport, getMovements, movementsExportHref, rebuildMovements, reconcileMovements, requestCorrection, resolveIssue, type MovementCorrection, type MovementCustodian, type MovementEvent,
  type MovementFilters, type MovementGroup, type MovementIssue,
} from "./movements-api";

const VIEWS = [{ id: "directory", label: "All Movements" }, { id: "exceptions", label: "Exceptions" }, { id: "corrections", label: "Corrections" }, { id: "reconciliation", label: "Reconciliation" },
  { id: "reports", label: "Reports" }];
const who = (c: MovementCustodian) => (c?.label ? `${c.label}${c.typeLabel && c.type !== "EMPLOYEE" ? ` (${c.typeLabel.toLowerCase()})` : ""}` : null);
const place = (name: string | null, role?: string | null) => (name ? (role === "PROPOSED" ? `Pending ${name}` : role === "OBSERVED" ? `Seen at ${name}` : name) : null);
const when = (e: MovementEvent) => (
  <span>{formatDateTime(e.occurredAt)}{e.lateRecorded && <span className="block text-xs text-text-muted">{`Recorded ${formatDateTime(e.recordedAt)}`}</span>}</span>
);
const certainty = (e: { certainty: string; certaintyLabel?: string }) => <StatusBadge tone={CERTAINTY_TONE[e.certainty] ?? "neutral"}>{e.certaintyLabel ?? e.certainty}</StatusBadge>;
const fromTo = (e: MovementEvent) => {
  const from = [place(e.from.location), who(e.from.custodian)].filter(Boolean).join(" · ");
  const to = [place(e.to.location, e.to.locationRole), who(e.to.custodian)].filter(Boolean).join(" · ");
  const renamed = e.to.currentLocationName && e.to.location && e.to.currentLocationName !== e.to.location ? ` (now ${e.to.currentLocationName})` : "";
  return from || to ? `${from || "—"} → ${to || "—"}${renamed}` : "—";
};
const sourceCell = (e: MovementEvent) => {
  const label = e.document?.number ?? e.group?.label ?? null;
  if (!label) return "—";
  return e.document?.href ? <Link className="text-brand hover:underline" href={e.document.href}>{label}</Link> : label;
};

// ------------------------------------------------------------------ the Company directory
export function MovementsWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "directory");
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Asset Movement History" description="Where every asset has been and who held it, from the transfers, handovers and observations that recorded it. History is read-only: movements are recorded in the workflow that owns them." />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Movement views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "directory" && <DirectoryPanel />}
      {view === "exceptions" && <ExceptionsPanel />}
      {view === "corrections" && <CorrectionsPanel />}
      {view === "reconciliation" && <ReconciliationPanel />}
      {view === "reports" && <ReportsPanel />}
    </div>
  );
}

function DirectoryPanel() {
  const workspace = useWorkspaceContext();
  const [f, setF] = useState<MovementFilters>({ page: 1 });
  const set = (patch: MovementFilters) => setF((x) => ({ ...x, ...patch, page: patch.page ?? 1 }));
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, retry: false });
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", JSON.stringify(f)), queryFn: () => getMovements(f), retry: false });
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't see asset movements" description="It needs the movement history permission." />;
  const d = q.data;
  const locations = [{ value: "", label: "Any location" }, ...(options.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label="Search" size="compact" value={f.search ?? ""} onChange={(v) => set({ search: v })} placeholder="Asset code, serial, tag or transfer number" />
        <Select label="Movement" size="compact" selectedKey={f.eventType ?? ""} onSelectionChange={(k) => set({ eventType: String(k) || undefined })} options={[{ value: "", label: "Any movement" }, ...EVENT_OPTIONS]} />
        <Select label="Status" size="compact" selectedKey={f.certainty ?? ""} onSelectionChange={(k) => set({ certainty: String(k) || undefined })} options={[{ value: "", label: "Any status" }, ...CERTAINTY_OPTIONS]} />
        <Select label="Location" size="compact" selectedKey={f.locationId ?? ""} onSelectionChange={(k) => set({ locationId: String(k) || undefined })} options={locations} />
        <TextField label="From" size="compact" type="date" value={f.from ?? ""} onChange={(v) => set({ from: v || undefined })} />
        <TextField label="To" size="compact" type="date" value={f.to ?? ""} onChange={(v) => set({ to: v || undefined })} />
        <Select label="Show" size="compact" selectedKey={f.movementsOnly ?? ""} onSelectionChange={(k) => set({ movementsOnly: String(k) || undefined })}
          options={[{ value: "", label: "Every step and observation" }, { value: "true", label: "Only location or custody changes" }]} />
        <Select label="Order" size="compact" selectedKey={f.sort ?? ""} onSelectionChange={(k) => set({ sort: String(k) || undefined })} options={[{ value: "", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]} />
      </div>
      {d?.sync.delayed && <Notice tone="warning">Recent changes are still being synchronized; some movements may not show yet.</Notice>}
      {q.isLoading ? <LoadingState label="Loading movements" rows={5} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : <>
        <LinesTable columns={["When", "Asset", "Movement", "From → To", "Source", "Status", "Recorded by"]} empty={d!.rows.length ? undefined : "No movements match."}>
          {d!.rows.map((e) => <tr key={e.id}><Cell>{when(e)}</Cell><Cell><Link className="text-brand hover:underline" href={`/assets/register/${e.assetId}?tab=custody`}>{e.asset}</Link></Cell>
            <Cell><Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${e.id}`}>{e.label}</Link></Cell><Cell>{fromTo(e)}</Cell><Cell>{sourceCell(e)}</Cell><Cell>{certainty(e)}</Cell><Cell>{e.actor ?? "—"}</Cell></tr>)}
        </LinesTable>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-muted">
          <span>{`${d!.total} event${d!.total === 1 ? "" : "s"} · page ${d!.page} of ${d!.pages}`}</span>
          <span className="flex items-center gap-2">
            <Button size="compact" variant="secondary" isDisabled={d!.page <= 1} onPress={() => set({ page: d!.page - 1 })}>Previous</Button>
            <Button size="compact" variant="secondary" isDisabled={d!.page >= d!.pages} onPress={() => set({ page: d!.page + 1 })}>Next</Button>
            {d!.can.export && <Link className="text-brand hover:underline" href={movementsExportHref({ ...f, page: undefined })}>Export</Link>}
          </span>
        </div>
      </>}
    </div>
  );
}

function ExceptionsPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "exceptions"), queryFn: getMovementExceptions, retry: false });
  if (q.isLoading) return <LoadingState label="Loading exceptions" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Unresolved movement exceptions" description="Disputed receipts, transfer exceptions, missing assets and location discrepancies with no later confirmed step.">
        <LinesTable columns={["When", "Asset", "What", "Where", "Source"]} empty={d.rows.length ? undefined : "Nothing unresolved."}>
          {d.rows.map((e) => <tr key={e.id}><Cell>{when(e)}</Cell><Cell><Link className="text-brand hover:underline" href={`/assets/register/${e.assetId}?tab=custody`}>{e.asset}</Link></Cell>
            <Cell><Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${e.id}`}>{e.label}</Link>{e.reason && <span className="block text-xs text-text-muted">{e.reason}</span>}</Cell><Cell>{fromTo(e)}</Cell><Cell>{sourceCell(e)}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.issues.length > 0 && <IssuesTable issues={d.issues} />}
      {d.corrections.length > 0 && <CorrectionsTable rows={d.corrections} />}
    </div>
  );
}

function CorrectionsPanel() {
  const workspace = useWorkspaceContext();
  const [status, setStatus] = useState("REQUESTED");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "corrections", status), queryFn: () => getCorrections(status || undefined), retry: false });
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't see movement corrections" description="It needs the movement audit, reconcile or correction permission." />;
  return (
    <div className="flex flex-col gap-3">
      <Select label="Status" size="compact" selectedKey={status} onSelectionChange={(k) => setStatus(String(k))}
        options={[{ value: "REQUESTED", label: "Waiting for a decision" }, { value: "APPLIED", label: "Applied" }, { value: "REJECTED", label: "Rejected" }, { value: "", label: "All" }]} />
      {q.isLoading ? <LoadingState label="Loading corrections" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : <CorrectionsTable rows={q.data ?? []} />}
    </div>
  );
}
function CorrectionsTable({ rows }: { rows: MovementCorrection[] }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "movements") });
  const decide = (r: MovementCorrection, decision: "APPLY" | "REJECT"): Ask => ({
    title: `${decision === "APPLY" ? "Apply" : "Reject"} ${r.number}`, confirm: decision === "APPLY" ? "Apply correction" : "Reject", tone: decision === "APPLY" ? "primary" : "danger",
    description: decision === "APPLY" ? `${r.event} on ${r.asset}: from ${formatDateTime(r.originalValue)} to ${formatDateTime(r.correctedValue)}. The original stays on record beside the correction.` : "The recorded time stays as it is.",
    fields: [{ name: "note", label: "Note", kind: "textarea", required: decision === "REJECT" }],
    run: async (v) => {
      const out = await decideCorrection(r.id, decision, String(v.note ?? ""));
      if (out.conflict) throw new Error(out.message ?? "This correction conflicts with later movements and was flagged for review.");
      await refresh();
    },
  });
  return (
    <Panel title="Correction requests">
      <LinesTable columns={["Correction", "Asset", "Movement", "Recorded", "Corrected to", "Reason", "Evidence", "Status", ""]} empty={rows.length ? undefined : "No corrections."}>
        {rows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${r.eventId}`}>{r.number}</Link><span className="block text-xs text-text-muted">{`${r.requestedBy ?? ""} · ${formatDateTime(r.requestedAt)}`}</span></Cell>
          <Cell>{r.asset}</Cell><Cell>{r.event}</Cell><Cell>{formatDateTime(r.originalValue)}</Cell><Cell>{formatDateTime(r.correctedValue)}</Cell><Cell>{r.reason}</Cell><Cell>{r.evidence ?? "—"}</Cell>
          <Cell>{r.status === "REQUESTED" ? "Waiting" : `${r.status === "APPLIED" ? "Applied" : "Rejected"}${r.decidedBy ? ` by ${r.decidedBy}` : ""}`}</Cell>
          <Cell>{r.canDecide && <span className="flex gap-2"><Button size="compact" variant="primary" onPress={() => setAsk(decide(r, "APPLY"))}>Apply</Button><Button size="compact" variant="secondary" onPress={() => setAsk(decide(r, "REJECT"))}>Reject</Button></span>}</Cell></tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

function ReconciliationPanel() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "issues"), queryFn: () => getMovementReport("reconciliation"), retry: false });
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't reconcile movement history" description="It needs the Company-wide movement history permission." />;
  const run = async (what: "reconcile" | "rebuild") => {
    setBusy(true); setResult(null);
    try {
      if (what === "reconcile") { const r = await reconcileMovements(); setResult(`Checked ${r.checked} assets: ${r.found} difference${r.found === 1 ? "" : "s"} (${r.opened} new), ${r.closed} closed.`); }
      else { const r = await rebuildMovements(); setResult(`Rebuilt from the source records: ${r.ingested} events re-derived.`); }
      await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "movements") });
    } catch (failure) { setResult(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="neutral">Reconciliation compares the history with the registered location and the custody records, which stay authoritative. Rebuilding re-derives the history from those records; it never changes them.</Notice>
      <span className="flex flex-wrap gap-2"><Button size="compact" variant="primary" isDisabled={busy} onPress={() => run("reconcile")}>Reconcile now</Button>
        <Button size="compact" variant="secondary" isDisabled={busy} onPress={() => run("rebuild")}>Rebuild history</Button></span>
      {result && <Notice tone="info">{result}</Notice>}
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : <IssuesTable issues={(q.data?.rows ?? []) as unknown as MovementIssue[]} />}
    </div>
  );
}
function IssuesTable({ issues }: { issues: MovementIssue[] }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolve = (i: MovementIssue): Ask => ({ title: "Resolve the difference", confirm: "Resolve", description: ISSUE_LABEL[i.type] ?? i.type,
    fields: [{ name: "resolution", label: "How it was resolved", kind: "textarea", required: true }],
    run: async (v) => { await resolveIssue(i.id, String(v.resolution)); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "movements") }); } });
  return (
    <Panel title="Reconciliation differences">
      <LinesTable columns={["Asset", "Difference", "Since", "Status", ""]} empty={issues.length ? undefined : "History agrees with the location and custody records."}>
        {issues.map((i) => <tr key={i.id}><Cell><Link className="text-brand hover:underline" href={i.href}>{i.asset}</Link></Cell><Cell>{ISSUE_LABEL[i.type] ?? i.type}</Cell><Cell>{formatDateTime(i.firstDetectedAt)}</Cell>
          <Cell>{i.status === "OPEN" ? "Open" : `Resolved${i.resolution ? `: ${i.resolution}` : ""}`}</Cell><Cell>{i.status === "OPEN" && <Button size="compact" variant="secondary" onPress={() => setAsk(resolve(i))}>Resolve</Button>}</Cell></tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(MOVEMENT_REPORT_KINDS[0].id);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "report", kind, kind === "historical-position" ? asOf : ""), queryFn: () => getMovementReport(kind, kind === "historical-position" ? asOf : undefined), retry: false });
  const rows = q.data?.rows ?? [];
  const isEvents = rows.length > 0 && typeof rows[0].eventType === "string";
  const flat = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? String((v as { label?: string }).label ?? "") : String(v));
  const cols = rows.length && !isEvents ? Object.keys(rows[0]).filter((x) => !["href", "assetId", "locationId", "id", "eventId"].includes(x)) : [];
  return (
    <Panel title="Reports" actions={<span className="flex flex-wrap items-center gap-2">
      {kind === "historical-position" && <TextField aria-label="As of" size="compact" type="date" value={asOf} onChange={setAsOf} />}
      <Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={MOVEMENT_REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} /></span>}>
      {q.data?.summary && <FactList columns={3} items={[["Movement transactions", String(q.data.summary.transactions)], ["Assets moved", String(q.data.summary.assetsMoved)], ["Movement events", String(q.data.summary.events)]]} />}
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : isEvents ? (
        <LinesTable columns={["When", "Asset", "Movement", "From → To", "Source", "Status"]}>
          {(rows as unknown as MovementEvent[]).map((e) => <tr key={e.id}><Cell>{when(e)}</Cell><Cell>{e.asset}</Cell><Cell><Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${e.id}`}>{e.label}</Link></Cell>
            <Cell>{fromTo(e)}</Cell><Cell>{sourceCell(e)}</Cell><Cell>{certainty(e)}</Cell></tr>)}
        </LinesTable>
      ) : (
        <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
          {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{flat(r[x])}</Link> : flat(r[x])}</Cell>)}</tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ one movement
export function MovementDetailScreen({ eventId }: { eventId: string }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "event", eventId), queryFn: () => getMovement(eventId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading movement" rows={4} />;
  if (q.isError) return errorStatus(q.error) === 403 ? <PermissionState title="You can't view this movement" description="You can see the history of assets you hold or have held." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const e = q.data!;
  const correction: Ask = { title: "Request a correction", confirm: "Send for decision",
    description: "Only when it happened can be corrected here; someone else decides. The original record stays visible. A wrong asset, place or person is corrected in the transfer, handover or location record itself.",
    fields: [{ name: "correctedValue", label: "When it actually happened", kind: "datetime", required: true }, { name: "reason", label: "Reason", kind: "textarea", required: true },
      { name: "evidence", label: "Evidence (courier record, signed note, document number)", kind: "text", required: true }],
    run: async (v) => { await requestCorrection(e.id, { field: "OCCURRED_AT", correctedValue: new Date(String(v.correctedValue)).toISOString(), reason: v.reason, evidence: v.evidence });
      await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "movements") }); } };
  const facts: Array<[string, ReactNode]> = [["Asset", <Link key="a" className="text-brand hover:underline" href={`/assets/register/${e.assetId}?tab=custody`}>{e.asset}</Link>], ["Status", certainty(e)],
    ["Happened", formatDateTime(e.occurredAt)], ["Recorded", formatDateTime(e.recordedAt)], ["From", [place(e.from.location), who(e.from.custodian)].filter(Boolean).join(" · ") || "—"],
    ["To", [place(e.to.location, e.to.locationRole), who(e.to.custodian)].filter(Boolean).join(" · ") || "—"], ["Condition", e.condition ?? "—"], ["Reason", e.reason ?? "—"],
    ["Recorded by", e.actor ?? "—"], ["Approved by", e.approver ?? "—"], ["Source", sourceCell(e)], ["Part of", e.group ? `${e.group.typeLabel}${e.group.label ? ` ${e.group.label}` : ""}` : "—"]];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={e.label} description={e.isMovement ? "A confirmed change of location or custody, as recorded by its source workflow." : "A step or observation; it does not by itself change the registered location or custodian."}
        primaryAction={e.can.correct ? <Button variant="secondary" onPress={() => setAsk(correction)}>Request a correction</Button> : undefined} />
      {e.corrected && <Notice tone="warning">This record was corrected. The correction is shown below; the original stays as it was recorded.</Notice>}
      {e.eventType === "MOVEMENT_CORRECTED" && e.details.originalValue !== undefined && <Notice tone="info">{`Corrected: originally recorded as ${formatDateTime(String(e.details.originalValue))}.`}</Notice>}
      <Panel title="Movement"><FactList columns={3} items={facts} /></Panel>
      {e.groupEvents.length > 1 && <Panel title={`All steps of ${e.group?.label ?? "this movement"}`}>
        <LinesTable columns={["When", "Step", "From → To", "Status", "By"]}>
          {e.groupEvents.map((x) => <tr key={x.id} className={x.id === e.id ? "font-medium" : undefined}><Cell>{when(x)}</Cell><Cell><Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${x.id}`}>{x.label}</Link></Cell>
            <Cell>{fromTo(x)}</Cell><Cell>{certainty(x)}</Cell><Cell>{x.actor ?? "—"}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {e.corrections.length > 0 && <CorrectionsTable rows={e.corrections} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's history (Custody & Location tab)
export function AssetMovementHistoryPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const [eventType, setEventType] = useState("");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState("EFFECTIVE");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "asset", assetId, eventType), queryFn: () => getAssetMovements(assetId, { eventType: eventType || undefined }), retry: false });
  const asOf = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "movements", "as-of", assetId, date, mode), queryFn: () => getAsOf(assetId, date, mode), retry: false, enabled: Boolean(date) });
  if (q.isLoading) return <LoadingState label="Loading movement history" rows={3} />;
  if (q.isError) return errorStatus(q.error) === 403 ? null : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const p = asOf.data;
  return (
    <Panel title="Movement History" description="Every place and person this asset has been with, oldest first. Each entry opens its source record."
      actions={d.can.export ? <Link className="text-sm text-brand hover:underline" href={movementsExportHref({ assetId })}>Export</Link> : undefined}>
      <div className="flex flex-col gap-3">
        <FactList columns={3} items={[["Current confirmed location", d.current.location ?? "—"], ["Current custodian", who(d.current.custodian) ?? "—"],
          ["Pending movement", d.current.pendingMovement ? `${d.current.pendingMovement.number}${d.current.pendingMovement.destination ? ` → ${d.current.pendingMovement.destination}` : ""}` : "None"],
          ["History starts", d.baseline ? `${formatDateTime(d.baseline.at)} (${d.baseline.label.toLowerCase()})` : "No baseline recorded"]]} />
        {d.note && <Notice tone="warning">{d.note}</Notice>}
        {d.sync.delayed && <Notice tone="warning">Recent changes are still being synchronized.</Notice>}
        {d.issues.length > 0 && <Notice tone="danger">{d.issues.map((i) => ISSUE_LABEL[i.type] ?? i.type).join("; ")}</Notice>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select label="Show" size="compact" selectedKey={eventType} onSelectionChange={(k) => setEventType(String(k))} options={[{ value: "", label: "Everything" }, ...EVENT_OPTIONS]} />
          <TextField label="Where was it on" size="compact" type="date" value={date} onChange={setDate} />
          {d.can.audit && <Select label="Reading" size="compact" selectedKey={mode} onSelectionChange={(k) => setMode(String(k))}
            options={[{ value: "EFFECTIVE", label: "As now understood (corrections applied)" }, { value: "KNOWN", label: "As known at the time" }]} />}
        </div>
        {date && (asOf.isLoading ? <LoadingState label="Reconstructing" rows={1} /> : asOf.isError ? <Notice tone="warning">{errorMessage(asOf.error)}</Notice> : p && (p.available
          ? <FactList columns={3} items={[["Registered location", p.location ? `${p.location.name ?? "—"}${p.location.currentName && p.location.currentName !== p.location.name ? ` (now ${p.location.currentName})` : ""}` : "—"],
            ["Accountable custodian", who(p.custodian ?? null) ?? "—"], ["Lifecycle", p.lifecycle ? p.lifecycle.replace(/_/g, " ").toLowerCase() : "—"],
            ["Last confirmed movement", p.lastMovement ? `${p.lastMovement.label}, ${formatDateTime(p.lastMovement.occurredAt)}` : "—"],
            ["Evidence", (p.evidence ?? []).map((x) => x.number).filter(Boolean).join(", ") || "—"], ["Corrections", p.corrected ? "Includes corrected history" : "None"]]} />
          : <Notice tone="neutral">{p.message}</Notice>))}
        {d.groups.length === 0 ? <Notice tone="neutral">No movements recorded yet.</Notice> : d.groups.map((g) => <GroupBlock key={g.key} g={g} />)}
      </div>
    </Panel>
  );
}
function GroupBlock({ g }: { g: MovementGroup }) {
  const title = g.group ? `${g.group.typeLabel}${g.group.label ? ` ${g.group.label}` : ""}` : g.events[0].label;
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-2 text-xs text-text-muted">{formatDateTime(g.startedAt)}<StatusBadge tone={CERTAINTY_TONE[g.certainty] ?? "neutral"}>{g.status}</StatusBadge></span>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {g.events.map((e) => <li key={e.id} className={`flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:gap-3 ${e.corrected ? "text-text-muted line-through" : ""}`}>
          <span className="shrink-0 text-xs text-text-muted sm:w-40">{when(e)}</span>
          <span><Link className="text-brand hover:underline" href={`${MOVEMENTS_BASE}/${e.id}`}>{e.label}</Link>{` · ${fromTo(e)}`}{e.condition ? ` · condition ${e.condition.toLowerCase()}` : ""}{e.actor ? ` · ${e.actor}` : ""}</span>
          {e.certainty !== "CONFIRMED" && <span className="no-underline">{certainty(e)}</span>}
        </li>)}
      </ul>
    </div>
  );
}
