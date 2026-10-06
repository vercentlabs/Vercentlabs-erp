"use client";

// One quotation: the header with its status and the actions open to the
// caller now (the server decides them and checks each again), then the
// customer and terms, the lines with list and quoted prices, totals with the
// tax breakdown, notes, revisions and related documents, files and the
// timeline. A Draft is edited; a confirmed quotation is changed by a revision.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Check, Copy, Pencil, Upload, X } from "lucide-react";
import {
  Button, Dialog, EnterpriseDataGrid, ErrorState, LinkButton, MetricStrip, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money } from "@/features/sales/shared/format";
import { StoredTotals, discountReasonLabel } from "@/features/sales/shared/DocumentDiscounts";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";

import {
  addSalesQuotationNote, approveSalesQuotation, confirmSalesQuotation, duplicateSalesQuotation, getSalesQuotation, listSalesQuotationFiles,
  rejectSalesQuotationApproval, removeSalesQuotationFile, uploadSalesQuotationFile, type SalesDocumentEvent, type SalesQuotationDetail, type SalesQuotationLine,
} from "../api/quotations-api";
import { QuotationLifecycleActions, failureText } from "../components/QuotationLifecycleActions";
import { QuotationStatusBadge } from "../components/QuotationStatusBadge";

type Snapshot = Record<string, string | null | undefined> | null;
const addressText = (snapshot: Snapshot) =>
  snapshot ? [snapshot.label, snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postal_code].filter(Boolean).join(", "), snapshot.gstin ? `GSTIN ${snapshot.gstin}` : null]
    .filter(Boolean).join("\n") || "—" : "—";
