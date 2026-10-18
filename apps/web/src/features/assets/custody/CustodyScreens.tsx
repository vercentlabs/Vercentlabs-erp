"use client";

// Assets — Custody & Handovers. Who is accountable for each asset — an employee, a department or an asset store — with the handover that
// moved it there: prepared, physically handed over, acknowledged by the recipient (or disputed, or confirmed by an authorized exception).
// The asset's panel issues, reassigns and receives returns; the workspace lists active custody, pending handovers, acknowledgments
// outstanding, returns due, disputes, the store pool, employee clearance and exceptions; My Assets is each employee's own list.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask, type Field } from "@/shared/ui/AskDialog";
import { ScanBox } from "../register/RegisterListScreens";
import { MyAssignmentRequests } from "../assignments/AssignmentScreens";
import { REGISTER_BASE, assetAction, dateLabel, errorMessage, errorStatus, getAssetView, getOptions, newKey } from "../register/register-api";
import {
  ACK_TONE, CONDITION_OPTIONS, CUSTODIAN_TYPES, CUSTODY_BASE, DISPUTE_REASONS, custodyAction, custodyExportHref, getClearance, getClearanceList, getDepartments, getExceptions, getMine, getStores, getWorkspace,
  handoverAction, type AssetCustody, type Assignment, type BulkCustodyResult, type CustodyHistory, type Handover,
} from "./custody-api";

function useCustodyChoices() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const departments = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody-departments"), queryFn: getDepartments, staleTime: 60_000, retry: false });
  const stores = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody-stores"), queryFn: getStores, staleTime: 60_000, retry: false });
  return {
    users: (options.data?.users ?? []).map((u) => ({ value: u.id, label: u.name })),
    departments: (departments.data ?? []).map((d) => ({ value: d.id, label: d.accountable ? `${d.name} (${d.accountable})` : `${d.name} — no accountable person` })),
    stores: (stores.data ?? []).map((s) => ({ value: s.id, label: s.manager ? `${s.name} (${s.manager})` : `${s.name} — no manager` })),
    departmentList: departments.data ?? [],
  };
}
const targetFields = (choices: ReturnType<typeof useCustodyChoices>, types = CUSTODIAN_TYPES): Field[] => [
  { name: "toType", label: "Custodian type", kind: "select", required: true, options: types, initial: types[0]?.value },
  { name: "userId", label: "Employee (for an employee)", kind: "select", options: choices.users },
  { name: "departmentId", label: "Department (for a department, or the employee's department)", kind: "select", options: choices.departments },
  { name: "storeLocationId", label: "Asset store (for a store)", kind: "select", options: choices.stores },
];
const clean = (v: Record<string, string | boolean>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ""));

