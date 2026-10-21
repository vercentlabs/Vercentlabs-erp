"use client";

// Assets — Asset Assignments. Requesting, approving, issuing and taking back equipment for employees, departments and asset stores, on the
// one Custodian record: a request reserves the asset (against other assignments and transfers), its issue is the physical handover that
// moves custody, the recipient acknowledges it in My Assets, and a return is a physical receipt with its condition.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, LinkButton, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { CONDITION_OPTIONS, getDepartments, getStores } from "../custody/custody-api";
import { dateLabel, errorMessage, errorStatus, getAssetView, getOptions, newKey } from "../register/register-api";
import {
  ASSIGNMENTS_BASE, ASSIGNMENT_REPORT_KINDS, ASSIGNMENT_TONE, assignmentAction, assignmentsExportHref, bulkAssign, createAssignment, getAssignable, getAssignment, getAssignmentExceptions, getAssignmentReport,
  getAssignments, getMyRequests, type AssetAssignmentPanel as Panelled, type AssignmentRow, type BulkResult,
} from "./assignments-api";

const VIEWS = [{ id: "all", label: "All Assignments" }, { id: "pending", label: "Pending Requests" }, { id: "ready", label: "Ready to Issue" }, { id: "awaiting", label: "Awaiting Acknowledgment" },
  { id: "active", label: "Active Assignments" }, { id: "returns_due", label: "Returns Due" }, { id: "returned", label: "Returns & Reassignments" }, { id: "clearance", label: "Employee Clearance" },
  { id: "exceptions", label: "Exceptions" }, { id: "reports", label: "Reports" }];
function AssignmentTable({ rows, empty }: { rows: AssignmentRow[]; empty: string }) {
  return (
    <LinesTable columns={["Assignment", "Asset", "Assigned to", "Location", "Status", "Issued", "Expected return", "Acknowledgment"]} empty={rows.length ? undefined : empty}>
      {rows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link></Cell><Cell>{r.asset}</Cell><Cell>{r.recipient}<span className="block text-xs text-text-muted">{r.recipientLabel}</span></Cell>
        <Cell>{r.location}</Cell><Cell><StatusBadge tone={ASSIGNMENT_TONE[r.status]}>{r.returnedAt ? "Returned" : r.statusLabel}</StatusBadge></Cell><Cell>{r.issuedAt ? formatDateTime(r.issuedAt) : "—"}</Cell>
        <Cell>{r.expectedReturn ? <span className={r.overdue ? "text-danger" : ""}>{dateLabel(r.expectedReturn)}</span> : r.assignmentType === "TEMPORARY" ? "—" : "Ongoing"}</Cell><Cell>{r.acknowledgmentLabel ?? "—"}</Cell></tr>)}
    </LinesTable>
  );
}