const personName = (snapshot: Snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;

const EVENT_LABELS: Record<string, string> = {
  "quotation.created": "Created", "quotation.updated": "Draft saved", "quotation.submitted": "Submitted for approval", "quotation.approved": "Approved and confirmed",
  "quotation.approval_rejected": "Approval rejected, back to draft", "quotation.confirmed": "Confirmed", "quotation.sent": "Sent", "quotation.resent": "Sent again",
  "quotation.accepted": "Accepted by the customer", "quotation.rejected": "Rejected by the customer", "quotation.cancelled": "Cancelled",
  "quotation.revision_created": "Revision created", "quotation.superseded": "Superseded", "quotation.duplicated": "Duplicated from another quotation",
  "quotation.order_created": "Sales order created", "quotation.discount_added": "Discount added", "quotation.discount_changed": "Discount changed",
  "quotation.discount_removed": "Discount removed", "quotation.price_overridden": "Price overridden", "quotation.discount_limit_overridden": "Discount above the standard limit", "quotation.note_added": "Note", "quotation.file_added": "File added", "quotation.file_removed": "File removed",
};
function eventDetail(event: SalesDocumentEvent) {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  return [
    text("scope") && `${text("scope")![0].toUpperCase()}${text("scope")!.slice(1)}`, text("from") && text("to") && `${text("from")} → ${text("to")}`,
    text("requestedPercent") && `${Number(text("requestedPercent"))}% requested`,
    text("note"), text("reason"), text("notes"), text("recipient") && `To ${text("recipient")}`, text("channel") === "manual" ? "Sent outside Vercentlabs" : null,
    text("revisionNumber") && `Revision ${text("revisionNumber")}`, text("supersededByNumber") && `By ${text("supersededByNumber")}`,
    text("revisionOfNumber") && `Revises ${text("revisionOfNumber")}`, text("fromQuotationNumber") && `From ${text("fromQuotationNumber")}`,
    text("orderNumber") && `Order ${text("orderNumber")}`, text("fileName"), text("reference") && `Reference ${text("reference")}`,
  ].filter(Boolean).join(" · ");
}

export function SalesQuotationDetailScreen({ quotationId }: { quotationId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "sales", "quotation", quotationId);
  const query = useQuery({ queryKey: key, queryFn: () => getSalesQuotation(quotationId).then((r) => r.quotation) });
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "quotations") });
  };
  const fail = (fallback: string) => (failure: unknown) => setError(failureText(failure, fallback));
  const confirm = useMutation({
    mutationFn: () => confirmSalesQuotation(quotationId, query.data?.quotation.version_number),
    onSuccess: refresh, onError: fail("The quotation could not be confirmed."),
  });
  const approve = useMutation({
    mutationFn: () => approveSalesQuotation(quotationId, query.data?.quotation.current_version_id),
    onSuccess: refresh, onError: fail("The quotation could not be approved."),
  });
  const [duplicateKey] = useState(() => crypto.randomUUID());
  const duplicate = useMutation({
    mutationFn: () => duplicateSalesQuotation(quotationId, duplicateKey),
    onSuccess: ({ result }) => router.push(`/sales/quotations/${result.id}/edit`),
    onError: fail("The quotation could not be duplicated."),
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to quotations" description="Ask an administrator for the View quotations permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Quotation not found" : "Could not load this quotation"}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const quote = detail.quotation;
  const actions = detail.actions;
  const currency = quote.currency_code;
  const contactName = personName(quote.contact_snapshot);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/quotations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All quotations
      </Link>
      {error && <SalesAlert>{error}</SalesAlert>}
      {quote.status === "superseded" && quote.superseded_by_quotation_id && (
        <SalesAlert tone="info">This quotation was superseded by <Link className="underline" href={`/sales/quotations/${quote.superseded_by_quotation_id}`}>{quote.superseded_by_number}</Link>.</SalesAlert>
      )}
      {quote.is_expired && <SalesAlert tone="warning">The validity of this quotation has passed. Create a revision with a new valid-until date to offer it again.</SalesAlert>}

      <RecordDetailsPage
        header={{
          title: quote.quotation_number,
          status: <QuotationStatusBadge status={quote.status} label={quote.status_label} />,
          fields: [
            { label: "Customer", value: quote.party_id ? <Link className="hover:underline" href={`/sales/customers/${quote.party_id}`}>{quote.customer_snapshot?.displayName ?? "—"}</Link> : "—" },
            { label: "Quotation date", value: calendarDate(quote.quotation_date) },
            { label: "Valid until", value: calendarDate(quote.valid_until) },
            { label: "Total", value: money(currency, quote.grand_total) },
            { label: "Owner", value: quote.owner_name ?? "—" },
            ...(quote.source_opportunity_id
              ? [{ label: "Opportunity", value: <Link className="hover:underline" href={`/crm/opportunities/${quote.source_opportunity_id}`}>{[quote.source_opportunity_code, quote.source_opportunity_name].filter(Boolean).join(" · ")}</Link> }]
              : []),
            ...(quote.revision_of_quotation_id
              ? [{ label: "Revision of", value: <Link className="hover:underline" href={`/sales/quotations/${quote.revision_of_quotation_id}`}>{quote.revision_of_number}</Link> }]
              : []),
          ],
          primaryAction: actions.confirm ? (
            <Button variant="primary" isLoading={confirm.isPending} onPress={() => confirm.mutate()}><Check className="size-4" aria-hidden="true" />Confirm</Button>
          ) : actions.approve ? (
            <Button variant="primary" isLoading={approve.isPending} onPress={() => approve.mutate()}><Check className="size-4" aria-hidden="true" />Approve</Button>
          ) : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <LinkButton variant="secondary" href={`/sales/quotations/${quotationId}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
              {actions.rejectApproval && <Button variant="secondary" onPress={() => setRejecting(true)}><X className="size-4" aria-hidden="true" />Send back to draft</Button>}
              <QuotationLifecycleActions
                quotation={{ id: quotationId, number: quote.quotation_number, status: quote.lifecycle_status, isExpired: quote.is_expired, convertedOrderId: quote.converted_order_id, contactName, contactEmail: quote.contact_snapshot?.email ?? null }}
                can={can}
                onChanged={refresh}
              />
              {actions.duplicate && <Button variant="ghost" isLoading={duplicate.isPending} onPress={() => duplicate.mutate()}><Copy className="size-4" aria-hidden="true" />Duplicate</Button>}
            </div>
          ),
        }}
      >
        <MetricStrip
          metrics={[
            { label: "Subtotal", value: money(currency, quote.subtotal) },
            { label: "Discount", value: money(currency, quote.discount_total) },
            { label: "Tax", value: money(currency, quote.tax_total) },
            { label: "Grand total", value: money(currency, quote.grand_total) },
            ...(quote.margin_percent !== undefined ? [{ label: "Margin", value: `${Number(quote.margin_percent).toFixed(1)}%` }] : []),
          ]}
        />
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Quotation sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="lines">Lines ({detail.lines.length})</Tab>
            <Tab id="notes">Notes &amp; terms</Tab>
            <Tab id="related">Revisions &amp; related</Tab>
            <Tab id="files">Files</Tab>
            <Tab id="timeline">Timeline</Tab>
          </TabList>
          <TabPanel id="overview"><Overview detail={detail} /></TabPanel>
          <TabPanel id="lines"><Lines detail={detail} /></TabPanel>
          <TabPanel id="notes"><Notes detail={detail} /></TabPanel>
          <TabPanel id="related"><Related detail={detail} /></TabPanel>
          <TabPanel id="files"><Files quotationId={quotationId} canEdit={can("sales.quotation.create")} onChanged={refresh} /></TabPanel>
          <TabPanel id="timeline"><Timeline detail={detail} quotationId={quotationId} onChanged={refresh} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {rejecting && <RejectApprovalDialog quotationId={quotationId} onClose={() => setRejecting(false)} onDone={() => { setRejecting(false); refresh(); }} />}
    </div>
  );
}

function Overview({ detail }: { detail: SalesQuotationDetail }) {
  const quote = detail.quotation;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Customer">
        <SalesFacts items={[
          { label: "Customer", value: quote.customer_snapshot?.displayName ?? "—" },
          { label: "Customer number", value: quote.customer_snapshot?.customerNumber ?? quote.customer_number ?? "—" },
          { label: "GSTIN", value: quote.customer_snapshot?.gstin ?? "—" },
          { label: "Contact", value: [personName(quote.contact_snapshot), quote.contact_snapshot?.designation, quote.contact_snapshot?.email, quote.contact_snapshot?.phone ?? quote.contact_snapshot?.mobile].filter(Boolean).join(" · ") || "—" },
          { label: "Bill to", value: <span className="whitespace-pre-line">{addressText(quote.billing_address_snapshot)}</span> },
          { label: "Ship to", value: <span className="whitespace-pre-line">{addressText(quote.shipping_address_snapshot)}</span> },
        ]} />
      </SalesPanel>
      <SalesPanel title="Commercial terms">
        <SalesFacts items={[
          { label: "Currency", value: quote.currency_code },
          { label: "Price list", value: quote.price_list_name ? `${quote.price_list_name} (${quote.price_list_tax_inclusive ? "tax inclusive" : "tax exclusive"})` : "None" },
          { label: "Payment terms", value: quote.payment_term_snapshot?.name
            ? <span className="flex flex-col"><span>{quote.payment_term_snapshot.name}</span>
                {[quote.payment_term_snapshot.description, quote.payment_term_snapshot.note].filter(Boolean).map((line, index) => <span key={index} className="text-xs text-text-muted">{line}</span>)}</span>
            : "—" },
          { label: "Issued by", value: quote.seller_snapshot?.name ? `${quote.seller_snapshot.name}${quote.seller_snapshot.gstin ? ` · GSTIN ${quote.seller_snapshot.gstin}` : ""}` : "—" },
          { label: "Place of supply", value: quote.place_of_supply
            ? `${quote.place_of_supply_name ?? quote.place_of_supply} (${quote.place_of_supply})${quote.place_of_supply_source === "override" ? ` · changed: ${quote.place_of_supply_reason ?? ""}` : ""}`
            : "—" },
          { label: "Supply type", value: `${({ domestic: "Domestic", export: "Export", sez: "Supply to SEZ", exempt: "Exempt supply", non_gst: "Non-GST supply" } as Record<string, string>)[quote.supply_type ?? ""] ?? quote.supply_type ?? "—"}${quote.tax_override_reason ? ` · changed: ${quote.tax_override_reason}` : ""}` },
          { label: "GST", value: quote.tax_treatment !== "taxable" ? "No tax charged" : ({ intra_state: "Within the state: CGST + SGST", inter_state: "Between states: IGST" } as Record<string, string>)[quote.supply_nature ?? ""] ?? "—" },
          { label: "Customer reference", value: quote.customer_reference ?? "—" },
          { label: "Delivery terms", value: quote.delivery_terms ?? "—" },
          { label: "Shipping method", value: quote.shipping_method ?? "—" },
          { label: "Additional discount", value: !Number(quote.document_discount_amount) ? "None" : quote.document_discount_type === "percent"
            ? `${Number(quote.document_discount_value)}% (${money(quote.currency_code, quote.document_discount_amount)})` : money(quote.currency_code, quote.document_discount_amount) },
          { label: "Discount reason", value: discountReasonLabel(quote.discount_reason_code, quote.discount_reason_text) ?? "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Status history">
        <SalesFacts items={[
          { label: "Created", value: `${dateTime(quote.created_at)}${quote.created_by_name ? ` by ${quote.created_by_name}` : ""}` },
          { label: "Confirmed", value: quote.confirmed_at ? `${dateTime(quote.confirmed_at)}${quote.confirmed_by_name ? ` by ${quote.confirmed_by_name}` : ""}` : "—" },
          { label: "Sent", value: quote.sent_at ? `${dateTime(quote.sent_at)}${quote.sent_by_name ? ` by ${quote.sent_by_name}` : ""}${quote.sent_to ? ` to ${quote.sent_to}` : ""}` : "—" },
          { label: "Accepted", value: quote.accepted_at ? `${dateTime(quote.accepted_at)}${quote.decision_reference ? ` · ${quote.decision_reference}` : ""}` : "—" },
          { label: "Rejected", value: quote.rejected_at ? `${dateTime(quote.rejected_at)}${quote.decision_notes ? `: ${quote.decision_notes}` : ""}` : "—" },
          { label: "Cancelled", value: quote.cancelled_at ? `${dateTime(quote.cancelled_at)}${quote.cancel_reason ? `: ${quote.cancel_reason}` : ""}` : "—" },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Lines({ detail }: { detail: SalesQuotationDetail }) {
  const quote = detail.quotation;
  const currency = quote.currency_code;
  const columns: ColumnDef<SalesQuotationLine, unknown>[] = [
    { id: "seq", header: "#", cell: ({ row }) => row.original.sequence },
    {
      id: "item", header: "Product / service",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className="font-medium">{row.original.item_name_snapshot}</span>
          <span className="text-xs text-text-muted">{[row.original.item_code_snapshot, row.original.hsn_sac_snapshot && `${row.original.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${row.original.hsn_sac_snapshot}`].filter(Boolean).join(" · ")}</span>
          {row.original.description_snapshot && row.original.description_snapshot !== row.original.item_name_snapshot && <span className="text-xs text-text-secondary">{row.original.description_snapshot}</span>}
        </span>
      ),
    },
    { id: "qty", header: "Quantity", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{Number(row.original.quantity)} {row.original.uom_snapshot ?? ""}</span> },
    { id: "list", header: "List price", cell: ({ row }) => <span className="tabular-nums">{money(currency, row.original.list_unit_price)}</span> },
    {
      id: "price", header: "Unit price",
      cell: ({ row }) => (
        <span className="flex flex-col tabular-nums">
          {money(currency, row.original.unit_price)}
          {row.original.manual_price_override && <span className="text-xs text-warning" title={row.original.manual_price_reason ?? undefined}>Overridden{row.original.manual_price_reason ? `: ${row.original.manual_price_reason}` : ""}</span>}
        </span>
      ),
    },
    {
      id: "discount", header: "Discount",
      cell: ({ row }) => Number(row.original.discount_amount)
        ? <span className="tabular-nums">{row.original.discount_type === "amount" ? money(currency, row.original.discount_amount) : `${Number(row.original.discount_value)}% (${money(currency, row.original.discount_amount)})`}</span>
        : "",
    },
    { id: "net", header: "Net", cell: ({ row }) => <span className="tabular-nums">{money(currency, row.original.net_amount)}</span> },
    { id: "taxable", header: "Taxable", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums">
        {money(currency, row.original.taxable_amount)}
        {Number(row.original.document_discount_amount) > 0 && <span className="text-xs text-text-muted">after {money(currency, row.original.document_discount_amount)} additional discount</span>}
      </span>
    ) },
    { id: "tax", header: "Tax", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums">
        {money(currency, row.original.tax_amount)}
        <span className="text-xs text-text-muted">{row.original.tax_treatment && row.original.tax_treatment !== "taxable" ? row.original.tax_treatment.replace(/_/g, " ") : `${Number(row.original.tax_rate)}%`}</span>
      </span>
    ) },
    { id: "total", header: "Amount", cell: ({ row }) => <span className="font-medium tabular-nums">{money(currency, row.original.line_total)}</span> },
  ];
  return (
    <div className="flex flex-col gap-4 pt-4">
      <EnterpriseDataGrid<SalesQuotationLine> aria-label="Quotation lines" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SalesPanel title="Tax breakdown">
          {detail.taxLines.length ? (
            <SalesFacts columns={2} items={detail.taxLines.map((tax) => ({ label: `${tax.label ?? tax.tax_type.toUpperCase()} ${Number(tax.rate)}% on ${money(currency, tax.taxable_amount)}`, value: money(currency, tax.tax_amount) }))} />
          ) : <p className="text-sm text-text-muted">No tax on this quotation.</p>}
        </SalesPanel>
        <SalesPanel title="Totals" description="Calculated by the server when the quotation was saved.">
          <StoredTotals currencyCode={currency} document={quote} taxLines={detail.taxLines} />
        </SalesPanel>
      </div>
    </div>
  );
}

function Notes({ detail }: { detail: SalesQuotationDetail }) {
  const quote = detail.quotation;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Notes for the customer" description="Printed on the quotation."><p className="whitespace-pre-line text-sm">{quote.customer_notes || "—"}</p></SalesPanel>
      <SalesPanel title="Terms and conditions" description="Printed on the quotation."><p className="whitespace-pre-line text-sm">{quote.terms_and_conditions || "—"}</p></SalesPanel>
      <SalesPanel title="Internal notes" description="Never printed or sent to the customer."><p className="whitespace-pre-line text-sm">{quote.internal_notes || "—"}</p></SalesPanel>
    </div>
  );
}

function Related({ detail }: { detail: SalesQuotationDetail }) {
  const quote = detail.quotation;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Related documents">
        <SalesFacts items={[
          { label: "Opportunity", value: quote.source_opportunity_id ? <Link className="text-brand hover:underline" href={`/crm/opportunities/${quote.source_opportunity_id}`}>{[quote.source_opportunity_code, quote.source_opportunity_name].filter(Boolean).join(" · ")}</Link> : "None (created directly)" },
          { label: "Sales order", value: quote.converted_order_id ? <Link className="text-brand hover:underline" href={`/sales/orders/${quote.converted_order_id}`}>{quote.converted_order_number}</Link> : "None" },
          { label: "Customer", value: <Link className="text-brand hover:underline" href={`/sales/customers/${quote.party_id}`}>{quote.customer_snapshot?.displayName ?? "Open customer"}</Link> },
        ]} />
      </SalesPanel>
      <SalesPanel title="Revisions" description="Each revision is its own quotation. When a revision is sent, the one it revises is superseded.">
        {detail.revisions.length <= 1 ? <p className="text-sm text-text-muted">This quotation has no revisions.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.revisions.map((revision) => (
              <li key={revision.id} className="flex flex-wrap items-center gap-3 py-2">
                {revision.id === quote.id ? <span className="font-medium tabular-nums">{revision.quotation_number} (this one)</span>
                  : <Link className="font-medium text-brand tabular-nums hover:underline" href={`/sales/quotations/${revision.id}`}>{revision.quotation_number}</Link>}
                <QuotationStatusBadge status={revision.status.key} label={revision.status.label} />
                <span className="tabular-nums text-text-secondary">{money(quote.currency_code, revision.grand_total)}</span>
                <span className="text-text-muted">Valid until {calendarDate(revision.valid_until)}</span>
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
      <SalesPanel title="Saved versions" description="Each save of the draft is kept.">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {detail.versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-2">
              <StatusBadge tone="neutral">{`v${version.version_number}`}</StatusBadge>
              <span className="tabular-nums">{money(version.currency_code?.trim(), version.grand_total)}</span>
              <span className="text-text-muted">{dateTime(version.created_at)}{version.created_by_name ? ` · ${version.created_by_name}` : ""}</span>
              {version.revision_reason && <span className="text-text-secondary">{version.revision_reason}</span>}
            </li>
          ))}
        </ul>
      </SalesPanel>
    </div>
  );
}

function Files({ quotationId, canEdit, onChanged }: { quotationId: string; canEdit: boolean; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "quotation", quotationId, "files");
  const query = useQuery({ queryKey: key, queryFn: () => listSalesQuotationFiles(quotationId).then((r) => r.files) });
  const input = useRef<HTMLInputElement>(null);
  const done = () => { void queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadSalesQuotationFile(quotationId, file), onSuccess: done });
  const remove = useMutation({ mutationFn: (fileId: string) => removeSalesQuotationFile(quotationId, fileId), onSuccess: done });
  return (
    <div className="flex flex-col gap-3 pt-4">
      <SalesPanel title="Files" description="The customer's enquiry, drawings or a signed copy. Files are internal and never added to the quotation PDF."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-3.5" aria-hidden="true" />Add file</Button>
          </>
        ) : undefined}>
        {(upload.isError || remove.isError) && <SalesAlert>{failureText(upload.error ?? remove.error, "The file could not be saved.")}</SalesAlert>}
        {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !query.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {query.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={`/api/sales/quotations/${quotationId}/files/${file.id}`}>{file.fileName}</a>
                <span className="text-text-muted">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {dateTime(file.uploadedAt)}</span>
                {canEdit && <Button variant="ghost" size="compact" isLoading={remove.isPending && remove.variables === file.id} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
    </div>
  );
}

function Timeline({ detail, quotationId, onChanged }: { detail: SalesQuotationDetail; quotationId: string; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => addSalesQuotationNote(quotationId, note.trim()), onSuccess: () => { setNote(""); onChanged(); } });
  return (
    <div className="flex flex-col gap-3 pt-4">
      <SalesPanel title="Add a note" description="Internal: kept on the timeline, never printed.">
        {save.isError && <SalesAlert>{failureText(save.error, "The note could not be saved.")}</SalesAlert>}
        <TextArea aria-label="Note" value={note} onChange={setNote} />
        <div><Button variant="secondary" size="compact" isDisabled={!note.trim()} isLoading={save.isPending} onPress={() => save.mutate()}>Add note</Button></div>
      </SalesPanel>
      <SalesPanel title="Timeline">
        <ol className="flex flex-col divide-y divide-border text-sm">
          {detail.events.map((event, index) => (
            <li key={event.id ?? index} className="flex flex-col gap-0.5 py-2">
              <span className="font-medium">{EVENT_LABELS[event.event_type] ?? event.event_type.replace("quotation.", "").replace(/_/g, " ")}</span>
              {eventDetail(event) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event)}</span>}
              <span className="text-xs text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
            </li>
          ))}
        </ol>
      </SalesPanel>
    </div>
  );
}

function RejectApprovalDialog({ quotationId, onClose, onDone }: { quotationId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => rejectSalesQuotationApproval(quotationId, reason.trim()), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title="Send back to draft" description="The quotation returns to Draft for changes. Say why.">
      <div className="flex flex-col gap-3">
        {save.isError && <SalesAlert>{failureText(save.error, "The approval could not be rejected.")}</SalesAlert>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isDisabled={reason.trim().length < 5} isLoading={save.isPending} onPress={() => save.mutate()}>Send back</Button>
        </div>
      </div>
    </Dialog>
  );
}
