"use client";

// Assets — Asset Transfers. Moving an asset from one place or person to another, with the approvals, handover evidence and history:
// drafted (each asset checked first — every conflict shown before submitting), submitted, approved where the Company requires it,
// dispatched (in transit: the confirmed location stays where it was), received at the destination (the asset that arrived is scanned,
// its condition recorded) and only then completed. Each asset line keeps its own progress; exceptions are recorded and resolved.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { getStores } from "../custody/custody-api";
import { dateLabel, errorMessage, errorStatus, getAssetView, getOptions, newKey } from "../register/register-api";
import {
  CONDITION_OPTIONS, LINE_TONE, REASON_OPTIONS, TRANSFERS_BASE, TRANSFER_REPORT_KINDS, TRANSFER_TONE, TYPE_OPTIONS, createTransfer, getTransfer, getTransferExceptions, getTransferReport, getTransfers,
  lineAction, resolveException, transferAction, transfersExportHref, validateTransfer, type AssetTransferPanel as Panelled, type TransferDetail, type TransferLine, type ValidationLine,
} from "./transfers-api";

const VIEWS = [{ id: "all", label: "All Transfers" }, { id: "drafts", label: "Drafts" }, { id: "pending", label: "Pending Approval" }, { id: "ready", label: "Ready to Dispatch" },
  { id: "in_transit", label: "In Transit / Awaiting Receipt" }, { id: "exceptions", label: "Exceptions" }, { id: "completed", label: "Completed" }, { id: "closed", label: "Cancelled / Rejected" },
  { id: "reports", label: "Reports" }];

// ------------------------------------------------------------------ the directory
export function TransfersWorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "all");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "transfers", view, search), queryFn: () => getTransfers(view, search), retry: false, enabled: view !== "reports" });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "transfers", "exceptions"), queryFn: getTransferExceptions, retry: false, enabled: view === "exceptions" });
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't see asset transfers" description="It needs a transfer permission." />;
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Asset Transfers" description="Moving assets between places and people. A transfer changes the registered location and custody only when the asset is received."
        primaryAction={<span className="flex flex-wrap items-center gap-2">{d?.can.create !== false && <LinkButton variant="primary" href={`${TRANSFERS_BASE}/new`}>New transfer</LinkButton>}
          {d?.can.export && <Link className="text-sm text-brand hover:underline" href={transfersExportHref}>Export</Link>}</span>} />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Transfer views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "reports" ? <ReportsPanel /> : <>
        <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Transfer number, asset code or name" />
        {view === "exceptions" && (exceptions.data ?? []).length > 0 && <Panel title="Needs attention">
          <LinesTable columns={["Issue", "About", "Details"]}>{(exceptions.data ?? []).map((e, i) => <tr key={i}><Cell>{e.label}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.subject}</Link></Cell><Cell>{e.detail}</Cell></tr>)}</LinesTable>
        </Panel>}
        {q.isLoading ? <LoadingState label="Loading transfers" rows={4} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : (
          <LinesTable columns={["Transfer", "Type", { label: "Assets", numeric: true }, "From", "To", "Requested", "Expected", "Status", "Receipt"]} empty={(d?.rows ?? []).length ? undefined : "No transfers here."}>
            {(d?.rows ?? []).map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link><span className="block text-xs text-text-muted">{r.reason}</span></Cell><Cell>{r.typeLabel}</Cell>
              <Cell numeric>{r.assets}</Cell><Cell>{r.from}</Cell><Cell>{r.to}</Cell><Cell>{`${dateLabel(r.requestedAt)}${r.requestedBy ? ` · ${r.requestedBy}` : ""}`}</Cell>
              <Cell>{r.expectedArrival ? <span className={r.overdue ? "text-danger" : ""}>{formatDateTime(r.expectedArrival)}</span> : r.expectedReturn ? `Back ${dateLabel(r.expectedReturn)}` : dateLabel(r.plannedDate)}</Cell>
              <Cell><StatusBadge tone={TRANSFER_TONE[r.status]}>{r.statusLabel}</StatusBadge></Cell><Cell>{r.assets ? `${r.received} of ${r.assets}` : "—"}</Cell></tr>)}
          </LinesTable>
        )}
      </>}
    </div>
  );
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(TRANSFER_REPORT_KINDS[0].id);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "transfers", "report", kind), queryFn: () => getTransferReport(kind), retry: false });
  const rows = q.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => x !== "href") : [];
  return (
    <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={TRANSFER_REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} />}>
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
          {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{String(r[x] ?? "")}</Link> : String(r[x] ?? "")}</Cell>)}</tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ new transfer
