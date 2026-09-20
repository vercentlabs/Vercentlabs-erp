"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, MetricStrip, PageHeader, Select, Tab, TabList, TabPanel, Tabs, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getPosSalesAnalytics, type PosSalesAnalytics } from "@/features/pos/analytics/api/analytics-api";
import { listPosEligibleCashiers } from "@/features/pos/cashiers/api/cashiers-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals } from "@/features/pos/terminals/api/terminals-api";
import { PosApiError } from "@/features/pos/shared/http";
import { money, statusLabel } from "@/features/pos/shared/format";
import { PosDataTable, PosFacts, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const ALL = "all";

// F307 -- every figure here is a real aggregate over the same rows F303's
// Z reports and F304's reconciliation already treat as authoritative (see
// pos-analytics/reports.js's own header comment) — nothing here is mock
// data or a second calculation of an existing total.
//
// Store / terminal / cashier drilldown maps 1:1 onto the filters
// getPosSalesAnalytics already accepts server-side; the terminal list is
// narrowed to the chosen store so an impossible store+terminal pairing
// can't be requested.
export function PosAnalyticsScreen() {
  const workspace = useWorkspaceContext();
  const [dateFrom, setDateFrom] = useState(() => isoDaysAgo(30));
  const [dateTo, setDateTo] = useState(() => isoDaysAgo(0));
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [terminalId, setTerminalId] = useState<string | undefined>(undefined);
  const [cashierId, setCashierId] = useState<string | undefined>(undefined);

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: () => listPosStores() });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  // Listing cashiers is a manage-level read; a viewer without it simply
  // doesn't get the cashier filter (retry off so that isn't a slow failure).
  const cashiersQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers"), queryFn: listPosEligibleCashiers, retry: false });
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "analytics", dateFrom, dateTo, storeId, terminalId, cashierId),
    queryFn: () => getPosSalesAnalytics({ dateFrom, dateTo, storeId, terminalId, cashierId }),
    enabled: Boolean(dateFrom && dateTo),
  });

  const storeOptions: SelectOption[] = useMemo(
    () => [{ value: ALL, label: "All stores" }, ...(storesQuery.data?.rows ?? []).map((store) => ({ value: store.id, label: store.name }))],
    [storesQuery.data],
  );
  const terminalOptions: SelectOption[] = useMemo(
    () => [
      { value: ALL, label: "All terminals" },
      ...(terminalsQuery.data?.rows ?? [])
        .filter((terminal) => !storeId || (terminal.storeId ?? terminal.store_id) === storeId)
        .map((terminal) => ({ value: terminal.id, label: terminal.name })),
    ],
    [terminalsQuery.data, storeId],
  );
  const cashierOptions: SelectOption[] = useMemo(
    () => [{ value: ALL, label: "All cashiers" }, ...(cashiersQuery.data?.rows ?? []).map((cashier) => ({ value: cashier.id, label: cashier.fullName }))],
    [cashiersQuery.data],
  );

  const hasFilters = Boolean(storeId || terminalId || cashierId);
  function clearFilters() {
    setStoreId(undefined);
    setTerminalId(undefined);
    setCashierId(undefined);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Analytics" description="Real POS sales, tender, discount, return, reconciliation and accounting-posting analytics." />

      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-subtle)]">
        <TextField label="From" type="date" size="compact" value={dateFrom} onChange={setDateFrom} />
        <TextField label="To" type="date" size="compact" value={dateTo} onChange={setDateTo} />
        <Select
          label="Store"
          size="compact"
          options={storeOptions}
          selectedKey={storeId ?? ALL}
          onSelectionChange={(key) => {
            setStoreId(key === ALL || key == null ? undefined : String(key));
            setTerminalId(undefined);
          }}
          className="min-w-[180px]"
        />
        <Select
          label="Terminal"
          size="compact"
          options={terminalOptions}
          selectedKey={terminalId ?? ALL}
          onSelectionChange={(key) => setTerminalId(key === ALL || key == null ? undefined : String(key))}
          className="min-w-[180px]"
        />
        {cashiersQuery.isSuccess && (
          <Select
            label="Cashier"
            size="compact"
            options={cashierOptions}
            selectedKey={cashierId ?? ALL}
            onSelectionChange={(key) => setCashierId(key === ALL || key == null ? undefined : String(key))}
            className="min-w-[180px]"
          />
        )}
        {hasFilters && (
          <Button variant="ghost" size="compact" onPress={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {query.isLoading ? (
        <PosLoading label="Loading analytics…" />
      ) : query.isError || !query.data ? (
        <ErrorState
          title="Analytics could not be loaded"
          description={query.error instanceof PosApiError ? query.error.message : "Something went wrong."}
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      ) : (
        <AnalyticsBody data={query.data} />
      )}
    </div>
  );
}

const currency = "";

const SALES_COLUMNS = [
  { key: "sale_count", header: "Sales", numeric: true },
  { key: "grand_total", header: "Total", numeric: true, render: (row: Record<string, unknown>) => money(currency, String(row.grand_total ?? "0")) },
];

function AnalyticsBody({ data }: { data: PosSalesAnalytics }) {
  return (
    <div className="flex flex-col gap-6">
      <MetricStrip
        metrics={[
          { label: "Transactions", value: data.summary.saleCount.toLocaleString() },
          { label: "Gross sales", value: money(currency, data.summary.grossSales) },
          { label: "Discounts", value: money(currency, data.summary.discountTotal) },
          { label: "Net sales", value: money(currency, data.summary.netSales) },
          { label: "Grand total", value: money(currency, data.summary.grandTotal) },
          { label: "Average order value", value: money(currency, data.summary.averageOrderValue) },
        ]}
      />

      <Tabs>
        <TabList aria-label="Analytics sections">
          <Tab id="performance">Performance</Tab>
          <Tab id="products">Products</Tab>
          <Tab id="payments">Payments &amp; discounts</Tab>
          <Tab id="operations">Operations</Tab>
        </TabList>

        <TabPanel id="performance" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <PosPanel title="By store">
              <PosDataTable rows={data.byStore} columns={[{ key: "store_name", header: "Store" }, ...SALES_COLUMNS]} />
            </PosPanel>
            <PosPanel title="By terminal">
              <PosDataTable rows={data.byTerminal} columns={[{ key: "terminal_name", header: "Terminal" }, ...SALES_COLUMNS]} />
            </PosPanel>
            <PosPanel title="By cashier">
              <PosDataTable rows={data.byCashier} columns={[{ key: "cashier_name", header: "Cashier" }, ...SALES_COLUMNS]} />
            </PosPanel>
          </div>
        </TabPanel>

        <TabPanel id="products">
          <PosPanel title="Product / category sales" description={data.byProduct.length > 50 ? `Top 50 of ${data.byProduct.length} items by revenue.` : undefined}>
            <PosDataTable
              rows={data.byProduct.slice(0, 50)}
              columns={[
                { key: "item_name", header: "Item" },
                { key: "category_name", header: "Category" },
                { key: "quantity_sold", header: "Qty", numeric: true },
                { key: "revenue", header: "Revenue", numeric: true, render: (row) => money(currency, row.revenue) },
              ]}
            />
          </PosPanel>
        </TabPanel>

        <TabPanel id="payments" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PosPanel title="Tender breakdown">
              <PosDataTable
                rows={data.tenderBreakdown}
                columns={[
                  { key: "payment_method", header: "Method", render: (row) => statusLabel(row.payment_method) },
                  { key: "payment_count", header: "Count", numeric: true },
                  { key: "amount", header: "Amount", numeric: true, render: (row) => money(currency, row.amount) },
                ]}
              />
            </PosPanel>
            <PosPanel title="Discounts, coupons and promotions">
              <PosFacts
                columns={2}
                items={[
                  { label: "Tax collected", value: money(currency, data.summary.taxTotal) },
                  { label: "Promotion discounts", value: money(currency, data.discounts.promotionTotal) },
                  { label: "Coupon discounts", value: money(currency, data.discounts.couponTotal) },
                  { label: "Other (manual / cart / loyalty)", value: money(currency, data.discounts.otherTotal) },
                ]}
              />
            </PosPanel>
            <PosPanel title="Returns and refunds">
              <PosFacts columns={2} items={[{ label: "Returns", value: data.returns.count.toLocaleString() }, { label: "Refund total", value: money(currency, data.returns.refundTotal) }]} />
            </PosPanel>
            <PosPanel title="Loyalty activity">
              <PosFacts
                columns={3}
                items={[
                  { label: "Points earned", value: data.loyalty.pointsEarned },
                  { label: "Points redeemed", value: data.loyalty.pointsRedeemed },
                  { label: "Redeem value", value: money(currency, data.loyalty.redeemAmount) },
                ]}
              />
            </PosPanel>
          </div>
        </TabPanel>

        <TabPanel id="operations" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PosPanel title="Cash variance">
              <PosFacts columns={2} items={[{ label: "Reports with variance", value: data.cashVariance.reportCount.toLocaleString() }, { label: "Variance total", value: money(currency, data.cashVariance.varianceTotal) }]} />
            </PosPanel>
            <PosPanel title="Reconciliation exceptions">
              <PosFacts columns={2} items={[{ label: "Unresolved variance rows", value: data.reconciliationExceptions.count.toLocaleString() }]} />
            </PosPanel>
            <PosPanel title="Offline sync exceptions">
              <PosFacts columns={2} items={[{ label: "Pending", value: data.offlineSyncExceptions.pending.toLocaleString() }, { label: "Resolved", value: data.offlineSyncExceptions.resolved.toLocaleString() }]} />
            </PosPanel>
            <PosPanel title="Accounting posting status">
              {Object.keys(data.accountingPostingStatus).length ? (
                <PosFacts columns={3} items={Object.entries(data.accountingPostingStatus).map(([status, count]) => ({ label: statusLabel(status), value: String(count) }))} />
              ) : (
                <p className="text-sm text-text-muted">No postings in this range.</p>
              )}
            </PosPanel>
            {data.margin && (
              <PosPanel title="Margin" description="Tracked-inventory items only — lines with a traceable cost." className="lg:col-span-2">
                <PosFacts
                  columns={4}
                  items={[
                    { label: "Costed lines", value: data.margin.costedLineCount.toLocaleString() },
                    { label: "Net revenue", value: money(currency, data.margin.netRevenue) },
                    { label: "COGS", value: money(currency, data.margin.cogsTotal) },
                    { label: "Gross margin", value: money(currency, data.margin.grossMargin) },
                  ]}
                />
              </PosPanel>
            )}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
