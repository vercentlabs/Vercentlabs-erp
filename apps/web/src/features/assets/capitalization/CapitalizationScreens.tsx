"use client";

// Assets — Purchases & Capitalization. Procurement buys, the Register identifies each asset, Finance capitalizes: purchases with units still
// to register; registered assets whose cost waits for Finance; cost allocation (shared freight, installation, nonrecoverable tax,
// discounts) without ever exceeding a source line; Finance's review queue (approval by someone other than the requester), posting once
// as a reclassification — never a second supplier liability; capital work in progress transferred to the assets it becomes; adjustments
// for credits and extra costs; and the reconciliation of every source line.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, LinkButton, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { BatchesPanel, InvoicesPanel } from "../invoices/InvoiceScreens";
import { REGISTER_BASE, dateLabel, errorMessage, errorStatus, getAssetView, lookup, money, newKey } from "../register/register-api";
import {
  CAP_BASE, CAP_REPORT_KINDS, CAP_TONE, COMPONENT_OPTIONS, capAction, capExportHref, cwipAction, getAdjustments, getCapReport, getCapitalization, getCapitalizations, getCostPending, getCostSources, getCwip,
  getCwipProjects, getExceptions, getOverview, getPurchases, getReconciliation, requestAction, type AssetCap, type Cap, type CostPending, type Overview,
} from "./cap-api";

const VIEWS = [{ id: "overview", label: "Overview" }, { id: "purchases", label: "Purchases to Register" }, { id: "invoices", label: "Create Assets From Invoice" }, { id: "batches", label: "Registration Batches" },
  { id: "pending", label: "Registered / Cost Pending" }, { id: "review", label: "Capitalization Review" },
  { id: "capitalized", label: "Capitalized Assets" }, { id: "cwip", label: "Under Construction" }, { id: "adjustments", label: "Adjustments" }, { id: "reconciliation", label: "Reconciliation" }];
const amount = (v: string | null | undefined) => (v === undefined ? "Restricted" : money(v ?? null));
function CapTable({ rows, empty }: { rows: Cap[]; empty: string }) {
  return (
    <LinesTable columns={["Request", "Asset", "Status", { label: "Amount", numeric: true }, "Capitalization date", "Requested", "Approved"]} empty={rows.length ? undefined : empty}>
      {rows.map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link></Cell><Cell><Link className="hover:underline" href={r.targetHref}>{r.target}</Link></Cell>
        <Cell><StatusBadge tone={CAP_TONE[r.status]}>{r.statusLabel}</StatusBadge>{r.taxReview && r.status === "PENDING_REVIEW" && <span className="block text-xs text-warning">Tax to verify</span>}</Cell>
        <Cell numeric>{amount(r.total)}</Cell><Cell>{dateLabel(r.capitalizationDate)}</Cell><Cell>{`${formatDateTime(r.requestedAt)}${r.requestedBy ? ` · ${r.requestedBy}` : ""}`}</Cell><Cell>{r.approvedBy ?? ""}</Cell></tr>)}
    </LinesTable>
  );
}