// ------------------------------------------------------------------ the asset's custody
export function AssetCustodyPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "custody-current"), queryFn: () => getAssetView<AssetCustody>(assetId, "custody-current"), retry: false });
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "custody-history"), queryFn: () => getAssetView<CustodyHistory>(assetId, "custody-history"), retry: false, enabled: Boolean(q.data?.can.history) });
  const choices = useCustodyChoices();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  if (q.isLoading) return <LoadingState label="Loading custody" rows={3} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  const cur = d.current;
  const h = d.openHandover;
  const done = async (text: string, tone: "success" | "warning" = "success") => { setMessage({ tone, text }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const issue = (): Ask => {
    const key = newKey();
    return { title: cur ? "Reassign custody" : "Issue the asset", confirm: "Save", description: "The current custodian stays accountable until the physical handover is recorded. Custody never changes the legal owner or the registered location.",
      fields: [...targetFields(choices), { name: "condition", label: "Condition at issue", kind: "select", options: CONDITION_OPTIONS }, { name: "expectedReturnAt", label: "Expected return (if temporary)", kind: "date" },
        { name: "handOverNow", label: "It is being handed over now", kind: "checkbox", initial: true }, { name: "notes", label: "Notes", kind: "textarea" }],
      run: async (v) => {
        const r = await assetAction(assetId, "custody-handover", { ...clean(v), handOverNow: v.handOverNow === true, idempotencyKey: key }) as { status: string; warning?: string };
        await done(r.warning ? `Saved. ${r.warning}` : r.status === "PENDING_HANDOVER" ? "Handover prepared; record the physical handover when it happens." : "Handed over; the recipient has been asked to acknowledge.", r.warning ? "warning" : "success");
      } };
  };
  const giveBack = (): Ask => {
    const key = newKey();
    return { title: "Receive a return", confirm: "Receive", description: "Check the asset code or serial of the item received and inspect it. It goes back to a store or a department — never to nobody.",
      fields: [{ name: "toType", label: "Back to", kind: "select", required: true, options: CUSTODIAN_TYPES.filter((t) => t.value !== "EMPLOYEE"), initial: "ASSET_STORE" },
        { name: "storeLocationId", label: "Asset store", kind: "select", options: choices.stores }, { name: "departmentId", label: "Department", kind: "select", options: choices.departments },
        { name: "condition", label: "Condition at return", kind: "select", required: true, options: CONDITION_OPTIONS }, { name: "identityVerified", label: "The asset code / serial matches", kind: "checkbox" },
        { name: "accessories", label: "Accessories returned", kind: "text" }, { name: "notes", label: "Notes", kind: "textarea" }],
      run: async (v) => { const r = await assetAction(assetId, "custody-return", { ...clean(v), identityVerified: v.identityVerified === true, idempotencyKey: key }) as { warning?: string };
        await done(r.warning ? `Return received. ${r.warning}` : "Return received.", r.warning ? "warning" : "success"); } };
  };
  const physical = (): Ask => ({ title: `Record the handover — ${h?.number}`, confirm: "Record", description: `To ${h?.to}. Custody moves at the time it actually happened.`,
    fields: [{ name: "condition", label: "Condition at handover", kind: "select", required: true, options: CONDITION_OPTIONS }, { name: "handedOverAt", label: "Handed over at", kind: "datetime" }, { name: "accessories", label: "Accessories", kind: "text" }],
    run: async (v) => { await handoverAction(h!.id, "confirm-physical", clean(v)); await done("Handover recorded."); } });
  const ack = (): Ask => ({ title: "Confirm receipt", confirm: "I have received it", description: `You have received this asset${h?.condition ? ` in ${h.condition.toLowerCase()} condition` : ""}. Confirming records receipt only; it is not a financial liability.`,
    fields: [{ name: "conditionConfirmed", label: "The condition is as recorded", kind: "checkbox", initial: true }, { name: "comment", label: "Comment", kind: "textarea" }],
    run: async (v) => { await handoverAction(h!.id, "acknowledge", { conditionConfirmed: v.conditionConfirmed === true, comment: v.comment || undefined }); await done("Receipt acknowledged."); } });
  const dispute = (): Ask => ({ title: "Report a problem with this handover", confirm: "Report", tone: "danger", fields: [{ name: "reason", label: "What is wrong", kind: "select", required: true, options: DISPUTE_REASONS }, { name: "comment", label: "Details", kind: "textarea" }],
    run: async (v) => { await handoverAction(h!.id, "dispute", clean(v)); await done("Reported; the asset team will review it.", "warning"); } });
  const waive = (): Ask => ({ title: "Confirm without acknowledgment", confirm: "Confirm", description: "For a recipient who cannot acknowledge. The reason is recorded; nobody acknowledges on someone else's behalf.",
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await handoverAction(h!.id, "waive", { reason: v.reason }); await done("Confirmed by exception."); } });
  const cancel = (): Ask => ({ title: `Cancel ${h?.number}`, confirm: "Cancel handover", tone: "danger", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await handoverAction(h!.id, "cancel", { reason: v.reason }); await done("Handover cancelled; nothing changed."); } });
  const resolve = (): Ask => ({ title: `Resolve: ${d.exception?.kindLabel}`, confirm: "Resolve", description: d.exception?.description,
    fields: [{ name: "resolution", label: "Resolution", kind: "select", required: true, options: d.exception?.kind === "DISPUTED" ? [{ value: "CONFIRM", label: "The handover stands" }, { value: "REVERT", label: "Return custody to the previous custodian" }] : [{ value: "CLOSE", label: "Close" }] },
      { name: "note", label: "Explanation", kind: "textarea", required: true }],
    run: async (v) => { await custodyAction("resolve-exception", { exceptionId: d.exception!.id, resolution: v.resolution, note: v.note }); await done("Resolved."); } });
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {h && <Notice tone={h.status === "DISPUTED" ? "danger" : "warning"}>{`${h.number} · ${h.kindLabel} to ${h.to ?? "—"}: ${h.statusLabel}${h.physicalAt ? ` (handed over ${formatDateTime(h.physicalAt)})` : ""}.`}
        <span className="ml-2 inline-flex flex-wrap gap-1">
          {d.can.confirmHandover && <Button size="compact" variant="secondary" onPress={() => setAsk(physical())}>Record handover</Button>}
          {d.can.acknowledge && <Button size="compact" variant="primary" onPress={() => setAsk(ack())}>Confirm receipt</Button>}
          {d.can.dispute && <Button size="compact" variant="ghost" onPress={() => setAsk(dispute())}>Report a problem</Button>}
          {d.can.waive && !d.can.acknowledge && <Button size="compact" variant="ghost" onPress={() => setAsk(waive())}>Confirm by exception</Button>}
          {d.can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk(cancel())}>Cancel</Button>}
        </span></Notice>}
      {d.exception && <Notice tone="warning">{`${d.exception.kindLabel}: ${d.exception.description}`}{d.can.resolve && <> <button type="button" className="font-medium underline" onClick={() => setAsk(resolve())}>Resolve</button></>}</Notice>}
      <Panel title="Custody & accountability" description={d.note} actions={<span className="flex flex-wrap gap-1">
        {d.can.issue && <Button size="compact" variant="secondary" onPress={() => setAsk(issue())}>{cur && cur.type !== "ASSET_STORE" ? "Reassign" : "Issue"}</Button>}
        {d.can.return && <Button size="compact" variant="secondary" onPress={() => setAsk(giveBack())}>Receive return</Button>}
        {d.can.requestReturn && <Button size="compact" variant="ghost" onPress={async () => { try { await assetAction(assetId, "custody-request-return", {}); await done("The asset team has been asked to take it back."); } catch (f) { setMessage({ tone: "danger", text: errorMessage(f) }); } }}>Ask to return it</Button>}
      </span>}>
        <FactList items={[["Current custodian", cur ? `${cur.typeLabel}: ${cur.custodian ?? "—"}` : "None"], ["Accountable person", cur?.accountable ?? "—"], ["Department", cur?.department ?? "—"],
          ["Since", cur ? formatDateTime(cur.since) : "—"], ["Expected return", cur?.expectedReturn ? `${dateLabel(cur.expectedReturn)}${cur.overdue ? " (overdue)" : ""}` : "Not specified"],
          ["Condition at issue", cur?.conditionAtIssue ?? "—"], ["Acknowledgment", cur ? <StatusBadge key="a" tone={ACK_TONE[cur.acknowledgment]}>{cur.acknowledgmentLabel}</StatusBadge> : "—"],
          ["Legal owner", d.legalOwner ?? "The Company"], ["Physically with", d.physicalHolder ?? "The custodian"]]} />
        {cur?.custodianInactive && <Notice tone="danger">The custodian is no longer an active member of the Company: receive the return or reassign it.</Notice>}
        {cur?.returnRequestedAt && <p className="text-xs text-text-muted">{`The custodian asked to return it on ${formatDateTime(cur.returnRequestedAt)}.`}</p>}
      </Panel>
      {history.data && <HistoryList title="Custody history" entries={[
        ...history.data.handovers.map((x) => ({ summary: `${x.number} ${x.kindLabel.toLowerCase()} to ${x.to ?? "—"} — ${x.statusLabel.toLowerCase()}`, at: x.physicalAt ?? x.createdAt, actor: x.issuedBy })),
        ...history.data.acknowledgments.map((k) => ({ summary: k.decision === "ACKNOWLEDGED" ? "Receipt acknowledged" : k.decision === "DISPUTED" ? `Disputed: ${k.reason ?? ""}` : "Confirmed by exception", at: k.at, actor: k.by,
          detail: k.comment ? <span className="text-xs text-text-muted">{k.comment}</span> : undefined })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)))} />}
      {history.data && history.data.assignments.length > 0 && <Panel title="Custody periods">
        <LinesTable columns={["Custodian", "From", "Until", "At issue", "At return", "Acknowledgment"]}>
          {history.data.assignments.map((x) => <tr key={x.id}><Cell>{`${x.typeLabel}: ${x.custodian ?? "—"}`}{x.custodianInactive && <span className="block text-xs text-danger">No longer active</span>}</Cell><Cell>{formatDateTime(x.since)}</Cell>
            <Cell>{x.until ? formatDateTime(x.until) : "Current"}</Cell><Cell>{x.conditionAtIssue ?? "—"}</Cell><Cell>{x.conditionAtReturn ?? "—"}</Cell><Cell>{x.acknowledgmentLabel}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the workspace
const VIEWS = [{ id: "active", label: "Active assignments" }, { id: "pending", label: "Pending handovers" }, { id: "awaiting", label: "Awaiting acknowledgment" }, { id: "returns_due", label: "Returns due" },
  { id: "disputes", label: "Disputes" }, { id: "store", label: "Store pool" }, { id: "clearance", label: "Employee clearance" }, { id: "exceptions", label: "Exceptions" }, { id: "settings", label: "Accountability" }];
export function CustodyWorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState(VIEWS.some((v) => v.id === params.get("view")) ? params.get("view")! : "active");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody", view), queryFn: () => getWorkspace({ view }), retry: false, enabled: !["clearance", "exceptions", "settings"].includes(view) });
  const clearance = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody", "clearance"), queryFn: getClearanceList, retry: false, enabled: view === "clearance" });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody", "exceptions"), queryFn: getExceptions, retry: false, enabled: view === "exceptions" });
  const choices = useCustodyChoices();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [bulk, setBulk] = useState<"issue" | "return" | null>(null);
  const [result, setResult] = useState<BulkCustodyResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if ((q.isError && errorStatus(q.error) === 403)) return <PermissionState title="You can't see the custody workspace" description="Your own assets are under My Assets." />;
  const refresh = async (text: string) => { setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const assignmentRows = q.data?.kind === "assignments" ? (q.data.rows as Assignment[]) : [];
  const handoverRows = q.data?.kind === "handovers" ? (q.data.rows as Handover[]) : [];
  const setAccountable = (dept: { id: string; name: string }): Ask => ({ title: `Accountable person — ${dept.name}`, confirm: "Save", fields: [{ name: "accountableUserId", label: "Accountable person", kind: "select", required: true, options: choices.users }],
    run: async (v) => { await custodyAction("department-custodian", { departmentId: dept.id, accountableUserId: v.accountableUserId }); await refresh(`${dept.name} updated.`); } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Custody & Handovers" description="Who is accountable for each asset, and every handover that moved it. Custody is not ownership and not location."
        primaryAction={<span className="flex flex-wrap gap-2"><Button variant="primary" onPress={() => setBulk("issue")}>Issue assets</Button><Button variant="secondary" onPress={() => setBulk("return")}>Receive returns</Button>
          <Link className="self-center text-sm text-brand hover:underline" href={custodyExportHref}>Export</Link></span>} />
      {message && <Notice tone="success">{message}</Notice>}
      <Tabs selectedKey={view} onSelectionChange={(k) => { setView(String(k)); router.replace(`${pathname}?view=${String(k)}`, { scroll: false }); }}>
        <TabList aria-label="Custody views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "clearance" ? (clearance.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["Employee", "Status", "Assets held", "Next return due"]} empty={(clearance.data?.rows ?? []).length ? undefined : "Nobody holds assets."}>
          {(clearance.data?.rows ?? []).map((r) => <tr key={r.userId}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.name}</Link></Cell><Cell>{r.active ? "Active" : <StatusBadge tone="danger">Left the Company</StatusBadge>}</Cell>
            <Cell>{r.assets}</Cell><Cell>{r.nextDue ? dateLabel(r.nextDue) : "—"}</Cell></tr>)}
        </LinesTable>
      )) : view === "exceptions" ? (exceptions.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["Exception", "Asset", "Details"]} empty={(exceptions.data ?? []).length ? undefined : "No custody exceptions."}>
          {(exceptions.data ?? []).map((e, i) => <tr key={e.id ?? i}><Cell>{e.label}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.asset}</Link></Cell><Cell>{e.issue}</Cell></tr>)}
        </LinesTable>
      )) : view === "settings" ? (
        <Panel title="Departments" description="A department holds assets through its accountable person. Asset stores are locations marked as stores, accountable through their manager.">
          <LinesTable columns={["Department", "Accountable person", ""]}>
            {choices.departmentList.map((d) => <tr key={d.id}><Cell>{d.name}</Cell><Cell>{d.accountable ?? <span className="text-xs text-danger">Not set</span>}</Cell>
              <Cell><Button size="compact" variant="ghost" onPress={() => setAsk(setAccountable(d))}>Set</Button></Cell></tr>)}
          </LinesTable>
        </Panel>
      ) : q.isLoading ? <LoadingState label="Loading" rows={4} /> : q.data?.kind === "handovers" ? (
        <LinesTable columns={["Handover", "Asset", "To", "Status", "Since"]} empty={handoverRows.length ? undefined : "Nothing here."}>
          {handoverRows.map((h) => <tr key={h.id}><Cell>{h.number}<span className="block text-xs text-text-muted">{h.kindLabel}</span></Cell><Cell><Link className="text-brand hover:underline" href={h.assetHref}>{h.asset}</Link></Cell>
            <Cell>{h.to ?? "—"}<span className="block text-xs text-text-muted">{h.recipient ? `Accountable: ${h.recipient}` : ""}</span></Cell><Cell>{h.statusLabel}</Cell><Cell>{formatDateTime(h.physicalAt ?? h.createdAt)}</Cell></tr>)}
        </LinesTable>
      ) : (
        <LinesTable columns={["Asset", "Custodian", "Since", "Return due", "Acknowledgment"]} empty={assignmentRows.length ? undefined : "Nothing here."}>
          {assignmentRows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.assetHref}>{r.asset}</Link></Cell>
            <Cell>{`${r.typeLabel}: ${r.custodian ?? "—"}`}{r.custodianInactive && <span className="block text-xs text-danger">No longer active</span>}</Cell><Cell>{dateLabel(r.since)}</Cell>
            <Cell>{r.expectedReturn ? <span className={r.overdue ? "text-danger" : ""}>{dateLabel(r.expectedReturn)}</span> : "—"}</Cell><Cell><StatusBadge tone={ACK_TONE[r.acknowledgment]}>{r.acknowledgmentLabel}</StatusBadge></Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {bulk && <BulkCustodyDialog mode={bulk} choices={choices} onClose={() => setBulk(null)} onDone={async (r) => { setBulk(null); setResult(r); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); }} />}
      {result && <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) setResult(null); }} title={`${result.succeeded} done, ${result.failed} not done`}>
        <div className="flex flex-col gap-3">
          {result.failed === 0 ? <Notice tone="success">Every row was processed.</Notice> : <LinesTable columns={["Asset", "Why not"]}>{result.results.filter((r) => !r.ok).map((r, i) => <tr key={i}><Cell>{r.assetNumber ?? r.assetId}</Cell><Cell>{r.message ?? r.errorCode}</Cell></tr>)}</LinesTable>}
          <div className="flex justify-end"><Button variant="primary" onPress={() => setResult(null)}>Done</Button></div>
        </div>
      </Dialog>}
    </div>
  );
}
// Many at once: issue — one line per asset and recipient ("AST-000201, priya@company.com"); return — scan or type each asset.
function BulkCustodyDialog({ mode, choices, onClose, onDone }: { mode: "issue" | "return"; choices: ReturnType<typeof useCustodyChoices>; onClose: () => void; onDone: (r: BulkCustodyResult) => Promise<void> }) {
  const [lines, setLines] = useState("");
  const [condition, setCondition] = useState("GOOD");
  const [store, setStore] = useState("");
  const [verified, setVerified] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = mode === "issue"
        ? await custodyAction<BulkCustodyResult>("bulk-issue", { rows: rows.map((l) => { const [asset, email] = l.split(/[,;\t]/).map((x) => x.trim()); return { asset, email }; }), condition, handOverNow: true, idempotencyKey: key })
        : await custodyAction<BulkCustodyResult>("bulk-return", { assets: rows.map((asset) => ({ asset })), toType: "ASSET_STORE", storeLocationId: store, condition, identityVerified: verified, idempotencyKey: key });
      await onDone(r);
    } catch (f) { setError(errorMessage(f)); setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) onClose(); }} title={mode === "issue" ? "Issue assets" : "Receive returns"} size="lg"
      description={mode === "issue" ? "One line per asset: its code (or scanned label), then the employee's e-mail. Each line is checked on its own." : "Scan or type each returned asset, one per line. Each is received into the store on its own."}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextArea label={mode === "issue" ? "Asset, employee e-mail" : "Assets"} value={lines} onChange={setLines} placeholder={mode === "issue" ? "AST-000201, priya@company.com" : "AST-000201"} />
        <Select label={mode === "issue" ? "Condition at issue" : "Condition at return"} selectedKey={condition} onSelectionChange={(k) => setCondition(String(k))} options={CONDITION_OPTIONS} />
        {mode === "return" && <><Select label="Into which store" selectedKey={store || null} onSelectionChange={(k) => setStore(String(k ?? ""))} options={choices.stores} isRequired />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />{"Each asset's code or serial was checked"}</label></>}
        <p className="text-xs text-text-muted">{`${rows.length} line(s)`}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !rows.length || (mode === "return" && (!store || !verified))} onPress={save}>{mode === "issue" ? "Issue" : "Receive"}</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ my assets