// ------------------------------------------------------------------ the workspace
export function AssignmentsWorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState(params.get("view") ?? "all");
  const [search, setSearch] = useState("");
  const [bulk, setBulk] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const listed = !["clearance", "exceptions", "reports"].includes(view);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "assignments", view, search), queryFn: () => getAssignments(listed ? view : "all", search), retry: false });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "assignments", "exceptions"), queryFn: getAssignmentExceptions, retry: false, enabled: view === "exceptions" || view === "clearance" });
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't see asset assignments" description="It needs an assignment permission." />;
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Asset Assignments" description="Issuing equipment to people, departments and stores. A request reserves the asset; custody changes only at the physical handover."
        primaryAction={<span className="flex flex-wrap items-center gap-2">{d?.can.request && <LinkButton variant="primary" href={`${ASSIGNMENTS_BASE}/new`}>New assignment</LinkButton>}
          {d?.can.bulk && <Button variant="secondary" onPress={() => setBulk(true)}>Assign in bulk</Button>}{d?.can.export && <Link className="text-sm text-brand hover:underline" href={assignmentsExportHref}>Export</Link>}</span>} />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Assignment views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "reports" ? <AssignmentReports /> : view === "clearance" ? (
        <Panel title="Employee clearance" description="Employees who are no longer active but still hold assets. Each employee's full clearance — every asset, open handover and exception — is on their clearance page.">
          <LinesTable columns={["Employee", "Asset", "Assignment"]} empty={(exceptions.data ?? []).some((e) => e.kind === "INACTIVE_RECIPIENT") ? undefined : "Nobody who left still holds an assigned asset."}>
            {(exceptions.data ?? []).filter((e) => e.kind === "INACTIVE_RECIPIENT").map((e) => <tr key={e.id}><Cell>{e.recipient}</Cell><Cell>{e.asset}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.number}</Link></Cell></tr>)}
          </LinesTable>
          <span><LinkButton size="compact" variant="secondary" href="/assets/custody?view=clearance">All employee clearances</LinkButton></span>
        </Panel>
      ) : view === "exceptions" ? (exceptions.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["Exception", "Assignment", "Asset", "Assigned to"]} empty={(exceptions.data ?? []).length ? undefined : "No assignment exceptions."}>
          {(exceptions.data ?? []).map((e, i) => <tr key={i}><Cell>{e.label}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.number}</Link></Cell><Cell>{e.asset}</Cell><Cell>{e.recipient}</Cell></tr>)}
        </LinesTable>
      )) : <>
        <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Assignment, asset or employee" />
        {q.isLoading ? <LoadingState label="Loading assignments" rows={4} /> : <AssignmentTable rows={d?.rows ?? []} empty="No assignments here." />}
      </>}
      {bulk && <BulkDialog onClose={() => setBulk(false)} onDone={async (r) => { setBulk(false); setResult(r); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); }} />}
      {result && <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) setResult(null); }} title={`${result.number}: ${result.succeeded} assigned, ${result.failed} not`}>
        <div className="flex flex-col gap-3">
          {result.failed === 0 ? <Notice tone="success">Every row was assigned.</Notice> : <LinesTable columns={["Row", "Asset", "Why not"]}>{result.results.filter((r) => !r.ok).map((r) => <tr key={r.row}><Cell>{r.row}</Cell><Cell>{r.asset}</Cell><Cell>{r.message}</Cell></tr>)}</LinesTable>}
          <div className="flex justify-end"><Button variant="primary" onPress={() => setResult(null)}>Done</Button></div>
        </div>
      </Dialog>}
    </div>
  );
}
function AssignmentReports() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(ASSIGNMENT_REPORT_KINDS[0].id);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "assignments", "report", kind), queryFn: () => getAssignmentReport(kind), retry: false });
  const rows = q.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => x !== "href") : [];
  return (
    <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={ASSIGNMENT_REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} />}>
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
          {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{String(r[x] ?? "")}</Link> : String(r[x] ?? "")}</Cell>)}</tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}
// Many at once: one line per asset and recipient ("AST-000201, priya@company.com"); each row is checked and recorded on its own.
function BulkDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: BulkResult) => Promise<void> }) {
  const [lines, setLines] = useState("");
  const [purpose, setPurpose] = useState("New joiners");
  const [issueNow, setIssueNow] = useState("yes");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [asset, email] = l.split(/[,;\t]/).map((x) => x.trim()); return { asset, email }; });
  const save = async () => {
    setBusy(true); setError(null);
    try { await onDone(await bulkAssign({ rows, purpose, issueNow: issueNow === "yes", condition: "GOOD", idempotencyKey: key })); } catch (x) { setError(errorMessage(x)); setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) onClose(); }} title="Assign in bulk" size="lg" description="One line per asset and employee e-mail. Each employee then acknowledges their own asset.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextArea label="Asset, employee e-mail" value={lines} onChange={setLines} placeholder="AST-000201, priya@company.com" />
        <TextField label="Purpose" value={purpose} onChange={setPurpose} isRequired />
        <Select label="Issue now" selectedKey={issueNow} onSelectionChange={(k) => setIssueNow(String(k))} options={[{ value: "yes", label: "Yes — they are being handed over now (condition Good)" }, { value: "no", label: "No — reserve them, issue later" }]} />
        <p className="text-xs text-text-muted">{`${rows.length} row(s)`}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || !rows.length || purpose.trim().length < 3} onPress={save}>Assign</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ new assignment
