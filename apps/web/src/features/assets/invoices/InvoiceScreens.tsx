"use client";

// Assets — Create Assets From Invoice. A supplier invoice already knows the supplier, the line, the quantity and the price; the person adds
// only what the invoice cannot know — the category, each unit's serial, where it is kept and who is responsible. Each line shows what was
// invoiced, received, already registered and still registerable; one request registers the units (each its own asset, the invoice line
// its source), never twice, and can hand them to Finance for capitalization. Nothing is posted.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, LinkButton, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { dateLabel, errorMessage, errorStatus, getOptions, money, newKey } from "../register/register-api";
import {
  INVOICES_BASE, OUTCOME_TONE, batchExportHref, createRegistration, getBatch, getBatches, getEligibleInvoices, getInvoiceSource, previewRegistration, type InvoiceLine, type InvoiceSource, type Preview,
} from "./invoice-api";

// ------------------------------------------------------------------ lists (tabs of Purchases & Capitalization)
export function InvoicesPanel() {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "invoices", search), queryFn: () => getEligibleInvoices(search), retry: false });
  return (
    <div className="flex flex-col gap-3">
      <TextField label="Find an invoice" value={search} onChange={setSearch} placeholder="Bill number, supplier invoice or supplier" />
      {q.isLoading ? <LoadingState label="Loading invoices" rows={3} /> : q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={["Invoice", "Supplier", "Date", { label: "Invoiced", numeric: true }, { label: "Registered", numeric: true }, { label: "To register", numeric: true }, ""]}
          empty={(q.data ?? []).length ? undefined : "No invoice has assets left to register."}>
          {(q.data ?? []).map((r) => <tr key={r.invoiceId}><Cell>{r.number}{r.supplierInvoice && <span className="block text-xs text-text-muted">{r.supplierInvoice}</span>}</Cell><Cell>{r.supplier}</Cell><Cell>{dateLabel(r.date)}</Cell>
            <Cell numeric>{r.quantity}</Cell><Cell numeric>{r.registered}</Cell><Cell numeric>{r.remaining}</Cell><Cell><Link className="text-sm text-brand hover:underline" href={r.href}>Create assets</Link></Cell></tr>)}
        </LinesTable>
      )}
    </div>
  );
}
export function BatchesPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "invoice-batches"), queryFn: getBatches, retry: false });
  if (q.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (q.isError) return <Notice tone="warning">{errorMessage(q.error)}</Notice>;
  return (
    <LinesTable columns={["Registration", "Invoice", "Status", { label: "Assets", numeric: true }, { label: "Lines not registered", numeric: true }, "By", "When"]} empty={(q.data ?? []).length ? undefined : "No registrations yet."}>
      {(q.data ?? []).map((b) => <tr key={b.id}><Cell><Link className="text-brand hover:underline" href={b.href}>{b.number}</Link></Cell><Cell>{b.invoice}</Cell>
        <Cell><StatusBadge tone={b.status === "COMPLETED" ? "success" : b.status === "PARTIAL" ? "warning" : b.status === "FAILED" ? "danger" : "info"}>{b.statusLabel}</StatusBadge></Cell>
        <Cell numeric>{b.assetsCreated}</Cell><Cell numeric>{b.failedLines}</Cell><Cell>{b.requestedBy}</Cell><Cell>{formatDateTime(b.at)}</Cell></tr>)}
    </LinesTable>
  );
}

