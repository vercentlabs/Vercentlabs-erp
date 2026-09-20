"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Check, Copy, Pencil, Send, ShoppingCart, X } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, MetricStrip, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import {
  approveSalesQuotation,
  compareSalesQuotationVersions,
  convertSalesQuotation,
  getSalesQuotation,
  rejectSalesQuotationApproval,
  sendSalesQuotation,
  submitSalesQuotation,
  type SalesQuotationLine,
  type SalesQuotationVersionSummary,
} from "@/features/sales/quotations/api/quotations-api";

type Comparison = {
  changedFields: string[];
  totals: { grandTotal: number; discountTotal: number; taxTotal: number; lineCount: number };
  left: { version_number: number; grand_total: string };
  right: { version_number: number; grand_total: string };
};

// F036-F041 -- the quotation record. Which actions appear follows the
// quotation's real lifecycle state and the caller's permissions; the server
// re-checks both, so hiding a button is convenience, never the control.
export function SalesQuotationDetailScreen({ quotationId }: { quotationId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);

  const [actionError, setActionError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const key = scopedQueryKey(workspace, "sales", "quotation", quotationId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => getSalesQuotation(quotationId).then((r) => r.quotation),
    retry: (count, error) => !(error instanceof SalesApiError && [403, 404].includes(error.status)) && count < 2,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "quotations") });
  }
  const onError = (err: unknown) => setActionError(err instanceof SalesApiError ? err.message : "This action could not be completed.");

  const submitMutation = useMutation({ mutationFn: () => submitSalesQuotation(quotationId), onSuccess: () => { setActionError(null); refresh(); }, onError });
  const approveMutation = useMutation({
    mutationFn: () => approveSalesQuotation(quotationId, query.data!.quotation.current_version_id),
    onSuccess: () => { setActionError(null); refresh(); },
    onError,
  });
  const rejectMutation = useMutation({ mutationFn: () => rejectSalesQuotationApproval(quotationId), onSuccess: () => { setActionError(null); refresh(); }, onError });
  const sendMutation = useMutation({
    mutationFn: () => sendSalesQuotation(quotationId),
    onSuccess: ({ result }) => {
      setActionError(null);
      // The link's token is only ever returned once, at send time (the server
      // stores just its hash), so this dialog is the only place to copy it.
      setShareLink({ url: `${window.location.origin}/quote/${result.token}`, expiresAt: result.expiresAt });
      refresh();
    },
    onError,
  });
  const convertMutation = useMutation({
    mutationFn: () => convertSalesQuotation(quotationId),
    onSuccess: ({ result }) => {
      setActionError(null);
      refresh();
      router.push(`/sales/orders/${result.orderId}`);
    },
    onError,
  });
  const compareMutation = useMutation({
    mutationFn: ({ left, right }: { left: string; right: string }) => compareSalesQuotationVersions(quotationId, left, right),
    onSuccess: ({ comparison: result }) => setComparison(result as Comparison),
    onError,
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading quotation…</p>;
  if (query.isError || !query.data) {
    if (query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to this quotation" />;
    if (query.error instanceof SalesApiError && query.error.status === 404) return <ErrorState title="Quotation not found" action={{ label: "Back to quotations", onPress: () => router.push("/sales/quotations") }} />;
    return <ErrorState title="Could not load this quotation" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const detail = query.data;
  const quote = detail.quotation;
  const currency = quote.currency_code;
  const state = quote.lifecycle_status;
  const showMargin = quote.margin_percent !== undefined;

  const lineColumns: ColumnDef<SalesQuotationLine, unknown>[] = [
    { id: "item", header: "Item", accessorFn: (line) => `${line.item_name_snapshot} (${line.item_code_snapshot})` },
    { id: "qty", header: "Qty", accessorFn: (line) => `${Number(line.quantity)}${line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}` },
    { id: "price", header: "Unit price", accessorFn: (line) => money(currency, line.unit_price) },
    { id: "discount", header: "Discount", accessorFn: (line) => (Number(line.discount_percent) > 0 ? `${Number(line.discount_percent)}%` : "—") },
    { id: "tax", header: "Tax", accessorFn: (line) => money(currency, line.tax_amount) },
    { id: "total", header: "Line total", accessorFn: (line) => money(currency, line.line_total) },
  ];
  const versionColumns: ColumnDef<SalesQuotationVersionSummary, unknown>[] = [
    { id: "v", header: "Version", accessorFn: (version) => `v${version.version_number}${version.id === quote.current_version_id ? " (current)" : ""}` },
    { id: "reason", header: "Reason", accessorFn: (version) => version.revision_reason ?? "Initial version" },
    { id: "total", header: "Total", accessorFn: (version) => money(version.currency_code, version.grand_total) },
    { id: "when", header: "Created", accessorFn: (version) => dateTime(version.created_at) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/quotations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All quotations
      </Link>

      <RecordDetailsPage
        header={{
          title: quote.quotation_number,
          status: <StatusBadge tone={statusTone(state)}>{statusLabel(state)}</StatusBadge>,
          fields: [
            { label: "Customer", value: quote.customer_snapshot?.displayName ?? "—" },
            { label: "Version", value: `v${quote.version_number}` },
            { label: "Valid until", value: calendarDate(quote.valid_until) },
          ],
          primaryAction:
            state === "draft" && can(SALES_PERMISSIONS.quotationCreate) ? (
              <Button variant="primary" onPress={() => submitMutation.mutate()} isLoading={submitMutation.isPending}>
                Submit for approval
              </Button>
            ) : state === "pending_approval" && can(SALES_PERMISSIONS.quotationApprove) ? (
              <Button variant="primary" onPress={() => approveMutation.mutate()} isLoading={approveMutation.isPending}>
                <Check className="size-4" aria-hidden="true" />
                Approve
              </Button>
            ) : state === "approved" && can(SALES_PERMISSIONS.quotationSend) ? (
              <Button variant="primary" onPress={() => sendMutation.mutate()} isLoading={sendMutation.isPending}>
                <Send className="size-4" aria-hidden="true" />
                Send to customer
              </Button>
            ) : (state === "sent" || state === "viewed") && can(SALES_PERMISSIONS.quotationSend) ? (
              <Button variant="secondary" onPress={() => sendMutation.mutate()} isLoading={sendMutation.isPending}>
                <Send className="size-4" aria-hidden="true" />
                Re-send (new link)
              </Button>
            ) : state === "accepted" && can(SALES_PERMISSIONS.orderCreate) ? (
              quote.converted_order_id ? (
                <Button variant="primary" onPress={() => router.push(`/sales/orders/${quote.converted_order_id}`)}>
                  <ShoppingCart className="size-4" aria-hidden="true" />
                  Open sales order
                </Button>
              ) : (
                <Button variant="primary" onPress={() => convertMutation.mutate()} isLoading={convertMutation.isPending}>
                  <ShoppingCart className="size-4" aria-hidden="true" />
                  Convert to sales order
                </Button>
              )
            ) : undefined,
          secondaryActions: (
            <div className="flex items-center gap-2">
              {state === "pending_approval" && can(SALES_PERMISSIONS.quotationApprove) && (
                <Button variant="secondary" onPress={() => rejectMutation.mutate()} isLoading={rejectMutation.isPending}>
                  <X className="size-4" aria-hidden="true" />
                  Send back to draft
                </Button>
              )}
              {["draft", "approved", "sent", "viewed", "rejected", "expired"].includes(state) && can(SALES_PERMISSIONS.quotationCreate) && (
                <Button variant="secondary" onPress={() => router.push(`/sales/quotations/${quotationId}/revise`)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Revise
                </Button>
              )}
            </div>
          ),
        }}
      >
        {actionError && <SalesAlert>{actionError}</SalesAlert>}
        {state === "pending_approval" && <SalesAlert tone="info">This quotation needs approval by someone other than its author before it can be sent.</SalesAlert>}

        <MetricStrip
          metrics={[
            { label: "Grand total", value: money(currency, quote.grand_total) },
            { label: "Subtotal", value: money(currency, quote.subtotal) },
            { label: "Discounts", value: money(currency, quote.discount_total) },
            { label: "Tax", value: money(currency, quote.tax_total) },
            ...(showMargin ? [{ label: "Margin", value: `${Number(quote.margin_percent).toFixed(1)}%` }] : []),
          ]}
        />

        <Tabs>
          <TabList aria-label="Quotation sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="versions">Versions ({detail.versions.length})</Tab>
            <Tab id="activity">Activity</Tab>
          </TabList>

          <TabPanel id="overview" className="flex flex-col gap-4">
            <SalesPanel title="Items">
              <EnterpriseDataGrid<SalesQuotationLine> aria-label="Quotation items" columns={lineColumns} data={detail.lines} getRowId={(line) => line.id} density="compact" />
            </SalesPanel>
            {detail.charges.length > 0 && (
              <SalesPanel title="Charges">
                <SalesFacts columns={3} items={detail.charges.map((charge) => ({ label: charge.label, value: money(currency, charge.amount) }))} />
              </SalesPanel>
            )}
            <SalesPanel title="Terms">
              <SalesFacts
                columns={2}
                items={[
                  { label: "Payment terms", value: quote.payment_term_snapshot?.name ?? "—" },
                  { label: "Delivery terms", value: quote.delivery_terms ?? "—" },
                  { label: "Notes for the customer", value: quote.customer_notes ?? "—" },
                  { label: "Terms and conditions", value: quote.terms_and_conditions ?? "—" },
                  { label: "Internal notes", value: quote.internal_notes ?? "—" },
                ]}
              />
            </SalesPanel>
          </TabPanel>

          <TabPanel id="versions" className="flex flex-col gap-4">
            <SalesPanel title="Version history" description="Every version is kept exactly as saved. Select two to compare.">
              <EnterpriseDataGrid<SalesQuotationVersionSummary>
                aria-label="Quotation versions"
                columns={versionColumns}
                data={detail.versions}
                getRowId={(version) => version.id}
                density="compact"
                rowActions={(version) => {
                  const previous = detail.versions.find((candidate) => candidate.version_number === version.version_number - 1);
                  return previous ? (
                    <Button variant="ghost" size="compact" onPress={() => compareMutation.mutate({ left: previous.id, right: version.id })} isLoading={compareMutation.isPending}>
                      Compare with v{previous.version_number}
                    </Button>
                  ) : null;
                }}
              />
            </SalesPanel>
            {comparison && (
              <SalesPanel title={`v${comparison.left.version_number} → v${comparison.right.version_number}`} description="What changed between these two versions.">
                <SalesFacts
                  columns={4}
                  items={[
                    { label: "Total change", value: money(currency, comparison.totals.grandTotal) },
                    { label: "Discount change", value: money(currency, comparison.totals.discountTotal) },
                    { label: "Tax change", value: money(currency, comparison.totals.taxTotal) },
                    { label: "Line count change", value: comparison.totals.lineCount },
                  ]}
                />
                <p className="text-sm text-text-secondary">Changed fields: {comparison.changedFields.length ? comparison.changedFields.map((field) => field.replace(/_/g, " ")).join(", ") : "none"}.</p>
              </SalesPanel>
            )}
          </TabPanel>

          <TabPanel id="activity">
            <SalesPanel title="Activity">
              {detail.events.length === 0 ? (
                <p className="text-sm text-text-muted">No activity recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {detail.events.map((event, index) => (
                    <li key={`${event.occurred_at}-${index}`} className="flex flex-col gap-0.5 py-2 text-sm">
                      <span className="font-medium text-text">{statusLabel(event.event_type.replace(/^quotation\./, ""))}</span>
                      <span className="text-xs text-text-muted">
                        {event.from_status && event.to_status ? `${statusLabel(event.from_status)} → ${statusLabel(event.to_status)} · ` : ""}
                        {dateTime(event.occurred_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SalesPanel>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {shareLink && (
        <Dialog isOpen onOpenChange={(open) => !open && setShareLink(null)} title="Quotation sent">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              Share this link with the customer so they can review and accept or decline. It is shown only now — the system keeps just a hash of it — and expires {dateTime(shareLink.expiresAt)}.
            </p>
            <div className="flex items-center gap-2">
              <input readOnly aria-label="Customer link" value={shareLink.url} className="h-[var(--control-height-standard)] flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text" onFocus={(event) => event.currentTarget.select()} />
              <Button variant="secondary" onPress={() => navigator.clipboard?.writeText(shareLink.url)}>
                <Copy className="size-4" aria-hidden="true" />
                Copy
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onPress={() => setShareLink(null)}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
