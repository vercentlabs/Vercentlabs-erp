"use client";

// One sales return: the header with its status and whether a credit note is
// owed, the actions open to the caller now (the server checks each again),
// then the overview, the items with their condition, the stock that came
// back, the credit / financial side, related documents, notes and files, and
// the history. Prices are never shown here: they belong to the invoice.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, FileMinus, Pencil, Upload } from "lucide-react";
import { Button, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, buttonVariants } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, statusLabel, statusTone } from "@/features/sales/shared/format";

import { getReturn, listReturnFiles, removeReturnFile, returnFileUrl, returnNotePdfUrl, uploadReturnFile, type ReturnDetail } from "../api/returns-api";
import { CancelReturnDialog, EditReturnDialog, ReceiveReturnDialog, ReturnCreditDialog, failureText } from "../components/ReturnDialogs";
import { ReturnCreditBadge, ReturnStatusBadge } from "../components/ReturnStatusBadge";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

const quantity = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const by = (at: string | null, name: string | null) => (at ? `${dateTime(at)}${name ? ` by ${name}` : ""}` : "—");
type DialogKind = "edit" | "receive" | "cancel" | "credit" | null;
const EVENT_LABELS: Record<string, string> = {
  "sales_return.created": "Return created", "sales_return.updated": "Draft changed", "sales_return.received": "Received into stock", "sales_return.cancelled": "Draft cancelled",
  "sales_return.credit_note_created": "Credit note created", "sales_return.file_added": "File added", "sales_return.file_removed": "File removed",
};
function eventDetail(metadata: Record<string, unknown> | null) {
  const m = metadata ?? {};
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  const lines = Array.isArray(m.lines) ? (m.lines as Array<Record<string, unknown>>).map((line) => `${line.item} × ${quantity(line.quantity as number)}${line.condition ? ` (${line.condition}${line.stock ? `, ${line.stock}` : ""})` : ""}`).join(", ") : null;
  const changes = Array.isArray(m.changes) ? (m.changes as Array<Record<string, unknown>>).map((change) => `${change.what}: ${change.from ?? "none"} → ${change.to ?? "none"}`).join("\n") : null;
  const notes = Array.isArray(m.creditNotes) ? (m.creditNotes as Array<Record<string, unknown>>).map((note) => String(note.creditNoteNumber)).join(", ") : null;
  return [text("deliveryNumber"), text("reason"), text("warehouse"), lines, changes, notes, text("fileName")].filter(Boolean).join(" · ");
}

export function ReturnDetailScreen({ returnId }: { returnId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "sales", "return", returnId);
  const query = useQuery({ queryKey: key, queryFn: () => getReturn(returnId).then((r) => r.salesReturn) });
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "returns") });
  };
  const done = (message?: string) => { setDialog(null); setNotice(message ?? null); refresh(); };

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to sales returns" description="Ask an administrator for the View sales returns permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Return not found" : "Could not load this return"} action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const salesReturn = detail.salesReturn;
  const actions = detail.actions;

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="info">{notice}</Notice>}
      {detail.draftWarnings.map((warning, index) => <Notice key={index} tone="warning">{warning.message}</Notice>)}
      {salesReturn.status === "cancelled" && <Notice tone="warning">This draft was cancelled {by(salesReturn.cancelled_at, salesReturn.cancelled_by_name)}. Nothing came back into stock.</Notice>}
      {salesReturn.creditStatus === "awaiting" && <Notice tone="info">Part of what came back had been invoiced: a credit note against the original invoice is owed.</Notice>}

      <RecordDetailsPage
        header={{
          title: salesReturn.return_number,
          status: <span className="flex flex-wrap items-center gap-1.5"><ReturnStatusBadge status={salesReturn.status} label={salesReturn.statusLabel} /><ReturnCreditBadge status={salesReturn.creditStatus} label={salesReturn.creditStatusLabel} /></span>,
          fields: [
            { label: "Customer", value: <Link className="hover:underline" href={`/sales/customers/${salesReturn.party_id}`}>{salesReturn.customer_snapshot?.displayName ?? "—"}</Link> },
            { label: "Delivery", value: <Link className="hover:underline" href={`/sales/deliveries/${salesReturn.delivery_id}`}>{salesReturn.delivery_number}</Link> },
            { label: "Invoice", value: detail.invoices.length ? detail.invoices.map((invoice) => invoice.invoice_number).join(", ") : "—" },
            { label: "Return warehouse", value: salesReturn.warehouse_name ?? "—" },
            { label: "Returned", value: calendarDate(salesReturn.return_date) },
            { label: "Reason", value: salesReturn.reasonLabel },
          ],
          primaryAction: actions.receive ? <Button variant="primary" onPress={() => setDialog("receive")}><Check className="size-4" aria-hidden="true" />Receive Return</Button>
            : actions.creditNote ? <Button variant="primary" onPress={() => setDialog("credit")}><FileMinus className="size-4" aria-hidden="true" />Create Credit Note</Button> : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <Button variant="secondary" onPress={() => setDialog("edit")}><Pencil className="size-4" aria-hidden="true" />Edit</Button>}
              {actions.print && <a className={buttonVariants({ variant: "secondary" })} href={returnNotePdfUrl(returnId, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Return Note</a>}
              {actions.print && <LinkButton variant="secondary" href={returnNotePdfUrl(returnId)} download>Download</LinkButton>}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Draft</Button>}
            </div>
          ),
        }}
      >
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Return sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items ({detail.lines.length})</Tab>
            <Tab id="inventory">Inventory</Tab>
            <Tab id="credit">Credit / financial</Tab>
            <Tab id="related">Related documents</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><Overview detail={detail} /></TabPanel>
          <TabPanel id="items"><Items detail={detail} /></TabPanel>
          <TabPanel id="inventory"><Inventory detail={detail} /></TabPanel>
          <TabPanel id="credit"><Credit detail={detail} onCredit={actions.creditNote ? () => setDialog("credit") : undefined} /></TabPanel>
          <TabPanel id="related"><Related detail={detail} /></TabPanel>
          <TabPanel id="notes"><Notes detail={detail} canEdit={actions.edit || actions.receive} onChanged={refresh} /></TabPanel>
          <TabPanel id="history"><History detail={detail} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "edit" && <EditReturnDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was saved.")} />}
      {dialog === "receive" && <ReceiveReturnDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The return was received: the goods are back in stock.")} />}
      {dialog === "cancel" && <CancelReturnDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was cancelled.")} />}
      {dialog === "credit" && <ReturnCreditDialog detail={detail} onClose={() => setDialog(null)} onDone={(creditNotes) => {
        if (creditNotes.length === 1) { router.push(`/sales/credit-notes/${creditNotes[0].creditNoteId}`); return; }
        setTab("credit"); done(`Draft credit notes ${creditNotes.map((note) => note.creditNoteNumber).join(", ")} were created, one per invoice. Check and post each.`);
      }} />}
    </div>
  );
}

