"use client";

// Procurement → Bills & Payments → Supplier Payments (Procurement plan Phase 1): every payment made to a supplier, read from Finance's records,
// with the bills it settled; one payment with its bills, the TDS withheld on each and its payment advice PDF. Payments are made from a bill
// or several at once from Payables › Due & Overdue; with Accounting on, the payment also opens in Accounting.
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Wallet } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, RecordDetailsPage, SearchField, Select, StatusBadge, buttonVariants,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { DocumentChain } from "@/features/procurement/shared/DocumentChain";
import { ListStateViews } from "@/features/procurement/shared/ListStateViews";
import { useListState } from "@/features/procurement/shared/navigation";
import { gridPaging, pageFilters, usePageIndex } from "@/features/procurement/shared/paging";
import { SupplierFilter } from "@/features/procurement/shared/ProcurementSearchPicker";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate, money } from "@/features/procurement/shared/format";

import { completeSupplierPayment, errorMessage, getSupplierPayment, listSupplierPayments, paymentAdviceUrl, type SupplierPaymentRow } from "./api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const STATUS_TONE: Record<string, Tone> = { draft: "neutral", pending_approval: "warning", approved: "info", posted: "success", partially_applied: "success", applied: "success",
  reversed: "danger", cancelled: "neutral" };
const VIEWS = [{ key: "all", label: "All" }, { key: "this_month", label: "This month" }, { key: "advances", label: "Advances" }, { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "reversed", label: "Reversed" }];

export function SupplierPaymentsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const list = useListState("supplier-payments", { view: "all", filters: { supplierId: "any", method: "any" } });
  const { view, setView, search, setSearch } = list;
  const view_ = view.replace(/-/g, "_");
  const { supplierId, method } = list.filters;
  const filters = useMemo(() => ({ view: view_ === "all" ? undefined : view_, search: search.trim() || undefined, supplierId: supplierId === "any" ? undefined : supplierId,
    method: method === "any" ? undefined : method }), [view_, search, supplierId, method]);
  const [pageIndex, setPageIndex] = usePageIndex(filters);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-payments", filters, pageIndex),
    queryFn: () => listSupplierPayments({ ...filters, ...pageFilters(pageIndex) }), placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<SupplierPaymentRow, unknown>[]>(() => [
    { id: "number", header: "Payment", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span> },
    { id: "date", header: "Date", cell: ({ row }) => calendarDate(row.original.date) },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "method", header: "Paid by", cell: ({ row }) => <span>{row.original.methodLabel}{row.original.reference && <span className="block text-xs text-text-muted">{row.original.reference}</span>}</span> },
    { id: "bills", header: "Bills settled", cell: ({ row }) => (row.original.bills.length
      ? <span className="text-sm">{row.original.bills.slice(0, 3).map((bill) => bill.number).join(", ")}{row.original.bills.length > 3 ? ` +${row.original.bills.length - 3}` : ""}</span>
      : <span className="text-xs text-text-muted">{row.original.purchaseOrderNumber ? `Advance on ${row.original.purchaseOrderNumber}` : "Advance"}</span>) },
    { id: "amount", header: "Amount", cell: ({ row }) => <span className="font-medium tabular-nums">{money(row.original.currencyCode, row.original.amount)}</span> },
    { id: "unapplied", header: "Advance left", cell: ({ row }) => <span className="tabular-nums">{Number(row.original.unapplied) > 0 ? money(row.original.currencyCode, row.original.unapplied) : "—"}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
  ], []);
  const filtered = Boolean(search) || view_ !== "all" || supplierId !== "any" || method !== "any";
  const forbidden = query.error instanceof ProcApiError && query.error.status === 403;
  return (
    <EnterpriseListPage header={{ title: "Supplier Payments",
      description: "Every payment made to a supplier and the bills it settled. Pay one bill from the bill, or several at once from Due & Overdue.",
      primaryAction: <LinkButton variant="primary" href="/procurement/reports/payment-obligations"><Wallet className="size-4" aria-hidden="true" />Pay bills</LinkButton> }}
      savedViews={{ views: (query.data?.views ?? VIEWS).map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view_, onSelect: (next) => setView(next.replace(/_/g, "-")) }}
      actionBar={{ end: <ListStateViews listKey="supplier-payments" list={list} />, start: (
        <>
          <SearchField aria-label="Search payments" placeholder="Payment, supplier, UTR or bill" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <SupplierFilter known={[]} value={supplierId} onChange={(id) => list.setFilter("supplierId", id || "any")} />
          <Select aria-label="Paid by" size="compact" selectedKey={method} onSelectionChange={(value) => list.setFilter("method", String(value))}
            options={[{ value: "any", label: "Any method" }, ...(query.data?.methods ?? []).map((entry) => ({ value: entry.code, label: entry.label }))]} />
        </>
      ) }}>
      {forbidden ? <PermissionState title="You don't have access to supplier payments" description="Ask an administrator for the View supplier bills permission." /> : (
        <EnterpriseDataGrid<SupplierPaymentRow> aria-label="Supplier payments" columns={columns} data={rows} getRowId={(row) => row.id} {...gridPaging(query.data?.total ?? 0, pageIndex, setPageIndex)}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading supplier payments" rows={6} />}
          errorContent={<ErrorState title="Could not load supplier payments" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No supplier payments yet" description="Pay a posted bill from the bill, or several from Due & Overdue." />}
          noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view, supplier or search." />}
          onRowClick={(row) => router.push(`/procurement/payments/${row.id}`)}
          renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.number} · {row.supplierName}</span>
            <span className="text-xs text-text-muted">{calendarDate(row.date)} · {row.methodLabel} · {money(row.currencyCode, row.amount)} · {row.statusLabel}</span></div>} />
      )}
    </EnterpriseListPage>
  );
}

