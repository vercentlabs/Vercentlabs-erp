"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getPosSalesAnalytics, type PosSalesAnalytics } from "@/features/pos/analytics/api/analytics-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { money } from "@/features/pos/shared/format";

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

// F307 -- every figure here is a real aggregate over the same rows F303's
// Z reports and F304's reconciliation already treat as authoritative (see
// pos-analytics/reports.js's own header comment) — nothing here is mock
// data or a second calculation of an existing total.
export function PosAnalyticsScreen() {
  const workspace = useWorkspaceContext();
  const [dateFrom, setDateFrom] = useState(() => isoDaysAgo(30));
  const [dateTo, setDateTo] = useState(() => isoDaysAgo(0));
  const [storeId, setStoreId] = useState<string | undefined>(undefined);

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: () => listPosStores() });
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "analytics", dateFrom, dateTo, storeId),
    queryFn: () => getPosSalesAnalytics({ dateFrom, dateTo, storeId }),
    enabled: Boolean(dateFrom && dateTo),
  });

  const currency = "";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Analytics</h1>
        <p className="text-sm text-text-secondary">Real POS sales, tender, discount, return, reconciliation and accounting-posting analytics.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4">
        <TextField label="From" value={dateFrom} onChange={setDateFrom} />
        <TextField label="To" value={dateTo} onChange={setDateTo} />
        <Select
          label="Store"
          value={storeId ?? "all"}
          onChange={(value) => setStoreId(value === "all" || value == null ? undefined : String(value))}
          options={[{ value: "all", label: "All stores" }, ...(storesQuery.data?.rows ?? []).map((store) => ({ value: store.id, label: store.name }))]}
          className="min-w-[200px]"
        />
      </div>

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError || !query.data ? (
        <p className="text-sm text-danger">Analytics could not be loaded.</p>
      ) : (
        <AnalyticsBody data={query.data} currency={currency} />
      )}
    </div>
  );
}

function AnalyticsBody({ data, currency }: { data: PosSalesAnalytics; currency: string }) {
  return (
    <>
      <Section title="Summary">
        <Metrics
          items={[
            ["Transactions", String(data.summary.saleCount)],
            ["Gross sales", money(currency, data.summary.grossSales)],
            ["Net sales", money(currency, data.summary.netSales)],
            ["Discounts", money(currency, data.summary.discountTotal)],
            ["Tax", money(currency, data.summary.taxTotal)],
            ["Grand total", money(currency, data.summary.grandTotal)],
            ["Average order value", money(currency, data.summary.averageOrderValue)],
          ]}
        />
      </Section>

      <Section title="Store performance">
        <Table
          rows={data.byStore}
          columns={[
            { key: "store_name", label: "Store" },
            { key: "sale_count", label: "Sales" },
            { key: "grand_total", label: "Total", money: true },
          ]}
        />
      </Section>

      <Section title="Terminal performance">
        <Table
          rows={data.byTerminal}
          columns={[
            { key: "terminal_name", label: "Terminal" },
            { key: "sale_count", label: "Sales" },
            { key: "grand_total", label: "Total", money: true },
          ]}
        />
      </Section>

      <Section title="Cashier performance">
        <Table
          rows={data.byCashier}
          columns={[
            { key: "cashier_name", label: "Cashier" },
            { key: "sale_count", label: "Sales" },
            { key: "grand_total", label: "Total", money: true },
          ]}
        />
      </Section>

      <Section title="Product / category sales">
        <Table
          rows={data.byProduct.slice(0, 50)}
          columns={[
            { key: "item_name", label: "Item" },
            { key: "category_name", label: "Category" },
            { key: "quantity_sold", label: "Qty" },
            { key: "revenue", label: "Revenue", money: true },
          ]}
        />
      </Section>

      <Section title="Tender breakdown">
        <Table
          rows={data.tenderBreakdown}
          columns={[
            { key: "payment_method", label: "Method" },
            { key: "payment_count", label: "Count" },
            { key: "amount", label: "Amount", money: true },
          ]}
        />
      </Section>

      <Section title="Discounts, coupons and promotions">
        <Metrics
          items={[
            ["Promotion discounts", money(currency, data.discounts.promotionTotal)],
            ["Coupon discounts", money(currency, data.discounts.couponTotal)],
            ["Other (manual/cart/loyalty)", money(currency, data.discounts.otherTotal)],
          ]}
        />
      </Section>

      <Section title="Returns and refunds">
        <Metrics items={[["Return count", String(data.returns.count)], ["Refund total", money(currency, data.returns.refundTotal)]]} />
      </Section>

      <Section title="Cash variance">
        <Metrics items={[["Reports with variance", String(data.cashVariance.reportCount)], ["Variance total", money(currency, data.cashVariance.varianceTotal)]]} />
      </Section>

      <Section title="Reconciliation exceptions">
        <Metrics items={[["Unresolved variance rows", String(data.reconciliationExceptions.count)]]} />
      </Section>

      <Section title="Offline sync exceptions">
        <Metrics items={[["Pending", String(data.offlineSyncExceptions.pending)], ["Resolved", String(data.offlineSyncExceptions.resolved)]]} />
      </Section>

      <Section title="Accounting posting status">
        <Metrics
          items={Object.entries(data.accountingPostingStatus).map(([key, value]) => [key, String(value)] as [string, string])}
        />
      </Section>

      <Section title="Loyalty activity">
        <Metrics
          items={[
            ["Points earned", data.loyalty.pointsEarned],
            ["Points redeemed", data.loyalty.pointsRedeemed],
            ["Redeem value", money(currency, data.loyalty.redeemAmount)],
          ]}
        />
      </Section>

      {data.margin && (
        <Section title="Margin (tracked-inventory items only)">
          <Metrics
            items={[
              ["Costed lines", String(data.margin.costedLineCount)],
              ["Net revenue", money(currency, data.margin.netRevenue)],
              ["COGS", money(currency, data.margin.cogsTotal)],
              ["Gross margin", money(currency, data.margin.grossMargin)],
            ]}
          />
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
      <h2 className="mb-3 text-base font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

function Metrics({ items }: { items: Array<[string, string]> }) {
  if (!items.length) return <p className="text-sm text-text-muted">No data.</p>;
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs capitalize text-text-muted">{label}</dt>
          <dd className="text-lg font-semibold text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table<T extends Record<string, unknown>>({
  rows,
  columns,
}: {
  rows: T[];
  columns: Array<{ key: string; label: string; money?: boolean }>;
}) {
  if (!rows.length) return <p className="text-sm text-text-muted">No data.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-text-muted">
          {columns.map((column) => (
            <th key={column.key} className="pb-2">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-t border-border">
            {columns.map((column) => (
              <td key={column.key} className="py-2">
                {column.money ? money("", String(row[column.key] ?? "0")) : String(row[column.key] ?? "—")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