// ------------------------------------------------------------------ one invoice
export function InvoiceSourceScreen({ invoiceId }: { invoiceId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "invoice", invoiceId), queryFn: () => getInvoiceSource(invoiceId), retry: false });
  const [line, setLine] = useState<InvoiceLine | null>(null);
  if (q.isLoading) return <LoadingState label="Loading the invoice" rows={5} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You can't create assets from invoices" description="It needs an invoice-source permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Create assets from ${d.number}`} description={d.note}
        primaryAction={<span className="flex flex-wrap items-center gap-2"><Link className="text-sm text-brand hover:underline" href={d.billHref}>Open the supplier bill</Link>
          <Link className="text-sm text-brand hover:underline" href="/assets/capitalization?view=invoices">All invoices</Link></span>} />
      {d.block && <Notice tone="warning">{d.block}</Notice>}
      <FactList columns={3} items={[["Supplier", d.supplier ?? "—"], ["Supplier invoice", d.supplierInvoice ?? "—"], ["Invoice date", dateLabel(d.date)], ["Status", d.status.replace(/_/g, " ")],
        ["Currency", d.currency], ...(d.can.cost ? [["Total", money(d.total ?? null, d.currency)], ["Tax", money(d.tax ?? null, d.currency)]] as Array<[string, string]> : [])]} />
      <Panel title="Invoice lines">
        <LinesTable columns={["Line", "Kind", { label: "Invoiced", numeric: true }, { label: "Received", numeric: true }, { label: "Registered", numeric: true }, { label: "Can register", numeric: true }, ...(d.can.cost ? [{ label: "Net per unit", numeric: true }] : []), ""]}>
          {d.lines.map((l) => <tr key={l.sourceLineId}><Cell>{l.description}{l.purchaseOrder && <span className="block text-xs text-text-muted">{`${l.purchaseOrder.number}, line ${l.purchaseOrder.line}`}</span>}</Cell><Cell>{l.kindLabel}</Cell>
            <Cell numeric>{`${l.invoiced}${l.uom ? ` ${l.uom}` : ""}`}</Cell><Cell numeric>{l.receiptRequired ? String(l.received ?? 0) : "Direct"}</Cell><Cell numeric>{l.registered}</Cell><Cell numeric>{l.remaining}</Cell>
            {d.can.cost && <Cell numeric>{money(l.unitNet ?? null, d.currency)}</Cell>}
            <Cell>{l.eligible && d.can.create ? <Button size="compact" variant={l.suggested ? "primary" : "ghost"} onPress={() => setLine(l)}>Create assets</Button> : l.serviceReview && d.can.create && !d.block ? <Button size="compact" variant="ghost" onPress={() => setLine(l)}>Review as asset</Button>
              : <span className="text-xs text-text-muted">{l.reason}</span>}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Assets from this invoice" description="Registered from its lines, or from the receipt of the same purchase order lines.">
        <LinesTable columns={["Asset", "Serial", "Line", "Through", ...(d.can.cost ? [{ label: "Purchase price", numeric: true }] : []), "Acquisition"]} empty={d.assets.length ? undefined : "No assets yet."}>
          {d.assets.map((a) => <tr key={a.assetId}><Cell><Link className="text-brand hover:underline" href={a.href}>{a.asset}</Link></Cell><Cell>{a.serialNumber}</Cell><Cell>{a.line}</Cell><Cell>{a.via}</Cell>
            {d.can.cost && <Cell numeric>{money(a.cost ?? null, d.currency)}</Cell>}<Cell><StatusBadge tone={OUTCOME_TONE[a.outcome]}>{a.outcomeLabel}</StatusBadge></Cell></tr>)}
        </LinesTable>
      </Panel>
      {d.batches.length > 0 && <Panel title="Registrations">
        <LinesTable columns={["Registration", "Status", { label: "Assets", numeric: true }, "When"]}>
          {d.batches.map((b) => <tr key={b.id}><Cell><Link className="text-brand hover:underline" href={b.href}>{b.number}</Link></Cell><Cell>{b.statusLabel}</Cell><Cell numeric>{b.assetsCreated}</Cell><Cell>{formatDateTime(b.at)}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {line && <CreateAssetsDialog invoice={d} line={line} onClose={() => setLine(null)} />}
    </div>
  );
}
// The wizard: how many, what kind, where kept, who is responsible, the serials — then the server's review, then create.
function CreateAssetsDialog({ invoice, line, onClose }: { invoice: InvoiceSource; line: InvoiceLine; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [f, setF] = useState({ quantity: String(Math.min(line.remaining, invoice.can.bulk ? line.remaining : 1)), categoryId: "", name: line.description, manufacturer: "", model: "", tracking: "PENDING",
    locationId: "", custodianUserId: "", departmentId: "", serials: "", unitsPerQuantity: "1", eligibilityReason: "", receiptEvidence: "", commission: false, readyOn: "", request: invoice.can.requestCapitalization, capDate: "" });
  const [key] = useState(newKey);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF({ ...f, [k]: v }); setPreview(null); };
  const serials = f.serials.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const qty = Number(f.quantity) || 0;
  const lineInput = () => ({ sourceLineId: line.sourceLineId, quantity: qty, categoryId: f.categoryId, name: f.name, manufacturer: f.manufacturer || undefined, model: f.model || undefined, tracking: f.tracking,
    locationId: f.locationId || undefined, custodianUserId: f.custodianUserId || undefined, departmentId: f.departmentId || undefined, unitsPerQuantity: Number(f.unitsPerQuantity) || 1,
    eligibilityReason: f.eligibilityReason || undefined, receiptEvidence: f.receiptEvidence || undefined, units: serials.length ? serials.map((serialNumber) => ({ serialNumber })) : undefined });
  const review = async () => {
    setBusy(true); setError(null);
    try { setPreview(await previewRegistration({ invoiceId: invoice.invoiceId, lines: [lineInput()] })); } catch (x) { setError(errorMessage(x)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await createRegistration({ invoiceId: invoice.invoiceId, idempotencyKey: key, lines: [lineInput()], commission: f.commission && f.readyOn ? { availableForUseDate: f.readyOn } : undefined,
        requestCapitalization: f.request, capitalizationDate: f.capDate || undefined });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
      router.push(`/assets/capitalization/registrations/${r.batchId}`);
    } catch (x) { setError(errorMessage(x)); setBusy(false); }
  };
  const o = options.data;
  const opt = (rows: Array<{ id: string; name: string; code?: string }> | undefined) => [{ value: "", label: "—" }, ...(rows ?? []).map((r) => ({ value: r.id, label: r.code ? `${r.code} · ${r.name}` : r.name }))];
  const p = preview?.lines[0];
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Create assets — ${line.description}`} size="lg"
      description={`${invoice.number}: ${line.invoiced} invoiced, ${line.receiptRequired ? `${line.received ?? 0} received, ` : ""}${line.registered} registered, ${line.remaining} can be registered.`}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="How many items do you want to register?" inputMode="numeric" value={f.quantity} onChange={set("quantity")} isRequired />
          <Select label="What type of assets are these?" selectedKey={f.categoryId || null} onSelectionChange={(k) => set("categoryId")(String(k ?? ""))} options={(o?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} isRequired />
          <TextField label="Asset name" value={f.name} onChange={set("name")} />
          <Select label="Tracking" selectedKey={f.tracking} onSelectionChange={(k) => set("tracking")(String(k))} options={[{ value: "PENDING", label: "Fixed asset — Finance to capitalize" }, { value: "TRACKED_ONLY", label: "Tracked only (expensed)" }]} />
          <TextField label="Manufacturer" value={f.manufacturer} onChange={set("manufacturer")} />
          <TextField label="Model" value={f.model} onChange={set("model")} />
          <Select label="Where will they be kept?" selectedKey={f.locationId || ""} onSelectionChange={(k) => set("locationId")(String(k ?? ""))} options={opt(o?.locations)} />
          <Select label="Who is responsible for them?" selectedKey={f.custodianUserId || ""} onSelectionChange={(k) => set("custodianUserId")(String(k ?? ""))} options={[{ value: "", label: "The store (or nobody yet)" }, ...(o?.users ?? []).map((u) => ({ value: u.id, label: u.name }))]} />
          <Select label="Department" selectedKey={f.departmentId || ""} onSelectionChange={(k) => set("departmentId")(String(k ?? ""))} options={opt(o?.departments)} />
          <TextField label="Assets per invoice unit" inputMode="numeric" value={f.unitsPerQuantity} onChange={set("unitsPerQuantity")} description="1 unless one invoice unit is several assets (a pack)." />
        </div>
        <TextArea label="Serial numbers (one per line, when required)" value={f.serials} onChange={set("serials")} placeholder={"DL123ABC\nDL123ABD"} description={`${serials.length} of ${qty} entered. Serials come from the equipment, never invented.`} />
        {line.serviceReview && <TextField label="Why this service line is an identifiable asset" value={f.eligibilityReason} onChange={set("eligibilityReason")} isRequired />}
        {!line.receiptRequired && !line.purchaseOrder && <TextField label="Receipt evidence (who received it and when)" value={f.receiptEvidence} onChange={set("receiptEvidence")} isRequired />}
        <Checkbox isSelected={f.commission} onChange={set("commission")}>They are in use already (commission them)</Checkbox>
        {f.commission && <TextField label="Available for use on" type="date" value={f.readyOn} onChange={set("readyOn")} />}
        {invoice.can.requestCapitalization && f.tracking === "PENDING" && <Checkbox isSelected={f.request} onChange={set("request")}>Send them to Finance for capitalization</Checkbox>}
        {p && <div className="flex flex-col gap-2 rounded border border-border p-3">
          <p className="text-sm font-medium">{preview?.ready ? `Ready: ${p.quantity} asset(s); ${p.remainingAfter} left to register afterwards.` : "Needs attention before creating:"}</p>
          {p.errors.map((e, i) => <Notice key={`e${i}`} tone="danger">{e.message}</Notice>)}
          {p.warnings.map((w, i) => <p key={`w${i}`} className="text-xs text-text-muted">{w.message}</p>)}
          {p.unitCost !== undefined && <p className="text-xs">{`Finance review: ${money(p.unitCost, invoice.currency)} per asset (tax-exclusive), ${money(p.allocation ?? null, invoice.currency)} in all. Finance confirms the capitalized cost.`}</p>}
        </div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="secondary" isLoading={busy && !preview} isDisabled={busy || !qty || !f.categoryId} onPress={review}>Review</Button>
          <Button variant="primary" isLoading={busy && Boolean(preview)} isDisabled={busy || !preview?.ready} onPress={create}>Create assets</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ one registration batch
export function RegistrationBatchScreen({ batchId }: { batchId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "invoice-batch", batchId), queryFn: () => getBatch(batchId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading" rows={4} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const b = q.data;
  const failed = b.lines.filter((l) => l.status === "FAILED");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${b.number} · ${b.invoice}`} description={`${b.assetsCreated} asset(s) created ${formatDateTime(b.createdAt)}.`}
        primaryAction={<span className="flex flex-wrap items-center gap-2"><StatusBadge tone={b.status === "COMPLETED" ? "success" : b.status === "PARTIAL" ? "warning" : "danger"}>{b.statusLabel}</StatusBadge>
          <LinkButton size="compact" variant="secondary" href={b.invoiceHref}>Back to the invoice</LinkButton><Link className="text-sm text-brand hover:underline" href={batchExportHref(b.batchId)}>Export</Link></span>} />
      {b.status === "PARTIAL" && <Notice tone="warning">Some assets were created. Review the remaining items below and register them from the invoice when they are fixed.</Notice>}
      <Panel title="Assets created">
        <LinesTable columns={["Asset", "Serial", "Status", "Acquisition"]} empty={b.assetsNow.length ? undefined : "None."}>
          {b.assetsNow.map((a) => <tr key={a.assetId}><Cell><Link className="text-brand hover:underline" href={a.href}>{a.asset}</Link></Cell><Cell>{a.serialNumber}</Cell><Cell>{a.lifecycle.toLowerCase()}</Cell>
            <Cell><StatusBadge tone={OUTCOME_TONE[a.outcome]}>{a.outcomeLabel}</StatusBadge></Cell></tr>)}
        </LinesTable>
      </Panel>
      {failed.length > 0 && <Panel title="Not registered">
        <LinesTable columns={["Line", { label: "Requested", numeric: true }, "Why"]}>
          {failed.map((l) => <tr key={l.sourceLineId}><Cell>{l.description}</Cell><Cell numeric>{l.requested}</Cell><Cell>{l.errors.map((e) => e.message).join(" ")}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      <p className="text-xs text-text-muted"><Link className="text-brand hover:underline" href={INVOICES_BASE.replace("/invoices", "?view=invoices")}>Other invoices</Link></p>
    </div>
  );
}