export function NewTransferScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const stores = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody-stores"), queryFn: getStores, staleTime: 60_000, retry: false });
  const submit = useSubmitKey();
  const [f, setF] = useState({ transferType: "LOCATION", reasonCode: "OFFICE_RELOCATION", reasonDetail: "", plannedDate: new Date().toISOString().slice(0, 10), expectedArrivalAt: "", expectedReturnAt: "",
    toLocationId: "", toCustodianType: "", toUserId: "", toDepartmentId: "", toStoreLocationId: "", carrier: "", notes: "", assets: params.get("asset") ?? "" });
  const [check, setCheck] = useState<ValidationLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setCheck(null); };
  const preselected = params.get("assetId");
  const codes = f.assets.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
  const lines = preselected && !codes.length ? [{ assetId: preselected }] : codes.map((asset) => ({ asset }));
  const needsLocation = f.transferType !== "CUSTODY";
  const needsCustodian = ["CUSTODY", "COMBINED"].includes(f.transferType);
  const input = () => ({ ...Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== "assets" && v !== "")), toLocationId: needsLocation ? f.toLocationId || undefined : undefined,
    toCustodianType: f.transferType === "TEMPORARY" ? undefined : f.toCustodianType || undefined, expectedArrivalAt: f.expectedArrivalAt ? new Date(f.expectedArrivalAt).toISOString() : undefined, lines });
  const validate = async () => {
    setBusy(true); setError(null);
    try { setCheck((await validateTransfer(input())).lines); } catch (x) { setError(errorMessage(x)); } finally { setBusy(false); }
  };
  const save = async (andSubmit: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await submit.run(() => createTransfer({ ...input(), submit: andSubmit, idempotencyKey: newKey() }));
      setDone(true);
      router.replace(`${TRANSFERS_BASE}/${r.transferId}`);
    } catch (x) { setError(errorMessage(x)); setBusy(false); }
  };
  if (options.isLoading) return <LoadingState label="Preparing the form" rows={6} />;
  const o = options.data;
  const opt = (rows: Array<{ id: string; name: string; code?: string }> | undefined) => (rows ?? []).map((r) => ({ value: r.id, label: r.code ? `${r.code} · ${r.name}` : r.name }));
  const blocked = (check ?? []).filter((l) => !l.ok);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New transfer" description="Choose the assets, where they go and who will be responsible. Each asset is checked before you submit; nothing moves until it is dispatched and received." />
      {error && <Notice tone="danger">{error}</Notice>}
      <FormSection title="The movement">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Kind of transfer" selectedKey={f.transferType} onSelectionChange={(k) => set("transferType")(String(k))} options={TYPE_OPTIONS} isRequired />
          <Select label="Reason" selectedKey={f.reasonCode} onSelectionChange={(k) => set("reasonCode")(String(k))} options={REASON_OPTIONS} isRequired />
          <TextField label="Planned date" type="date" value={f.plannedDate} onChange={set("plannedDate")} isRequired />
          {f.transferType === "TEMPORARY" ? <TextField label="Expected back" type="date" value={f.expectedReturnAt} onChange={set("expectedReturnAt")} isRequired />
            : f.transferType !== "CUSTODY" && <TextField label="Expected arrival" type="datetime-local" value={f.expectedArrivalAt} onChange={set("expectedArrivalAt")} />}
        </div>
        <TextField label={f.reasonCode === "OTHER" ? "Explain the reason" : "Details (optional)"} value={f.reasonDetail} onChange={set("reasonDetail")} isRequired={f.reasonCode === "OTHER"} />
      </FormSection>
      <FormSection title="Destination">
        {needsLocation && <Select label="To location" selectedKey={f.toLocationId || null} onSelectionChange={(k) => set("toLocationId")(String(k ?? ""))} options={opt(o?.locations)} isRequired />}
        {f.transferType !== "TEMPORARY" && <div className="grid gap-3 sm:grid-cols-2">
          <Select label={needsCustodian ? "Who will be responsible" : "New custodian (optional)"} selectedKey={f.toCustodianType || ""} onSelectionChange={(k) => set("toCustodianType")(String(k ?? ""))}
            options={[...(needsCustodian ? [] : [{ value: "", label: "Keep the current custodian" }]), { value: "EMPLOYEE", label: "An employee" }, { value: "DEPARTMENT", label: "A department" }, { value: "ASSET_STORE", label: "An asset store" }]} />
          {f.toCustodianType === "EMPLOYEE" && <Select label="Employee" selectedKey={f.toUserId || null} onSelectionChange={(k) => set("toUserId")(String(k ?? ""))} options={(o?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} isRequired />}
          {f.toCustodianType === "DEPARTMENT" && <Select label="Department" selectedKey={f.toDepartmentId || null} onSelectionChange={(k) => set("toDepartmentId")(String(k ?? ""))} options={opt(o?.departments)} isRequired />}
          {f.toCustodianType === "ASSET_STORE" && <Select label="Asset store" selectedKey={f.toStoreLocationId || null} onSelectionChange={(k) => set("toStoreLocationId")(String(k ?? ""))} options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))} isRequired />}
        </div>}
        <TextField label="Carrier or person moving it (optional)" value={f.carrier} onChange={set("carrier")} />
      </FormSection>
      <FormSection title="Assets" description={preselected && !codes.length ? "The asset you came from is selected; add more codes to move several." : "Scan or type each asset code, serial or tag — one per line."}>
        <TextArea label="Assets" value={f.assets} onChange={set("assets")} placeholder={"AST-000124\nAST-000125"} />
        <TextArea label="Notes" value={f.notes} onChange={set("notes")} />
        <span><Button variant="secondary" isLoading={busy && !check} isDisabled={busy || !lines.length} onPress={validate}>Check the assets</Button></span>
        {check && <LinesTable columns={["Asset", "From", "To", "Check"]}>
          {check.map((l, i) => <tr key={i}><Cell>{l.asset}</Cell><Cell>{l.from?.custodian ?? "—"}</Cell><Cell>{[l.to?.location, l.to?.custodian].filter(Boolean).join(" · ") || "—"}</Cell>
            <Cell>{l.ok ? <StatusBadge tone="success">Can move</StatusBadge> : <span className="text-sm text-danger">{l.error?.message}</span>}</Cell></tr>)}
        </LinesTable>}
        {blocked.length > 0 && <Notice tone="warning">{`${blocked.length} asset(s) cannot move as asked. Remove or fix them before saving.`}</Notice>}
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(TRANSFERS_BASE)}>Cancel</Button>
        <Button variant="secondary" isDisabled={busy || done || !check || blocked.length > 0} onPress={() => save(false)}>Save as draft</Button>
        <Button variant="primary" isLoading={busy && Boolean(check)} isDisabled={busy || done || !check || blocked.length > 0} onPress={() => save(true)}>Submit</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one transfer