// ------------------------------------------------------------------ the workspace
export function CapitalizationWorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [allocate, setAllocate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const k = (...parts: unknown[]) => scopedQueryKey(workspace, "assets", "capitalization", ...parts);
  const overview = useQuery({ queryKey: k("overview"), queryFn: getOverview, retry: false });
  const purchases = useQuery({ queryKey: k("purchases"), queryFn: () => getPurchases(), retry: false, enabled: view === "purchases" });
  const pending = useQuery({ queryKey: k("pending"), queryFn: getCostPending, retry: false, enabled: view === "pending" });
  const group = view === "review" ? "review" : view === "capitalized" ? "posted" : null;
  const requests = useQuery({ queryKey: k("requests", group), queryFn: () => getCapitalizations(group ?? "all"), retry: false, enabled: Boolean(group) });
  const approved = useQuery({ queryKey: k("requests", "approved"), queryFn: () => getCapitalizations("approved"), retry: false, enabled: view === "review" });
  const cwip = useQuery({ queryKey: k("cwip"), queryFn: getCwipProjects, retry: false, enabled: view === "cwip" });
  const adjustments = useQuery({ queryKey: k("adjustments"), queryFn: getAdjustments, retry: false, enabled: view === "adjustments" });
  const recon = useQuery({ queryKey: k("reconciliation"), queryFn: getReconciliation, retry: false, enabled: view === "reconciliation" });
  if (overview.isError && errorStatus(overview.error) === 403) return <PermissionState title="You can't see asset acquisitions" description="It needs an acquisition or capitalization permission." />;
  if (overview.isLoading) return <LoadingState label="Loading" rows={4} />;
  if (!overview.data) return <Notice tone="danger">{errorMessage(overview.error)}</Notice>;
  const o = overview.data;
  const refresh = async (text: string) => { setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  const requestFor = (r: CostPending): Ask => ({ title: `Request capitalization — ${r.asset}`, confirm: "Submit to Finance",
    description: "Finance reviews the proposed cost, its tax treatment and accounts. Registering, capitalizing and commissioning stay separate: depreciation starts when Finance sets it, never on the purchase date.",
    fields: [{ name: "capitalizationDate", label: "Accounting date", kind: "date", required: true }, { name: "availableForUseDate", label: "Available for use (if known)", kind: "date" }, { name: "note", label: "Note for Finance", kind: "textarea" }],
    run: async (v) => { const x = await capAction<{ number: string }>("request", { assetId: r.assetId, ...v }); await refresh(`${x.number} sent to Finance.`); } });
  const newCwip = (): Ask => ({ title: "Start a CWIP project", confirm: "Start", description: "For equipment being installed or built: its costs accumulate here and are transferred to the assets it becomes once they are ready for use.",
    fields: [{ name: "name", label: "Name", kind: "text", required: true }, { name: "description", label: "What is being built or installed", kind: "textarea" }],
    run: async (v) => { const x = await capAction<{ cwipId: string }>("cwip-create", v); router.push(`${CAP_BASE}/cwip/${x.cwipId}`); } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Purchases & Capitalization" description="Procurement buys, the Asset Register identifies each asset, Finance capitalizes. Every amount links to its source line and is allocated once."
        primaryAction={<span className="flex flex-wrap items-center gap-2">
          {o.can.register && <LinkButton variant="primary" href={`${REGISTER_BASE}/from-purchase`}>Register from purchase</LinkButton>}
          {o.can.allocate && <Button variant="secondary" onPress={() => setAllocate(true)}>Allocate a cost</Button>}
          {o.can.cwip && <Button variant="ghost" onPress={() => setAsk(newCwip())}>Start CWIP</Button>}
          {o.can.export && <Link className="text-sm text-brand hover:underline" href={capExportHref}>Export</Link>}
        </span>} />
      {message && <Notice tone="success">{message}</Notice>}
      <Tabs selectedKey={view} onSelectionChange={(key) => select(String(key))}>
        <TabList aria-label="Acquisition views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" && <OverviewTab overview={o} />}
      {view === "purchases" && (purchases.isLoading ? <LoadingState label="Loading" rows={3} /> : purchases.isError ? <Notice tone="warning">{errorMessage(purchases.error)}</Notice> : (
        <LinesTable columns={["Source", "Document", "Description", "Supplier", { label: "Units", numeric: true }, { label: "Registered", numeric: true }, { label: "To register", numeric: true }, ...(o.can.cost ? [{ label: "Unit cost", numeric: true }] : []), ""]}
          empty={(purchases.data ?? []).length ? undefined : "Every purchased unit is registered."}>
          {(purchases.data ?? []).map((p) => <tr key={p.sourceLineId}><Cell>{p.sourceLabel}</Cell><Cell>{p.document}<span className="block text-xs text-text-muted">{dateLabel(p.date)}</span></Cell><Cell>{p.description}</Cell><Cell>{p.supplier}</Cell>
            <Cell numeric>{p.quantity}</Cell><Cell numeric>{p.registered}</Cell><Cell numeric>{p.available}</Cell>{o.can.cost && <Cell numeric>{money(p.proposedUnitCost ?? null)}</Cell>}
            <Cell>{o.can.register && (p.sourceType === "SUPPLIER_INVOICE_LINE" && p.documentId ? <Link className="text-sm text-brand hover:underline" href={`/assets/capitalization/invoices/${p.documentId}`}>Create assets</Link>
              : <Link className="text-sm text-brand hover:underline" href={`${REGISTER_BASE}/from-purchase?search=${encodeURIComponent(p.document)}`}>Register</Link>)}</Cell></tr>)}
        </LinesTable>
      ))}
      {view === "invoices" && <InvoicesPanel />}
      {view === "batches" && <BatchesPanel />}
      {view === "pending" && (pending.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["Asset", "Category", "Status", ...(o.can.cost ? [{ label: "Proposed cost", numeric: true }] : []), "Before capitalization", ""]} empty={(pending.data ?? []).length ? undefined : "No registered asset waits for capitalization."}>
          {(pending.data ?? []).map((r) => <tr key={r.assetId}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link></Cell><Cell>{r.category}</Cell><Cell>{r.lifecycle === "ACTIVE" ? "Commissioned" : "Registered"}</Cell>
            {o.can.cost && <Cell numeric>{amount(r.total)}</Cell>}<Cell>{r.ready ? <StatusBadge tone="success">Ready to request</StatusBadge> : <span className="text-xs text-warning">{r.issues.join(" ")}</span>}</Cell>
            <Cell>{o.can.request && r.ready && <Button size="compact" variant="ghost" onPress={() => setAsk(requestFor(r))}>Request</Button>}</Cell></tr>)}
        </LinesTable>
      ))}
      {view === "review" && <>
        <Panel title="Waiting for Finance">{requests.isLoading ? <LoadingState label="Loading" rows={2} /> : <CapTable rows={requests.data ?? []} empty="Nothing waits for review." />}</Panel>
        <Panel title="Approved — to post">{approved.isLoading ? <LoadingState label="Loading" rows={2} /> : <CapTable rows={approved.data ?? []} empty="Nothing waits to be posted." />}</Panel>
      </>}
      {view === "capitalized" && (requests.isLoading ? <LoadingState label="Loading" rows={3} /> : <CapTable rows={requests.data ?? []} empty="Nothing capitalized yet." />)}
      {view === "cwip" && (cwip.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["CWIP", "Name", "Status", ...(o.can.cost ? [{ label: "Balance", numeric: true }, { label: "Transferred", numeric: true }] : []), "Finance", { label: "Age (days)", numeric: true }]}
          empty={(cwip.data ?? []).length ? undefined : "No capital work in progress."}>
          {(cwip.data ?? []).map((p) => <tr key={p.id}><Cell><Link className="text-brand hover:underline" href={p.href}>{p.number}</Link></Cell><Cell>{p.name}</Cell><Cell>{p.statusLabel}</Cell>
            {o.can.cost && <><Cell numeric>{money(p.balance ?? null)}</Cell><Cell numeric>{money(p.transferred ?? null)}</Cell></>}<Cell>{p.capitalization ?? "Not requested"}</Cell><Cell numeric>{p.ageDays}</Cell></tr>)}
        </LinesTable>
      ))}
      {view === "adjustments" && (adjustments.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["Adjustment", "Asset", "Kind", { label: "Amount", numeric: true }, "Status", "Reason", ""]} empty={(adjustments.data ?? []).length ? undefined : "No adjustments."}>
          {(adjustments.data ?? []).map((d) => <tr key={d.id}><Cell>{d.number}</Cell><Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${d.assetId}?tab=financials`}>{d.asset}</Link></Cell><Cell>{d.kindLabel}</Cell>
            <Cell numeric>{amount(d.amount)}</Cell><Cell>{d.statusLabel}</Cell><Cell>{d.reason}{d.evidence && <span className="block text-xs text-text-muted">{d.evidence}</span>}</Cell>
            <Cell>{d.canDecide && <span className="flex gap-1">
              <Button size="compact" variant="primary" onPress={() => setAsk({ title: `Post ${d.number}`, confirm: "Post", fields: [{ name: "note", label: "Note", kind: "textarea" }], description: "The asset's cost changes by this amount; the journal moves it between the fixed-asset account and the source's account, and the remaining depreciation is recalculated.",
                run: async (v) => { await capAction("adjustment-decide", { adjustmentId: d.id, decision: "POST", note: v.note || undefined }); await refresh(`${d.number} posted.`); } })}>Post</Button>
              <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Reject ${d.number}`, confirm: "Reject", tone: "danger", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
                run: async (v) => { await capAction("adjustment-decide", { adjustmentId: d.id, decision: "REJECT", note: v.note }); await refresh(`${d.number} rejected.`); } })}>Reject</Button></span>}</Cell></tr>)}
        </LinesTable>
      ))}
      {view === "reconciliation" && (recon.isLoading ? <LoadingState label="Loading" rows={3} /> : recon.isError || !recon.data ? <Notice tone="warning">{errorMessage(recon.error)}</Notice> : (
        <div className="flex flex-col gap-4">
          <Notice tone="info">{recon.data.note}</Notice>
          <FactList columns={3} items={[["Approved, not posted", String(recon.data.capitalizations.approvedNotPosted)], ["Posted", String(recon.data.capitalizations.posted)],
            ["Posted without a journal", String(recon.data.capitalizations.postedWithoutJournal)], ...(recon.data.capitalizations.capitalizedValue !== undefined ? [["Capitalized value", money(recon.data.capitalizations.capitalizedValue ?? null)]] as Array<[string, ReactNode]> : [])]} />
          <LinesTable columns={["Source", "Description", { label: "Units", numeric: true }, { label: "Registered", numeric: true }, { label: "Remaining", numeric: true }, ...(o.can.cost ? [{ label: "Value", numeric: true }, { label: "Allocated", numeric: true }, { label: "Unallocated", numeric: true }] : []), ""]}
            empty={recon.data.lines.length ? undefined : "No source line is used yet."}>
            {recon.data.lines.map((l) => <tr key={l.sourceLineId}><Cell>{l.document}<span className="block text-xs text-text-muted">{l.kind}</span></Cell><Cell>{l.description}</Cell><Cell numeric>{l.quantity}</Cell><Cell numeric>{l.registered}</Cell>
              <Cell numeric>{l.remainingUnits ?? ""}</Cell>{o.can.cost && <><Cell numeric>{money(l.value ?? null)}</Cell><Cell numeric>{money(l.allocated ?? null)}</Cell><Cell numeric>{money(l.remainingValue ?? null)}</Cell></>}
              <Cell>{l.overAllocated ? <StatusBadge tone="danger">Over-allocated</StatusBadge> : l.fullyRegistered ? <StatusBadge tone="success">Fully registered</StatusBadge> : null}</Cell></tr>)}
          </LinesTable>
        </div>
      ))}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {allocate && <AllocateDialog onClose={() => setAllocate(false)} onDone={async (t) => { setAllocate(false); await refresh(t); }} />}
    </div>
  );
}
function OverviewTab({ overview: o }: { overview: Overview }) {
  const workspace = useWorkspaceContext();
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "capitalization", "exceptions"), queryFn: getExceptions, retry: false });
  const kinds = CAP_REPORT_KINDS.filter((x) => !x.cost || o.can.cost);
  const [kind, setKind] = useState(kinds[0]?.id ?? "purchases-pending-registration");
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "capitalization", "report", kind), queryFn: () => getCapReport(kind), retry: false });
  const rows = report.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => x !== "href") : [];
  return (
    <div className="flex flex-col gap-4">
      <FactList columns={3} items={[["Units to register", String(o.counts.toRegister)], ["Registered, cost pending", String(o.counts.costPending)], ["Waiting for Finance", String(o.counts.pendingReview)],
        ["Approved, to post", String(o.counts.toPost)], ["Capitalized this month", String(o.counts.capitalizedThisMonth)], ["CWIP projects open", String(o.counts.cwipOpen)],
        ["Adjustments to decide", String(o.counts.adjustmentsPending)], ["Exceptions", String(o.counts.exceptions)], ...(o.cwipBalance !== null ? [["CWIP balance", money(o.cwipBalance)]] as Array<[string, ReactNode]> : [])]} />
      <Panel title="Exceptions">
        {exceptions.isLoading ? <LoadingState label="Loading" rows={2} /> : (
          <LinesTable columns={["Exception", "About"]} empty={(exceptions.data ?? []).length ? undefined : "No acquisition exceptions."}>
            {(exceptions.data ?? []).map((e, i) => <tr key={i}><Cell>{e.label}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.subject}</Link></Cell></tr>)}
          </LinesTable>
        )}
      </Panel>
      <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={kinds.map((x) => ({ value: x.id, label: x.label }))} />}>
        {report.isLoading ? <LoadingState label="Loading" rows={3} /> : report.isError ? <Notice tone="warning">{errorMessage(report.error)}</Notice> : (
          <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
            {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{String(r[x] ?? "")}</Link> : String(r[x] ?? "")}</Cell>)}</tr>)}
          </LinesTable>
        )}
      </Panel>
    </div>
  );
}
// One source amount shared by assets (or added to a CWIP project): freight, installation, testing, other direct cost, or the line's
// nonrecoverable tax — equally, in proportion to purchase value, or by amount. The backend refuses anything above what the line has left.
function AllocateDialog({ cwipId, onClose, onDone }: { cwipId?: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const sources = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "capitalization", "cost-sources", search), queryFn: () => getCostSources(search), retry: false });
  const pending = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "capitalization", "pending"), queryFn: getCostPending, retry: false, enabled: !cwipId });
  const [line, setLine] = useState("");
  const [component, setComponent] = useState(cwipId ? "PURCHASE_PRICE" : "FREIGHT");
  const [method, setMethod] = useState("EQUAL");
  const [value, setValue] = useState("");
  const [assets, setAssets] = useState<string[]>([]);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = (sources.data ?? []).find((s) => s.sourceLineId === line);
  const left = src ? (component === "NONRECOVERABLE_TAX" ? src.taxRemaining : src.remaining) : null;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await capAction("allocate", { sourceType: "SUPPLIER_INVOICE_LINE", sourceLineId: line, component, method: cwipId ? "EQUAL" : method, amount: value || undefined, ...(cwipId ? { cwipId } : { assetIds: assets }), commandId: key });
      await onDone("Cost allocated.");
    } catch (f) { setError(errorMessage(f)); setBusy(false); }
  };
  const components = cwipId ? [{ value: "PURCHASE_PRICE", label: "Purchase price" }, ...COMPONENT_OPTIONS] : COMPONENT_OPTIONS;
  return (
    <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) onClose(); }} title={cwipId ? "Add a cost to CWIP" : "Allocate a cost to assets"} size="lg"
      description="Recoverable GST is never capitalized: only a line's nonrecoverable tax is allocated, as Finance decides. A source amount is allocated once.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Find the supplier bill line" value={search} onChange={setSearch} placeholder="Bill number, description or supplier" />
        <Select label="Source line" selectedKey={line || null} onSelectionChange={(x) => setLine(String(x ?? ""))} isRequired
          options={(sources.data ?? []).map((s) => ({ value: s.sourceLineId, label: `${s.document} · ${s.description} — ${money(s.remaining)} left${Number(s.taxRemaining) > 0 ? `, tax ${money(s.taxRemaining)}` : ""}${s.posted ? "" : " (not posted yet)"}` }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="What it is" selectedKey={component} onSelectionChange={(x) => setComponent(String(x))} options={components} />
          <TextField label={`Amount${left ? ` (up to ${money(left)})` : ""}`} inputMode="decimal" value={value} onChange={setValue} description="Blank allocates what is left." />
        </div>
        {!cwipId && <>
          <Select label="Share it" selectedKey={method} onSelectionChange={(x) => setMethod(String(x))} options={[{ value: "EQUAL", label: "Equally per asset" }, { value: "PROPORTIONAL", label: "In proportion to purchase value" }]} />
          <div className="max-h-56 overflow-y-auto rounded border border-border p-2">
            {(pending.data ?? []).map((r) => <Checkbox key={r.assetId} isSelected={assets.includes(r.assetId)} onChange={(on) => setAssets((list) => (on ? [...list, r.assetId] : list.filter((x) => x !== r.assetId)))}>{r.asset}</Checkbox>)}
            {!(pending.data ?? []).length && <p className="text-sm text-text-muted">No uncapitalized assets.</p>}
          </div>
        </>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !line || (!cwipId && !assets.length)} onPress={save}>Allocate</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ one request
export function CapitalizationRequestScreen({ capId }: { capId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "capitalization", "request", capId), queryFn: () => getCapitalization(capId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isLoading) return <LoadingState label="Loading" rows={5} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see this capitalization" description="It needs an acquisition permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const r = q.data;
  const done = async (text: string) => { setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const approve = (): Ask => ({ title: `Approve ${r.number}`, confirm: "Approve", description: "You confirm the cost components, the tax treatment, the accounts and the accounting date. Posting is a separate step.",
    fields: [{ name: "treatment", label: "Treatment", kind: "select", required: true, initial: r.cwipId ? "CWIP" : "CAPITALIZE",
      options: r.cwipId ? [{ value: "CWIP", label: "Capital work in progress" }] : [{ value: "CAPITALIZE", label: "Capitalize as a fixed asset" }, { value: "TRACKED_EXPENSED", label: "Expense it (tracked only)" }, { value: "NOT_ELIGIBLE", label: "Not eligible" }] },
      ...(r.taxReview ? [{ name: "taxReviewed", label: "I have verified the purchase tax treatment", kind: "checkbox" as const }] : []),
      ...(r.assetId ? [{ name: "depreciationStartDate", label: "Depreciation starts (blank: when it is ready for use)", kind: "date" as const }] : []), { name: "note", label: "Note", kind: "textarea" }],
    run: async (v) => { await requestAction(r.id, "approve", { ...v, taxReviewed: v.taxReviewed === true, depreciationStartDate: v.depreciationStartDate || undefined, expectedVersion: r.version }); await done("Decision recorded."); } });
  const post = (): Ask => {
    const key = newKey();
    return { title: `Post ${r.number}`, confirm: "Post", description: r.journal.length ? "Finance's journal moves the cost from the account the bill put it in to the fixed-asset account. The supplier liability is never created again." : "The cost is already in the fixed-asset account; this records the capitalization without a new journal.",
      fields: [], run: async () => { await requestAction(r.id, "post", { postingKey: key }); await done("Posted."); } };
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${r.number} · ${r.target}`} description={`${r.treatmentLabel}. Requested ${formatDateTime(r.requestedAt)}${r.requestedBy ? ` by ${r.requestedBy}` : ""}.`}
        primaryAction={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={CAP_TONE[r.status]}>{r.statusLabel}</StatusBadge>
          {r.can.approve && <Button variant="primary" onPress={() => setAsk(approve())}>Decide</Button>}
          {r.can.sendBack && <Button variant="secondary" onPress={() => setAsk({ title: "Send back for changes", confirm: "Send back", fields: [{ name: "note", label: "What needs correcting", kind: "textarea", required: true }],
            run: async (v) => { await requestAction(r.id, "send-back", { note: v.note, expectedVersion: r.version }); await done("Sent back."); } })}>Send back</Button>}
          {r.can.resubmit && <Button variant="primary" onPress={() => setAsk({ title: "Resubmit", confirm: "Resubmit", description: "The proposal is recalculated from the corrected sources.", fields: [{ name: "note", label: "What changed", kind: "textarea" }],
            run: async (v) => { await requestAction(r.id, "resubmit", v); await done("Resubmitted."); } })}>Resubmit</Button>}
          {r.can.post && <Button variant="primary" onPress={() => setAsk(post())}>Post</Button>}
          {r.can.recover && <Button variant="secondary" onPress={() => requestAction(r.id, "recover").then(() => done("Posting outcome checked."))}>Check the posting</Button>}
          {r.can.reject && <Button variant="ghost" onPress={() => setAsk({ title: "Reject", confirm: "Reject", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
            run: async (v) => { await requestAction(r.id, "reject", v); await done("Rejected."); } })}>Reject</Button>}
          {r.can.reverse && <Button variant="ghost" onPress={() => setAsk({ title: "Reverse the capitalization", confirm: "Reverse", tone: "danger", description: "Finance reverses the journal; the costs return to the asset to be capitalized again correctly.",
            fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }], run: async (v) => { await requestAction(r.id, "reverse", v); await done("Reversed."); } })}>Reverse</Button>}
        </span>} />
      {message && <Notice tone="success">{message}</Notice>}
      {r.taxReview && r.status === "PENDING_REVIEW" && <Notice tone="warning">The purchase tax credit is pending or ineligible in Finance: verify the tax treatment before approving. Recoverable GST is never capitalized.</Notice>}
      {r.reviewNote && <Notice tone="info">{`Finance: ${r.reviewNote}`}</Notice>}
      {r.rejectionReason && <Notice tone="warning">{`Rejected: ${r.rejectionReason}`}</Notice>}
      <FactList columns={3} items={[["Amount", amount(r.total)], ["Accounting date", dateLabel(r.capitalizationDate)], ["Available for use", dateLabel(r.availableForUseDate)], ["Depreciation starts", r.depreciationStartDate ? dateLabel(r.depreciationStartDate) : "When Finance sets it"],
        ["Fixed-asset account", r.debitAccount ?? "—"], ["Approved", r.approvedBy ? `${r.approvedBy}, ${formatDateTime(r.approvedAt)}` : "—"], ["Posted", r.postedAt ? `${r.postedBy ?? ""}, ${formatDateTime(r.postedAt)}` : "—"],
        ["Finance outcome", r.outcome === "ALREADY_IN_ASSET_ACCOUNT" ? "Already in the fixed-asset account" : r.outcome === "NOT_REQUIRED" ? "Expensed — nothing posted" : r.journalEntryId ? "Journal posted" : "—"]]} />
      {r.components.length > 0 && <Panel title="Cost components">
        <LinesTable columns={["Component", "Source", "From account", { label: "Amount", numeric: true }, { label: "In base currency", numeric: true }]}>
          {r.components.map((x) => <tr key={x.id}><Cell>{x.label}</Cell><Cell>{x.source}</Cell><Cell>{x.account}</Cell><Cell numeric>{money(x.amount, x.currency)}</Cell><Cell numeric>{money(x.reporting)}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {r.journal.length > 0 && <Panel title="Journal" description="A reclassification: the supplier bill already recorded the liability.">
        <LinesTable columns={["Account", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }]}>
          {r.journal.map((l, i) => <tr key={i}><Cell>{l.account}</Cell><Cell numeric>{Number(l.debit) ? money(l.debit) : ""}</Cell><Cell numeric>{Number(l.credit) ? money(l.credit) : ""}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      <Panel title="History">
        <LinesTable columns={["When", "What", "By", "Reason"]} empty={r.events.length ? undefined : "Nothing yet."}>
          {r.events.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase().replace(/^./, (y) => y.toUpperCase())}</Cell><Cell>{e.by}</Cell><Cell>{e.reason}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ one CWIP project
export function CwipScreen({ cwipId }: { cwipId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "capitalization", "cwip", cwipId), queryFn: () => getCwip(cwipId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isLoading) return <LoadingState label="Loading" rows={5} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const p = q.data;
  const done = async (text: string) => { setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const transfer = (): Ask => ({ title: "Transfer to assets", confirm: "Transfer", description: "Each asset must be commissioned. The remaining balance is shared equally; the assets are then capitalized from it — a transfer, never a new purchase.",
    fields: [{ name: "codes", label: "Asset codes (one per line)", kind: "textarea", required: true }],
    run: async (v) => {
      const codes = String(v.codes).split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
      const ids: string[] = [];
      for (const code of codes) { const hit = await lookup(code); if (hit.assetId) ids.push(hit.assetId); else throw new Error(hit.message ?? `${code} was not found.`); }
      await cwipAction(p.id, "transfer", { assetIds: ids, commandId: newKey() }); await done("Transferred.");
    } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${p.number} · ${p.name}`} description={p.description ?? "Capital work in progress: cost waiting for the assets it becomes."}
        primaryAction={<span className="flex flex-wrap items-center gap-2"><StatusBadge tone={p.status === "TRANSFERRED" ? "success" : p.status === "READY" ? "info" : "warning"}>{p.statusLabel}</StatusBadge>
          {p.can.addCost && <Button variant="secondary" onPress={() => setAdding(true)}>Add a cost</Button>}
          {p.can.request && <Button variant="secondary" onPress={() => setAsk({ title: "Request posting to CWIP", confirm: "Submit to Finance", fields: [{ name: "capitalizationDate", label: "Accounting date", kind: "date", required: true }, { name: "note", label: "Note", kind: "textarea" }],
            description: "Finance moves the accumulated costs into the CWIP account. No depreciation starts.", run: async (v) => { await capAction("request", { cwipId: p.id, ...v }); await done("Sent to Finance."); } })}>Request posting</Button>}
          {p.can.ready && <Button variant="secondary" onPress={() => setAsk({ title: "Ready for use", confirm: "Record", fields: [{ name: "readyAt", label: "Ready on", kind: "date", required: true }, { name: "evidence", label: "Commissioning evidence", kind: "textarea", required: true }],
            run: async (v) => { await cwipAction(p.id, "ready", v); await done("Recorded as ready for use."); } })}>Mark ready</Button>}
          {p.can.transfer && <Button variant="primary" onPress={() => setAsk(transfer())}>Transfer to assets</Button>}
          <Link className="text-sm text-brand hover:underline" href={`${CAP_BASE}?view=cwip`}>All CWIP</Link></span>} />
      {message && <Notice tone="success">{message}</Notice>}
      <FactList columns={3} items={[["Balance", amount(p.balance)], ["Transferred", amount(p.transferred)], ["Still to transfer", amount(p.remaining)], ["CWIP account", p.account ?? "Not set"], ["Category", p.category ?? "—"],
        ["Ready for use", p.readyAt ? `${dateLabel(p.readyAt)}${p.readyEvidence ? ` — ${p.readyEvidence}` : ""}` : "Not yet"]]} />
      <Panel title="Costs">
        <LinesTable columns={["Component", "Source", { label: "Amount", numeric: true }, "Status"]} empty={p.costs.length ? undefined : "No costs yet."}>
          {p.costs.map((x) => <tr key={x.id}><Cell>{x.label}</Cell><Cell>{x.source}</Cell><Cell numeric>{money(x.reporting)}</Cell><Cell>{x.status === "REVERSED" ? "Reversed" : x.capitalized ? "Posted to CWIP" : "Accumulated"}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Finance"><CapTable rows={p.capitalizations} empty="Not requested yet." /></Panel>
      <Panel title="Transferred to">
        <LinesTable columns={["Asset", { label: "Amount", numeric: true }]} empty={p.transfers.length ? undefined : "Nothing transferred yet."}>
          {p.transfers.map((t) => <tr key={t.id}><Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${t.assetId}?tab=financials`}>{t.asset}</Link></Cell><Cell numeric>{amount(t.amount)}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {adding && <AllocateDialog cwipId={p.id} onClose={() => setAdding(false)} onDone={async (t) => { setAdding(false); await done(t); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's capitalization (Financials tab)
export function AssetCapitalizationPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "capitalization"), queryFn: () => getAssetView<AssetCap>(assetId, "capitalization"), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isLoading || q.isError || !q.data || !q.data.visible) return null;
  const d = q.data;
  const done = async (text: string) => { setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const adjust = (): Ask => ({ title: "Request an adjustment", confirm: "Submit to Finance", description: "A supplier credit, an additional cost or a correction to the capitalized cost. Finance posts it; the original cost and its history stay.",
    fields: [{ name: "kind", label: "Kind", kind: "select", required: true, initial: "CREDIT_NOTE", options: [{ value: "CREDIT_NOTE", label: "Supplier credit note" }, { value: "ADDITIONAL_COST", label: "Additional cost (supplier bill)" }, { value: "CORRECTION", label: "Correction" }] },
      { name: "sourceLineId", label: "Credit-note or bill line id (credit / additional cost)", kind: "text" }, { name: "amount", label: "Amount (blank: what is left on the line; a correction may be negative)", kind: "text" },
      { name: "offsetAccountId", label: "Other account (correction only)", kind: "text" }, { name: "reason", label: "Reason", kind: "textarea", required: true }, { name: "evidence", label: "Evidence", kind: "text" }],
    run: async (v) => { await capAction("adjustment-request", { assetId, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "")), commandId: newKey() }); await done("Adjustment sent to Finance."); } });
  return (
    <Panel title="Capitalization" description={d.note}
      actions={<span className="flex flex-wrap gap-2">
        {d.can.request && d.proposal && !d.proposal.issues.length && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Request capitalization", confirm: "Submit to Finance",
          fields: [{ name: "capitalizationDate", label: "Accounting date", kind: "date", required: true }, { name: "availableForUseDate", label: "Available for use (if known)", kind: "date" }, { name: "note", label: "Note", kind: "textarea" }],
          run: async (v) => { await capAction("request", { assetId, ...v }); await done("Sent to Finance."); } })}>Request capitalization</Button>}
        {d.can.startDepreciation && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Start depreciation", confirm: "Set", fields: [{ name: "date", label: "Depreciation starts", kind: "date", required: true, initial: d.availableForUseDate ?? "" }],
          run: async (v) => { await capAction("depreciation-start", { assetId, date: v.date }); await done("Depreciation start set."); } })}>Start depreciation</Button>}
        {d.can.adjust && <Button size="compact" variant="secondary" onPress={() => setAsk(adjust())}>Adjust</Button>}
        {d.can.returnToSupplier && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Returned to the supplier", confirm: "Record return", tone: "danger", description: "The unit is released from its purchase line, its cost allocations are reversed and the asset is retired as returned.",
          fields: [{ name: "reason", label: "Return reference and reason", kind: "textarea", required: true }], run: async (v) => { await capAction("return", { assetId, reason: v.reason }); await done("Recorded as returned."); } })}>Returned to supplier</Button>}
      </span>}>
      {message && <Notice tone="success">{message}</Notice>}
      <FactList columns={3} items={[["Status", d.capitalizationClass === "CAPITALIZED" ? "Capitalized" : d.capitalizationClass === "TRACKED_ONLY" ? "Tracked only (expensed)" : "Not capitalized yet"],
        ["Capitalized cost", d.capitalizedCost ? money(d.capitalizedCost) : "—"], ["Capitalization date", dateLabel(d.capitalizationDate)], ["Available for use", dateLabel(d.availableForUseDate)], ["Depreciation starts", d.depreciationStartDate ? dateLabel(d.depreciationStartDate) : "Not set"]]} />
      {d.proposal && <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{`Proposed: ${money(d.proposal.total)}`}</p>
        {d.proposal.issues.map((x, i) => <Notice key={i} tone="warning">{x.message}</Notice>)}
        {d.proposal.taxReview && <Notice tone="info">Finance will verify the purchase tax treatment.</Notice>}
      </div>}
      {d.components.length > 0 && <LinesTable columns={["Cost", "Source", "Method", { label: "Amount", numeric: true }, "Status"]}>
        {d.components.map((x) => <tr key={x.id}><Cell>{x.label}</Cell><Cell>{x.source}</Cell><Cell>{x.method.toLowerCase()}</Cell><Cell numeric>{money(x.reporting)}</Cell><Cell>{x.status === "REVERSED" ? "Reversed" : x.capitalized ? "Capitalized" : "Allocated"}</Cell></tr>)}
      </LinesTable>}
      {d.requests.length > 0 && <CapTable rows={d.requests} empty="" />}
      {d.adjustments.length > 0 && <LinesTable columns={["Adjustment", "Kind", { label: "Amount", numeric: true }, "Status", "Reason"]}>
        {d.adjustments.map((x) => <tr key={x.id}><Cell>{x.number}</Cell><Cell>{x.kindLabel}</Cell><Cell numeric>{money(x.amount)}</Cell><Cell>{x.statusLabel}</Cell><Cell>{x.reason}</Cell></tr>)}
      </LinesTable>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}