function Overview({ detail }: { detail: ReturnDetail }) {
  const salesReturn = detail.salesReturn;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Return">
        <Facts items={[
          { label: "Customer", value: salesReturn.customer_snapshot?.displayName ?? "—" },
          { label: "Customer PO", value: salesReturn.customer_po_number ?? "—" },
          { label: "Sales order", value: salesReturn.sales_order_number },
          { label: "Delivered from", value: salesReturn.delivery_warehouse_name ?? "—" },
          { label: "Returned to", value: salesReturn.warehouse_name ?? "—" },
          { label: "Return date", value: calendarDate(salesReturn.return_date) },
          { label: "Reason", value: [salesReturn.reasonLabel, salesReturn.reason_note].filter(Boolean).join(": ") },
          { label: "Quantity", value: `${quantity(salesReturn.total_quantity)} in ${detail.lines.length} line(s)` },
          { label: "Credit", value: salesReturn.creditStatusLabel },
        ]} />
      </Panel>
      <Panel title="Status history">
        <Facts items={[
          { label: "Created", value: by(salesReturn.created_at, salesReturn.created_by_name) },
          { label: "Received", value: by(salesReturn.received_at, salesReturn.received_by_name) },
          { label: "Cancelled", value: by(salesReturn.cancelled_at, salesReturn.cancelled_by_name) },
        ]} />
      </Panel>
    </div>
  );
}