export function TransferDetailScreen({ transferId }: { transferId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "transfer", transferId), queryFn: () => getTransfer(transferId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  if (q.isLoading) return <LoadingState label="Loading the transfer" rows={5} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see this transfer" description="It needs a transfer permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const t = q.data;
  const done = async (text: string, tone: "success" | "warning" = "success") => { setMessage({ tone, text }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const dispatch = (): Ask => {
    const key = newKey();
    return { title: t.type === "CUSTODY" ? "Record the handover" : "Confirm dispatch", confirm: t.type === "CUSTODY" ? "Handed over" : "Dispatched",
      description: t.type === "CUSTODY" ? "The custody moves now; the recipient then acknowledges it in My Assets." : "The assets leave their source: they are in transit, and their registered location stays where it is until they are received.",
      fields: [{ name: "condition", label: "Condition at dispatch", kind: "select", required: true, options: CONDITION_OPTIONS, initial: "GOOD" }, ...(t.type === "CUSTODY" ? [] : [
        { name: "transitHolder", label: "Carried by (person or carrier)", kind: "text" as const }, { name: "trackingReference", label: "Tracking reference", kind: "text" as const }])],
      run: async (v) => { await transferAction(t.id, "dispatch", { ...v, commandId: key }); await done(t.type === "CUSTODY" ? "Handed over." : "Dispatched — in transit."); } };
  };
  const receive = (l: TransferLine): Ask => {
    const key = newKey();
    return { title: `Receive ${l.asset}`, confirm: "Confirm receipt", description: "Scan the asset that arrived (or type its code, serial or tag) and record its condition. A different asset is recorded as an exception, never accepted.",
      fields: [{ name: "identifier", label: "Scanned or typed identifier", kind: "text", required: true }, { name: "condition", label: "Condition at receipt", kind: "select", required: true, options: CONDITION_OPTIONS, initial: "GOOD" },
        ...(l.toCustodian ? [{ name: "handedToCustodian", label: `Handed to ${l.toCustodian} now`, kind: "checkbox" as const }] : []), { name: "notes", label: "Notes (damage, missing accessories…)", kind: "textarea" }],
      run: async (v) => {
        const r = await lineAction<{ lineStatus: string; code?: string; custodyOutcome?: string }>(t.id, l.id, "receive", { ...v, handedToCustodian: v.handedToCustodian === true, commandId: key });
        await done(r.code === "ASSET_TRANSFER_RECEIPT_MISMATCH" ? "That is not the expected asset: recorded as an exception." : r.custodyOutcome === "IN_STORE_PENDING_ISSUE" ? "Received into the store; the employee's issue is pending." : "Received.", r.code ? "warning" : "success");
      } };
  };
  const report = (l: TransferLine): Ask => ({ title: `Report a problem — ${l.asset}`, confirm: "Report", tone: "danger", description: "Recorded for the asset team. Missing in transit opens an investigation — never an automatic loss or write-off.",
    fields: [{ name: "type", label: "What happened", kind: "select", required: true, options: [{ value: "MISSING", label: "Missing in transit" }, { value: "DAMAGED", label: "Damaged" }, { value: "DISPUTED", label: "Disputed receipt" }, { value: "OTHER", label: "Other" }] },
      { name: "description", label: "Details", kind: "textarea", required: true }],
    run: async (v) => { await lineAction(t.id, l.id, "exception", v); await done("Reported.", "warning"); } });
  const resolve = (x: TransferDetail["exceptions"][number]): Ask => ({ title: `Resolve ${x.number}`, confirm: "Resolve", description: x.description,
    fields: [{ name: "resolution", label: "Resolution", kind: "select", required: true, options: [{ value: "RECEIVED", label: "Received after all (scan it)" }, { value: "CORRECTED", label: "Identity corrected (scan it)" },
      { value: "ACCEPTED", label: "Accept as received" }, { value: "RETURN_TO_SOURCE", label: "Returned to the source" }, { value: "LOST_INVESTIGATION", label: "Not received — leave to the loss investigation" }] },
      { name: "identifier", label: "Scanned identifier (when receiving)", kind: "text" }, { name: "condition", label: "Condition (when receiving)", kind: "select", options: CONDITION_OPTIONS }, { name: "note", label: "Note", kind: "textarea", required: true }],
    run: async (v) => { await resolveException(x.id, Object.fromEntries(Object.entries(v).filter(([, y]) => y !== ""))); await done("Resolved."); } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t.number} · ${t.from} → ${t.to}`} description={`${t.typeLabel} — ${t.reason}${t.reasonDetail ? `: ${t.reasonDetail}` : ""}`}
        primaryAction={<span className="flex flex-wrap items-center gap-2"><StatusBadge tone={TRANSFER_TONE[t.status]}>{t.statusLabel}</StatusBadge>
          {t.can.submit && <Button variant="primary" onPress={() => transferAction(t.id, "submit", { expectedVersion: t.version }).then(() => done("Submitted.")).catch((x) => setMessage({ tone: "warning", text: errorMessage(x) }))}>Submit</Button>}
          {t.can.approve && <Button variant="primary" onPress={() => setAsk({ title: `Approve ${t.number}`, confirm: "Approve", fields: [{ name: "note", label: "Note", kind: "textarea" }], run: async (v) => { await transferAction(t.id, "approve", { ...v, expectedVersion: t.version }); await done("Approved."); } })}>Approve</Button>}
          {t.can.reject && <Button variant="secondary" onPress={() => setAsk({ title: "Ask for changes", confirm: "Send back", fields: [{ name: "note", label: "What needs to change", kind: "textarea", required: true }], run: async (v) => { await transferAction(t.id, "request-changes", { ...v, expectedVersion: t.version }); await done("Sent back."); } })}>Request changes</Button>}
          {t.can.reject && <Button variant="ghost" onPress={() => setAsk({ title: "Reject", confirm: "Reject", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }], run: async (v) => { await transferAction(t.id, "reject", v); await done("Rejected."); } })}>Reject</Button>}
          {t.can.dispatch && <Button variant="primary" onPress={() => setAsk(dispatch())}>{t.type === "CUSTODY" ? "Record handover" : "Confirm dispatch"}</Button>}
          {t.can.createReturn && <Button variant="secondary" onPress={() => transferAction<{ transferId: string }>(t.id, "return").then((r) => router.push(`${TRANSFERS_BASE}/${r.transferId}`))}>Start the return</Button>}
          {t.can.cancel && <Button variant="ghost" onPress={() => setAsk({ title: "Cancel the transfer", confirm: "Cancel transfer", tone: "danger", description: "Nothing has left yet: the assets stay where they are and the reservation is released.",
            fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }], run: async (v) => { await transferAction(t.id, "cancel", v); await done("Cancelled."); } })}>Cancel</Button>}
        </span>} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {t.approvalReasons.length > 0 && t.status === "PENDING_APPROVAL" && <Notice tone="info">{`Needs approval: ${t.approvalReasons.join("; ")}.`}</Notice>}
      {t.decisionNote && <Notice tone="info">{`Decision note: ${t.decisionNote}`}</Notice>}
      <FactList columns={3} items={[["Assets", String(t.progress.assets)], ["Dispatched", String(t.progress.dispatched)], ["Received", String(t.progress.received)], ["Outstanding", String(t.progress.outstanding)],
        ["Approval", `${t.approvalLabel}${t.approvedBy ? ` — ${t.approvedBy}` : ""}`], ["Planned", dateLabel(t.plannedDate)], ["Expected", t.expectedArrival ? formatDateTime(t.expectedArrival) : t.expectedReturn ? `Back ${dateLabel(t.expectedReturn)}` : "—"],
        ["Carrier / tracking", [t.carrier, t.trackingReference].filter(Boolean).join(" · ") || "—"],
        ...(t.returnLeg ? [["Return", <Link key="r" className="text-brand hover:underline" href={t.returnLeg.href}>{`${t.returnLeg.number} (${t.returnLeg.status})`}</Link>]] as Array<[string, ReactNode]> : []),
        ...(t.returnOf ? [["Return of", <Link key="o" className="text-brand hover:underline" href={t.returnOf.href}>{t.returnOf.number}</Link>]] as Array<[string, ReactNode]> : [])]} />
      <Panel title="Assets">
        <LinesTable columns={["Asset", "From", "To", "Status", "Dispatch", "Receipt", ""]}>
          {t.lines.map((l) => <tr key={l.id}><Cell><Link className="text-brand hover:underline" href={l.assetHref}>{l.asset}</Link>{l.serialNumber && <span className="block text-xs text-text-muted">{l.serialNumber}</span>}</Cell>
            <Cell>{l.from}{l.fromCustodian && <span className="block text-xs text-text-muted">{l.fromCustodian}</span>}</Cell><Cell>{l.to}{l.toCustodian && <span className="block text-xs text-text-muted">{l.toCustodian}</span>}</Cell>
            <Cell><StatusBadge tone={LINE_TONE[l.status]}>{l.statusLabel}</StatusBadge>{l.closeReason && <span className="block text-xs text-text-muted">{l.closeReason}</span>}
              {l.custodyOutcome === "IN_STORE_PENDING_ISSUE" && <span className="block text-xs text-warning">In the store — issue pending</span>}{l.custodyOutcome === "PENDING_HANDOVER" && <span className="block text-xs text-warning">Handover pending</span>}</Cell>
            <Cell>{l.dispatchedAt ? `${formatDateTime(l.dispatchedAt)} · ${l.dispatchCondition?.toLowerCase() ?? ""}` : "—"}</Cell>
            <Cell>{l.receivedAt ? `${formatDateTime(l.receivedAt)} · ${l.receiptCondition?.toLowerCase() ?? ""}${l.receivedBy ? ` · ${l.receivedBy}` : ""}` : "—"}</Cell>
            <Cell><span className="flex gap-1">{l.status === "DISPATCHED" && t.can.receive && <Button size="compact" variant="primary" onPress={() => setAsk(receive(l))}>Receive</Button>}
              {t.can.reportException && ["DISPATCHED", "RECEIPT_EXCEPTION", "COMPLETED"].includes(l.status) && <Button size="compact" variant="ghost" onPress={() => setAsk(report(l))}>Report a problem</Button>}</span></Cell></tr>)}
        </LinesTable>
      </Panel>
      {t.exceptions.length > 0 && <Panel title="Exceptions">
        <LinesTable columns={["Exception", "Asset", "What happened", "Status", ""]}>
          {t.exceptions.map((x) => <tr key={x.id}><Cell>{x.number}<span className="block text-xs text-text-muted">{x.typeLabel}</span></Cell><Cell>{x.asset}</Cell><Cell>{x.description}{x.observed && <span className="block text-xs text-text-muted">{`Expected ${x.expected}, received ${x.observed}`}</span>}</Cell>
            <Cell>{x.status === "RESOLVED" ? `${x.resolutionLabel}${x.resolutionNote ? ` — ${x.resolutionNote}` : ""}` : <StatusBadge tone="danger">Open</StatusBadge>}</Cell>
            <Cell>{x.status !== "RESOLVED" && t.can.resolve && <Button size="compact" variant="ghost" onPress={() => setAsk(resolve(x))}>Resolve</Button>}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {t.events.length > 0 && <Panel title="History">
        <LinesTable columns={["When", "What", "Asset", "By", "Reason"]}>
          {t.events.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase().replace(/^./, (y) => y.toUpperCase())}</Cell><Cell>{e.asset}</Cell><Cell>{e.by}</Cell><Cell>{e.reason}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's movement panel (Custody & Location tab)
export function AssetTransferPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "transfers"), queryFn: () => getAssetView<Panelled>(assetId, "transfers"), retry: false });
  if (q.isLoading || q.isError || !q.data || !q.data.visible) return null;
  const d = q.data;
  return (
    <Panel title="Transfers" description={d.note} actions={d.can.initiate ? <LinkButton size="compact" variant="secondary" href={`${TRANSFERS_BASE}/new?assetId=${d.assetId}`}>Initiate transfer</LinkButton> : undefined}>
      <FactList columns={3} items={[["Last confirmed location", d.confirmedLocation ?? "—"], ["Accountable custodian", d.custodian ?? "—"], ["Now", d.effective === "IN_TRANSFER" ? "In transit" : d.effective.replace(/_/g, " ").toLowerCase()],
        ...(d.movement ? [["Pending movement", <Link key="m" className="text-brand hover:underline" href={d.movement.href}>{`${d.movement.number} — ${d.movement.status}`}</Link>], ["Destination", `${d.movement.destination}${d.movement.receivingCustodian ? ` · ${d.movement.receivingCustodian}` : ""}`],
          ["Receipt", d.movement.receipt ?? "—"]] as Array<[string, ReactNode]> : [])]} />
      {d.history.length > 0 && <LinesTable columns={["Transfer", "Type", "From", "To", "Status", "When"]}>
        {d.history.map((h, i) => <tr key={i}><Cell><Link className="text-brand hover:underline" href={h.href}>{h.number}</Link></Cell><Cell>{h.type}</Cell><Cell>{h.from}</Cell><Cell>{h.to}</Cell><Cell>{h.status}</Cell><Cell>{formatDateTime(h.at)}</Cell></tr>)}
      </LinesTable>}
    </Panel>
  );
}