export function SupplierPaymentDetailScreen({ paymentId }: { paymentId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-payment", paymentId), queryFn: () => getSupplierPayment(paymentId) });
  const complete = useMutation({ mutationFn: () => completeSupplierPayment(paymentId),
    onSuccess: () => queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("procurement") }) });
  if (query.isLoading) return <LoadingState label="Loading payment" />;
  if (query.isError && query.error instanceof ProcApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to supplier payments" description="Ask an administrator for the View supplier bills permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof ProcApiError && query.error.status === 404 ? "Payment not found" : "Could not load this payment"} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { payment, supplier, allocations, planned } = query.data;
  const currency = payment.currencyCode;
  const waiting = ["draft", "pending_approval", "approved"].includes(payment.status);
  const settled = allocations.filter((row) => !row.reversed);
  return (
    <div className="flex flex-col gap-4">
      {payment.reversedAt && <Notice tone="warning">This payment was reversed{payment.reversalReason ? `: ${payment.reversalReason}` : ""}. The bills it paid are owed again.</Notice>}
      {waiting && <Notice tone="info">{payment.status === "approved" ? "Finance approved this payment. Post it to settle the bills below." : "This payment awaits Finance's approval. Once approved, post it to settle the bills below."}</Notice>}
      {complete.error && <Notice>{errorMessage(complete.error)}</Notice>}
      <DocumentChain type="supplier_payment" id={payment.id} />
      <RecordDetailsPage
        header={{
          title: payment.number,
          status: <StatusBadge tone={STATUS_TONE[payment.status] ?? "neutral"}>{payment.statusLabel}</StatusBadge>,
          primaryAction: payment.canPost ? <Button variant="primary" isLoading={complete.isPending} onPress={() => complete.mutate()}>Post payment</Button> : undefined,
          fields: [
            { label: "Supplier", value: <Link className="hover:underline" href={`/procurement/suppliers/${supplier.id}`}>{supplier.name}</Link> },
            { label: "Paid on", value: calendarDate(payment.date) },
            { label: "Amount", value: money(currency, payment.amount) },
            { label: "Paid by", value: [payment.methodLabel, payment.reference].filter(Boolean).join(" · ") },
            ...(Number(payment.tdsWithheld) ? [{ label: "TDS on these bills", value: money(currency, payment.tdsWithheld) }] : []),
            ...(Number(payment.unapplied) > 0 && !waiting ? [{ label: "Advance left", value: money(currency, payment.unapplied) }] : []),
          ],
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              <a className={buttonVariants({ variant: "secondary" })} href={paymentAdviceUrl(payment.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Payment advice</a>
              {payment.accountingHref && <LinkButton variant="ghost" href={payment.accountingHref}>Open in Accounting</LinkButton>}
            </div>
          ),
        }}
      >
        <Panel title={waiting ? "Bills it will settle" : "Bills settled"}
          description={Number(payment.unapplied) > 0 && !waiting ? `${money(currency, payment.unapplied)} is not applied yet: apply it from the supplier's next bill.` : undefined}>
          <LinesTable columns={["Bill", "Supplier invoice", "Invoice date", { label: "Bill amount", numeric: true }, { label: "TDS withheld", numeric: true }, { label: "Paid", numeric: true }]}
            empty={(waiting ? planned.length : allocations.length) ? undefined : "Kept as an advance: no bill settled yet."}>
            {waiting ? planned.map((row) => (
              <tr key={row.billId}>
                <Cell><Link className="text-brand hover:underline" href={row.href}>{row.billNumber ?? "Bill"}</Link></Cell>
                <Cell>{row.supplierInvoice ?? "—"}</Cell>
                <Cell>{row.billDate ? calendarDate(row.billDate) : "—"}</Cell>
                <Cell numeric>—</Cell>
                <Cell numeric>{Number(row.tds) ? money(currency, row.tds) : "—"}</Cell>
                <Cell numeric>{money(currency, row.amount)}</Cell>
              </tr>
            )) : allocations.map((row) => (
              <tr key={row.id} className={row.reversed ? "text-text-muted line-through" : undefined}>
                <Cell><Link className="text-brand hover:underline" href={row.href}>{row.billNumber}</Link></Cell>
                <Cell>{row.supplierInvoice ?? "—"}</Cell>
                <Cell>{calendarDate(row.billDate)}</Cell>
                <Cell numeric>{money(currency, row.billTotal)}</Cell>
                <Cell numeric>{Number(row.tds) ? `${money(currency, row.tds)}${row.tdsSection ? ` (${row.tdsSection})` : ""}` : "—"}</Cell>
                <Cell numeric>{money(currency, row.amount)}</Cell>
              </tr>
            ))}
          </LinesTable>
          {!waiting && settled.length > 0 && Number(payment.tdsWithheld) > 0 && (
            <p className="mt-2 text-xs text-text-muted">TDS is withheld when each bill is booked; the payment advice shows it so the supplier can match it with Form 26AS.</p>
          )}
        </Panel>
        <Panel title="Details">
          <Facts items={[
            { label: "Paid from", value: payment.bankAccount ?? "The company's default bank account" },
            { label: "Supplier GSTIN", value: supplier.gstin ?? "—" },
            { label: "Supplier PAN", value: supplier.pan ?? "—" },
            ...(supplier.msme ? [{ label: "MSME", value: `${supplier.msme.classification}${supplier.msme.udyam ? ` · ${supplier.msme.udyam}` : ""}` }] : []),
            ...(payment.purchaseOrderNumber ? [{ label: "Against order", value: <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${payment.purchaseOrderId}`}>{payment.purchaseOrderNumber}</Link> }] : []),
            { label: "Recorded by", value: payment.createdBy ?? "—" },
            { label: "Note", value: payment.notes ?? "—" },
          ]} />
        </Panel>
      </RecordDetailsPage>
    </div>
  );
}