export function MyAssetsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody", "mine"), queryFn: getMine, retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isLoading) return <LoadingState label="Loading your assets" rows={4} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const done = async (text: string) => { setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const ack = (h: Handover): Ask => ({ title: `Confirm receipt — ${h.asset}`, confirm: "I have received it", description: `Confirm the asset and its condition${h.condition ? ` (${h.condition.toLowerCase()})` : ""}. This records receipt only.`,
    fields: [{ name: "conditionConfirmed", label: "The condition is as recorded", kind: "checkbox", initial: true }, { name: "comment", label: "Comment", kind: "textarea" }],
    run: async (v) => { await handoverAction(h.id, "acknowledge", { conditionConfirmed: v.conditionConfirmed === true, comment: v.comment || undefined }); await done("Thank you — receipt confirmed."); } });
  const dispute = (h: Handover): Ask => ({ title: `Report a problem — ${h.asset}`, confirm: "Report", tone: "danger", fields: [{ name: "reason", label: "What is wrong", kind: "select", required: true, options: DISPUTE_REASONS }, { name: "comment", label: "Details", kind: "textarea" }],
    run: async (v) => { await handoverAction(h.id, "dispute", clean(v)); await done("Reported; the asset team will review it."); } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My assets" description="The equipment you are responsible for. Report damage or a missing asset from the asset's page." />
      {message && <Notice tone="success">{message}</Notice>}
      <ScanBox compact />
      <MyAssignmentRequests />
      {q.data.awaitingMe.length > 0 && <Panel title="Waiting for your confirmation">
        <LinesTable columns={["Asset", "Handed over", "Condition", ""]}>
          {q.data.awaitingMe.map((h) => <tr key={h.id}><Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${h.assetId}?tab=custody`}>{h.asset}</Link></Cell><Cell>{h.physicalAt ? formatDateTime(h.physicalAt) : "—"}</Cell><Cell>{h.condition ?? "—"}</Cell>
            <Cell><span className="flex gap-1">{q.data.can.acknowledge && <Button size="compact" variant="primary" onPress={() => setAsk(ack(h))}>Confirm receipt</Button>}{q.data.can.dispute && <Button size="compact" variant="ghost" onPress={() => setAsk(dispute(h))}>Report a problem</Button>}</span></Cell></tr>)}
        </LinesTable>
      </Panel>}
      <Panel title="In my care">
        <LinesTable columns={["Asset", "Since", "Return due", "Status"]} empty={q.data.rows.length ? undefined : "No assets are assigned to you."}>
          {q.data.rows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${r.assetId}?tab=custody`}>{r.asset}</Link>{r.type !== "EMPLOYEE" && <span className="block text-xs text-text-muted">{`Accountable for ${r.typeLabel.toLowerCase()} ${r.custodian}`}</span>}</Cell>
            <Cell>{dateLabel(r.since)}</Cell><Cell>{r.expectedReturn ? dateLabel(r.expectedReturn) : "—"}</Cell><Cell><StatusBadge tone={ACK_TONE[r.acknowledgment]}>{r.acknowledgmentLabel}</StatusBadge></Cell></tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ an employee's clearance
export function ClearanceScreen({ userId }: { userId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody", "clearance", userId), queryFn: () => getClearance(userId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const queryClient = useQueryClient();
  if (q.isLoading) return <LoadingState label="Loading" rows={4} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see this clearance" description="It needs the clearance permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  const cannot = (r: Assignment): Ask => ({ title: `Cannot be returned — ${r.asset}`, confirm: "Record", tone: "danger", description: "Recorded for the asset team to follow up. It is not a charge and does not decide any deduction.",
    fields: [{ name: "note", label: "What happened", kind: "textarea", required: true }],
    run: async (v) => { await custodyAction("cannot-return", { assetId: r.assetId, note: v.note }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Asset clearance — ${d.name}`} description={d.note} primaryAction={<Link className="text-sm text-brand hover:underline" href={`${CUSTODY_BASE}?view=clearance`}>All employees</Link>} />
      <Notice tone={d.status === "CLEAR" ? "success" : "warning"}>{`${d.statusLabel}${d.active ? "" : " · no longer an active member of the Company"}.`}</Notice>
      <Panel title="Assets held">
        <LinesTable columns={["Asset", "Since", "Return due", "Acknowledgment", ""]} empty={d.assets.length ? undefined : "None."}>
          {d.assets.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.assetHref}>{r.asset}</Link></Cell><Cell>{dateLabel(r.since)}</Cell><Cell>{r.expectedReturn ? dateLabel(r.expectedReturn) : "—"}</Cell>
            <Cell>{r.acknowledgmentLabel}</Cell><Cell><span className="flex gap-1"><Link className="text-sm text-brand hover:underline" href={r.assetHref}>Receive return</Link>
              <Button size="compact" variant="ghost" onPress={() => setAsk(cannot(r))}>Cannot be returned</Button></span></Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.accountableFor.length > 0 && <Panel title="Accountable for (department or store)"><LinesTable columns={["Asset", "Held by"]}>{d.accountableFor.map((r) => <tr key={r.id}><Cell>{r.asset}</Cell><Cell>{`${r.typeLabel}: ${r.custodian}`}</Cell></tr>)}</LinesTable>
        <p className="text-xs text-text-muted">Name another accountable person for these before the employee leaves.</p></Panel>}
      {d.openHandovers.length > 0 && <Panel title="Open handovers"><LinesTable columns={["Handover", "Asset", "Status"]}>{d.openHandovers.map((h) => <tr key={h.id}><Cell>{h.number}</Cell><Cell>{h.asset}</Cell><Cell>{h.statusLabel}</Cell></tr>)}</LinesTable></Panel>}
      {d.recordedExceptions.length > 0 && <Panel title="Recorded exceptions"><ul className="text-sm">{d.recordedExceptions.map((e) => <li key={e.id}>{`${e.asset}: ${e.note}`}</li>)}</ul></Panel>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