export function NewAssignmentScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const departments = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody-departments"), queryFn: getDepartments, staleTime: 60_000, retry: false });
  const stores = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody-stores"), queryFn: getStores, staleTime: 60_000, retry: false });
  const [search, setSearch] = useState("");
  const assignable = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "assignable", search), queryFn: () => getAssignable(search), retry: false });
  const team = !assignable.isError;
  const submit = useSubmitKey();
  const [f, setF] = useState({ assetId: params.get("assetId") ?? "", categoryId: "", recipientType: "EMPLOYEE", toUserId: "", toDepartmentId: "", toStoreLocationId: "", deliverToLocationId: "", purpose: "",
    assignmentType: "INDEFINITE", requestedIssueDate: new Date().toISOString().slice(0, 10), expectedReturnDate: "", accessories: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const save = async (andSubmit: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await submit.run(() => createAssignment({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")), submit: andSubmit, idempotencyKey: newKey() }));
      setDone(true);
      router.replace(`${ASSIGNMENTS_BASE}/${r.requestId}`);
    } catch (x) { setError(errorMessage(x)); setBusy(false); }
  };
  if (options.isLoading) return <LoadingState label="Preparing the form" rows={6} />;
  const o = options.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={team ? "New assignment" : "Request an asset"} description="The request reserves the asset once submitted; the asset is handed over (and custody changes) only when it is physically issued." />
      {error && <Notice tone="danger">{error}</Notice>}
      <FormSection title="Which asset">
        {team ? <>
          <TextField label="Find an available asset" value={search} onChange={setSearch} placeholder="Code, name or serial" />
          <Select label="Asset" selectedKey={f.assetId || null} onSelectionChange={(k) => set("assetId")(String(k ?? ""))} options={(assignable.data ?? []).map((a) => ({ value: a.assetId, label: `${a.asset}${a.store ? ` — in ${a.store}` : a.location ? ` — ${a.location}` : ""}` }))} />
        </> : <Select label="What kind of asset do you need?" selectedKey={f.categoryId || null} onSelectionChange={(k) => set("categoryId")(String(k ?? ""))} options={(o?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} isRequired />}
      </FormSection>
      <FormSection title="For whom">
        {team && <Select label="Recipient" selectedKey={f.recipientType} onSelectionChange={(k) => set("recipientType")(String(k))} options={[{ value: "EMPLOYEE", label: "An employee" }, { value: "DEPARTMENT", label: "A department" }, { value: "ASSET_STORE", label: "An asset store" }]} />}
        {team && f.recipientType === "EMPLOYEE" && <Select label="Employee" selectedKey={f.toUserId || null} onSelectionChange={(k) => set("toUserId")(String(k ?? ""))} options={(o?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} isRequired />}
        {team && f.recipientType === "DEPARTMENT" && <Select label="Department" selectedKey={f.toDepartmentId || null} onSelectionChange={(k) => set("toDepartmentId")(String(k ?? ""))} options={(departments.data ?? []).map((x) => ({ value: x.id, label: x.accountable ? `${x.name} (${x.accountable})` : `${x.name} — no accountable person` }))} isRequired />}
        {team && f.recipientType === "ASSET_STORE" && <Select label="Asset store" selectedKey={f.toStoreLocationId || null} onSelectionChange={(k) => set("toStoreLocationId")(String(k ?? ""))} options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))} isRequired />}
        <TextField label="Purpose" value={f.purpose} onChange={set("purpose")} isRequired placeholder="e.g. Laptop for the new engineer" />
        {team && <Select label="Deliver to another location (optional)" selectedKey={f.deliverToLocationId || ""} onSelectionChange={(k) => set("deliverToLocationId")(String(k ?? ""))}
          options={[{ value: "", label: "Handed over where it is" }, ...(o?.locations ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))]} description="Another site: it is sent through an Asset Transfer and received there." />}
      </FormSection>
      <FormSection title="For how long">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Assignment" selectedKey={f.assignmentType} onSelectionChange={(k) => set("assignmentType")(String(k))} options={[{ value: "INDEFINITE", label: "Ongoing (no end date)" }, { value: "TEMPORARY", label: "Temporary" }]} />
          <TextField label="Needed from" type="date" value={f.requestedIssueDate} onChange={set("requestedIssueDate")} />
          {f.assignmentType === "TEMPORARY" && <TextField label="Expected back" type="date" value={f.expectedReturnDate} onChange={set("expectedReturnDate")} isRequired />}
        </div>
        <TextField label="Accessories (charger, bag…)" value={f.accessories} onChange={set("accessories")} />
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(ASSIGNMENTS_BASE)}>Cancel</Button>
        <Button variant="secondary" isDisabled={busy || done} onPress={() => save(false)}>Save as draft</Button>
        <Button variant="primary" isLoading={busy} isDisabled={busy || done || f.purpose.trim().length < 3 || (team ? !f.assetId : !f.categoryId)} onPress={() => save(true)}>Submit</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one assignment
export function AssignmentDetailScreen({ requestId }: { requestId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "assignment", requestId), queryFn: () => getAssignment(requestId), retry: false });
  const stores = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "custody-stores"), queryFn: getStores, staleTime: 60_000, retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  if (q.isLoading) return <LoadingState label="Loading the assignment" rows={5} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see this assignment" description="It needs an assignment permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const r = q.data;
  const done = async (text: string, tone: "success" | "warning" = "success") => { setMessage({ tone, text }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const act = (action: string, input: Record<string, unknown>, text: string) => assignmentAction(r.id, action, input).then(() => done(text));
  const issue = (): Ask => {
    const key = newKey();
    return { title: `Issue ${r.asset}`, confirm: "Handed over", description: r.deliverToLocationId ? "It goes to another site: an Asset Transfer is opened and the recipient's custody starts when it is received there." : "Scan the asset in hand and record its condition. Custody moves now; the recipient then acknowledges it in My Assets.",
      fields: [{ name: "identifier", label: "Scanned or typed code / serial / tag", kind: "text", required: true }, { name: "condition", label: "Condition at issue", kind: "select", required: true, options: CONDITION_OPTIONS, initial: "GOOD" },
        { name: "accessories", label: "Accessories handed over", kind: "text", initial: r.accessories ?? "" }],
      run: async (v) => { await assignmentAction(r.id, "issue", { ...v, commandId: key }); await done("Issued."); } };
  };
  const giveBack = (): Ask => ({ title: `Receive the return — ${r.asset}`, confirm: "Received", description: "Scan what was returned and inspect it. A damaged or unserviceable asset is placed on hold for repair assessment, never back in the pool on its own.",
    fields: [{ name: "identifier", label: "Scanned or typed code / serial / tag", kind: "text", required: true }, { name: "condition", label: "Condition at return", kind: "select", required: true, options: CONDITION_OPTIONS, initial: "GOOD" },
      { name: "storeLocationId", label: "Into which store", kind: "select", required: true, options: (stores.data ?? []).map((s) => ({ value: s.id, label: s.name })) }, { name: "accessories", label: "Accessories returned", kind: "text" },
      { name: "notes", label: "Notes", kind: "textarea" }],
    run: async (v) => { const x = await assignmentAction<{ held: boolean }>(r.id, "return-confirm", { ...v, toType: "ASSET_STORE" }); await done(x.held ? "Received — placed on hold for repair assessment." : "Received into the store.", x.held ? "warning" : "success"); } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${r.number} · ${r.asset}`} description={`${r.recipientLabel}: ${r.recipient} — ${r.purpose}`}
        primaryAction={<span className="flex flex-wrap items-center gap-2"><StatusBadge tone={ASSIGNMENT_TONE[r.status]}>{r.returnedAt ? "Returned" : r.statusLabel}</StatusBadge>
          {r.can.submit && <Button variant="primary" onPress={() => act("submit", { expectedVersion: r.version }, "Submitted.")}>Submit</Button>}
          {r.can.approve && <Button variant="primary" onPress={() => setAsk({ title: `Approve ${r.number}`, confirm: "Approve", fields: [...(r.can.chooseAsset ? [{ name: "asset", label: `Asset to assign (${r.category ?? "code"})`, kind: "text" as const, required: true }] : []), { name: "note", label: "Note", kind: "textarea" }],
            run: async (v) => { await assignmentAction(r.id, "approve", { ...v, expectedVersion: r.version }); await done("Approved — ready to issue."); } })}>Approve</Button>}
          {r.can.reject && <Button variant="secondary" onPress={() => setAsk({ title: "Ask for changes", confirm: "Send back", fields: [{ name: "note", label: "What needs to change", kind: "textarea", required: true }], run: (v) => act("request-changes", v, "Sent back.") })}>Request changes</Button>}
          {r.can.reject && <Button variant="ghost" onPress={() => setAsk({ title: "Reject", confirm: "Reject", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }], run: (v) => act("reject", v, "Rejected.") })}>Reject</Button>}
          {r.can.issue && <Button variant="primary" onPress={() => setAsk(issue())}>Issue</Button>}
          {r.can.acknowledge && <LinkButton variant="primary" href="/assets/my-assets">Acknowledge in My Assets</LinkButton>}
          {r.can.requestReturn && <Button variant="secondary" onPress={() => setAsk({ title: "Ask to return it", confirm: "Ask", fields: [{ name: "note", label: "Note", kind: "textarea" }], run: (v) => act("return-request", v, "The asset team has been asked to take it back.") })}>Request return</Button>}
          {r.can.receiveReturn && <Button variant="secondary" onPress={() => setAsk(giveBack())}>Receive return</Button>}
          {r.can.extend && <Button variant="ghost" onPress={() => setAsk({ title: "Extend the assignment", confirm: "Extend", description: `The original return date (${dateLabel(r.originalExpectedReturn)}) stays on record.`,
            fields: [{ name: "expectedReturnDate", label: "New expected return", kind: "date", required: true }, { name: "reason", label: "Why", kind: "textarea", required: true }], run: (v) => act("extend", v, "Extended.") })}>Extend</Button>}
          {r.can.reassign && r.assetId && <LinkButton variant="ghost" href={`${ASSIGNMENTS_BASE}/new?assetId=${r.assetId}`}>Reassign</LinkButton>}
          {r.can.cancel && <Button variant="ghost" onPress={() => setAsk({ title: "Cancel the request", confirm: "Cancel request", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
            run: async (v) => { await assignmentAction(r.id, "cancel", v); await done("Cancelled — the asset is free again."); router.refresh(); } })}>Cancel</Button>}
        </span>} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {r.acknowledgment === "DISPUTED" && <Notice tone="warning">{`The recipient disputed the receipt${r.handover?.dispute ? ` (${r.handover.dispute.toLowerCase().replace(/_/g, " ")})` : ""}. The physical handover stays on record; the asset team resolves it in Custody & Handovers.`}</Notice>}
      {r.overdue && <Notice tone="warning">{`The expected return (${dateLabel(r.expectedReturn)}) has passed.`}</Notice>}
      <FactList columns={3} items={[["Current custodian", r.current.custodian ?? "—"], ["Current location", r.current.location ?? "—"], ["Assignment", r.assignmentType === "TEMPORARY" ? `Temporary, back ${dateLabel(r.expectedReturn)}` : "Ongoing"],
        ["Needed from", dateLabel(r.requestedIssueDate)], ["Approval", r.approvalStatus.toLowerCase().replace(/_/g, " ")], ["Reservation", r.reservation ? `${r.reservation.status.toLowerCase()}${r.reservation.reason ? ` — ${r.reservation.reason}` : ""}` : "—"],
        ["Issued", r.issuedAt ? `${formatDateTime(r.issuedAt)}${r.issueCondition ? ` · ${r.issueCondition.toLowerCase()}` : ""}` : "—"], ["Acknowledgment", r.acknowledgmentLabel ?? "—"],
        ["Returned", r.returnedAt ? `${formatDateTime(r.returnedAt)}${r.returnCondition ? ` · ${r.returnCondition.toLowerCase()}` : ""}` : "—"],
        ...(r.transfer ? [["Delivery transfer", <Link key="t" className="text-brand hover:underline" href={r.transfer.href}>{`${r.transfer.number} (${r.transfer.status.toLowerCase().replace(/_/g, " ")})`}</Link>]] as Array<[string, ReactNode]> : []),
        ...(r.handover ? [["Handover", `${r.handover.number} · ${r.handover.status.toLowerCase().replace(/_/g, " ")}`]] as Array<[string, ReactNode]> : [])]} />
      <Panel title="History">
        <LinesTable columns={["When", "What", "By", "Reason"]} empty={r.events.length ? undefined : "Nothing yet."}>
          {r.events.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase().replace(/^./, (y) => y.toUpperCase())}</Cell><Cell>{e.by}</Cell><Cell>{e.reason}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <p className="text-xs text-text-muted">{r.note}</p>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's assignment panel, and My Assets requests
export function AssetAssignmentPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "assignments"), queryFn: () => getAssetView<Panelled>(assetId, "assignments"), retry: false });
  if (q.isLoading || q.isError || !q.data || !q.data.visible) return null;
  const d = q.data;
  return (
    <Panel title="Assignment" actions={d.can.assign ? <LinkButton size="compact" variant="secondary" href={`${ASSIGNMENTS_BASE}/new?assetId=${d.assetId}`}>{d.current ? "Reassign" : "Assign"}</LinkButton> : undefined}>
      <FactList columns={3} items={[["Current assignment", d.current ? <Link key="c" className="text-brand hover:underline" href={d.current.href}>{`${d.current.number} — ${d.current.recipient}`}</Link> : "Not assigned"],
        ["Acknowledgment", d.current?.acknowledgmentLabel ?? "—"], ["Open request", d.open ? <Link key="o" className="text-brand hover:underline" href={d.open.href}>{`${d.open.number} — ${d.open.statusLabel}`}</Link> : "None"]]} />
      {d.history.length > 1 && <AssignmentTable rows={d.history} empty="" />}
    </Panel>
  );
}
export function MyAssignmentRequests() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "assignments", "mine"), queryFn: getMyRequests, retry: false });
  if (q.isLoading || q.isError || !q.data) return null;
  const open = q.data.rows.filter((r) => !r.returnedAt && !["CANCELLED", "REJECTED"].includes(r.status) && r.status !== "FULFILLED");
  return (
    <Panel title="My requests" actions={q.data.can.request ? <LinkButton size="compact" variant="secondary" href={`${ASSIGNMENTS_BASE}/new`}>Request an asset</LinkButton> : undefined}>
      <LinesTable columns={["Request", "Asset", "Status"]} empty={open.length ? undefined : "No open requests."}>
        {open.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link></Cell><Cell>{r.asset}</Cell><Cell>{r.statusLabel}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