function Items({ detail }: { detail: ReturnDetail }) {
  const received = detail.salesReturn.status === "received";
  return (
    <div className="overflow-x-auto pt-4">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-surface-muted text-left text-text-secondary">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 text-right font-medium">Delivered</th>
            <th className="py-2 pr-3 text-right font-medium">{received ? "Returned before" : "Already returned"}</th><th className="py-2 pr-3 text-right font-medium">This return</th>
            <th className="py-2 pr-3 font-medium">Condition</th><th className="py-2 font-medium">Stock</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id} className="border-b border-border align-top">
              <td className="py-2 pr-3"><span className="font-medium">{line.item_name_snapshot}</span><span className="block text-xs text-text-muted">{line.item_code_snapshot}</span></td>
              <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.delivered)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.returned_elsewhere)}</td>
              <td className="py-2 pr-3 text-right font-medium tabular-nums">{quantity(line.quantity)} {line.uom_snapshot ?? ""}</td>
              <td className="py-2 pr-3">{line.dispositionLabel}{line.reasonLabel ? <span className="block text-xs text-text-muted">{line.reasonLabel}</span> : null}</td>
              <td className="py-2 text-xs">{received ? (line.movement_number ? `${line.movement_number}${line.location_code ? ` · ${line.location_code}` : ""}` : "Not stock tracked") : line.sellable ? "Will be sellable" : "Will be held"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Inventory({ detail }: { detail: ReturnDetail }) {
  return (
    <div className="pt-4">
      <Panel title="Stock returned" description="Stock comes back only when the return is received. Restocked goods are sellable; held and damaged goods sit in a quality location and are not available to sell.">
        {!detail.movements.length ? <p className="text-sm text-text-muted">{detail.salesReturn.status === "draft" ? "Nothing has come back into stock yet." : "No stock-tracked items on this return."}</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.movements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium tabular-nums">{movement.movement_number}</span>
                <span>{movement.item_name} × {quantity(movement.quantity)}</span>
                <span className="text-text-muted">{[movement.warehouse_name, movement.location_code].filter(Boolean).join(" · ")} · {dateTime(movement.created_at)}</span>
                {movement.location_type === "quality" ? <StatusBadge tone="warning">Held</StatusBadge> : <StatusBadge tone="success">Sellable</StatusBadge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Credit({ detail, onCredit }: { detail: ReturnDetail; onCredit?: () => void }) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Credit" description="A return moves stock; a credit note corrects what the customer owes. Goods returned before they were invoiced need no credit note. A refund is separate."
        actions={onCredit ? <Button variant="primary" size="compact" onPress={onCredit}>Create Credit Note</Button> : undefined}>
        <p className="text-sm">{detail.credit.label}</p>
        {detail.credit.lines.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.credit.lines.map((line) => (
              <li key={line.returnLineId}>{line.item}: returned {quantity(line.quantity)}, invoiced before it came back {quantity(line.invoiced)}, credited {quantity(line.credited)}</li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Credit notes" description="A return is not refunded directly: the credit note makes the customer's credit, and Finance refunds that credit or applies it to another invoice.">
        {!detail.credits.length ? <p className="text-sm text-text-muted">No credit notes.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.credits.map((credit) => (
              <li key={credit.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link className="font-medium tabular-nums text-brand hover:underline" href={`/sales/credit-notes/${credit.id}`}>{credit.invoice_number}</Link>
                <StatusBadge tone={statusTone(credit.status)}>{statusLabel(credit.status)}</StatusBadge>
                <span className="text-text-muted">against <Link className="text-brand hover:underline" href={`/sales/invoices/${credit.source_invoice_id}`}>{credit.source_invoice_number}</Link></span>
                {credit.refunds.map((refund) => (
                  <span key={refund.id} className="text-text-muted">→ refund <Link className="text-brand hover:underline" href={`/sales/refunds/${refund.id}`}>{refund.refundNumber}</Link>
                    {" "}{Number(refund.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {refund.currencyCode}{refund.status === "reversed" ? " (reversed)" : ""}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Related({ detail }: { detail: ReturnDetail }) {
  const salesReturn = detail.salesReturn;
  const link = (href: string, label: string) => <Link className="text-brand hover:underline" href={href}>{label}</Link>;
  return (
    <div className="pt-4">
      <Panel title="Related documents">
        <Facts items={[
          { label: "Sales order", value: link(`/sales/orders/${salesReturn.sales_order_id}`, salesReturn.sales_order_number) },
          { label: "Delivery", value: link(`/sales/deliveries/${salesReturn.delivery_id}`, salesReturn.delivery_number) },
          { label: "Invoices", value: detail.invoices.length ? <span className="flex flex-wrap gap-2">{detail.invoices.map((invoice) => <span key={invoice.id}>{link(`/sales/invoices/${invoice.id}`, invoice.invoice_number)}</span>)}</span> : "—" },
          { label: "Credit notes", value: detail.credits.length ? <span className="flex flex-wrap gap-2">{detail.credits.map((credit) => <span key={credit.id}>{link(`/sales/credit-notes/${credit.id}`, credit.invoice_number)}</span>)}</span> : "—" },
        ]} />
      </Panel>
    </div>
  );
}

function Notes({ detail, canEdit, onChanged }: { detail: ReturnDetail; canEdit: boolean; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const salesReturn = detail.salesReturn;
  const filesKey = scopedQueryKey(workspace, "sales", "return", salesReturn.id, "files");
  const files = useQuery({ queryKey: filesKey, queryFn: () => listReturnFiles(salesReturn.id).then((r) => r.files) });
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const after = () => { setError(null); void queryClient.invalidateQueries({ queryKey: filesKey }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadReturnFile(salesReturn.id, file), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be uploaded.")) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeReturnFile(salesReturn.id, fileId), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be removed.")) });
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Customer notes" description="Printed on the return note."><p className="text-sm whitespace-pre-line">{salesReturn.customer_notes ?? "None"}</p></Panel>
      <Panel title="Internal notes" description="Never printed or shown to the customer."><p className="text-sm whitespace-pre-line">{salesReturn.internal_notes ?? "None"}</p></Panel>
      <Panel title="Attachments" description="The customer's return request, photos of the goods, a signed return receipt."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Upload</Button>
          </>
        ) : undefined}>
        {error && <Notice>{error}</Notice>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={returnFileUrl(salesReturn.id, file.id)}>{file.fileName}</a>
                <span className="text-text-muted">{dateTime(file.uploadedAt)}</span>
                {canEdit && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function History({ detail }: { detail: ReturnDetail }) {
  return (
    <div className="pt-4">
      <Panel title="History">
        {!detail.events.length ? <p className="text-sm text-text-muted">No history yet.</p> : (
          <ol className="flex flex-col divide-y divide-border text-sm">
            {detail.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 py-2">
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{EVENT_LABELS[event.event_type] ?? statusLabel(event.event_type.split(".").pop())}</span>
                  <span className="text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span></span>
                {eventDetail(event.metadata) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event.metadata)}</span>}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
