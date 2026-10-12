"use client";

// POS discounts this month, from finished sales and completed returns only: automatic promotions, cashiers' item discounts, bill discounts
// and coupons kept apart; what supervisors approved; what returns gave back; by outlet, item, reason, customer and — for those who may read
// POS reports — by cashier. A customer's contracted price is a price, not a discount, so it is not here.
import { useQuery } from "@tanstack/react-query";
import type { PosDiscountSummary } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const REASON: Record<string, string> = {
  CUSTOMER_GOODWILL: "Customer goodwill", DAMAGED_PACKAGING: "Damaged packaging", MINOR_DEFECT: "Minor defect", PRICE_MATCH: "Price match",
  COMPLAINT: "Complaint", MANAGER_SPECIAL: "Manager special", OTHER: "Other", NOT_RECORDED: "Not recorded", BULK_PURCHASE: "Bulk purchase",
  SPECIAL_NEGOTIATION: "Special negotiation", PROMOTIONAL_EXCEPTION: "Promotional exception",
};

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-muted">
          <tr>{head.map((label, index) => <th key={label} className={`pb-1 ${index === 0 ? "text-left" : "text-right"}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`py-1.5 pr-2 ${cellIndex === 0 ? "" : "text-right tabular-nums"}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DiscountReport() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "discount-summary"),
    queryFn: () => request<{ summary: PosDiscountSummary }>("/reports/discounts").then((response) => response.summary),
  });
  const data = query.data;
  if (!data) return null;
  const m = (value: string) => money(data.currency, value);
  const t = data.totals;
  return (
    <PosPanel title="Discounts" description={`${data.from} to ${data.to}. From finished sales and completed returns.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Automatic offers", m(t.automatic)], ["Item discounts", `${m(t.manual)} · ${t.manual_lines} line(s)`], ["Bill discounts", m(t.cart)],
          ["Supervisor-approved", `${m(t.approved_amount)} · ${t.approved_lines}`], ["Coupons", m(t.coupon)], ["Discounted sales", String(t.discounted_sales)],
          ["Given back by returns", m(t.returned)], ["Net discounts", m(t.net)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table head={["Reason", "Lines", "Item discounts"]} rows={data.byReason.map((entry) => [REASON[entry.reason] ?? entry.reason, entry.lines, m(entry.manual)])} />
        <Table head={["Outlet", "Automatic", "Item", "Bill"]} rows={data.byOutlet.map((entry) => [entry.name || entry.code, m(entry.automatic), m(entry.manual), m(entry.cart)])} />
        <Table head={["Item", "Automatic", "Item disc.", "Bill"]} rows={data.byItem.slice(0, 10).map((entry) => [entry.name, m(entry.automatic), m(entry.manual), m(entry.cart)])} />
        <Table head={["Customer", "Automatic", "Item disc.", "Bill"]} rows={data.byCustomer.map((entry) => [entry.name ?? "—", m(entry.automatic), m(entry.manual), m(entry.cart)])} />
        {data.byCashier && (
          <Table head={["Cashier", "Lines", "Item discounts", "Approved"]} rows={data.byCashier.map((entry) => [entry.name, entry.manual_lines, m(entry.manual), entry.approved_lines])} />
        )}
      </div>
      {data.cart && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-sm font-medium text-text">Cart discounts</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Sales with a cart discount", String(data.cart.totals.sales)], ["Cart discounts", m(data.cart.totals.amount)], ["Average", m(data.cart.totals.average)],
              ["Supervisor-approved", `${m(data.cart.totals.approved_amount)} · ${data.cart.totals.approved_sales}`], ["Given back by returns", m(data.cart.totals.returned)],
              ["Net cart discounts", m(data.cart.totals.net)], ["All manual discounts", m(data.cart.totals.manual_exposure)]].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
                <p className="text-xs text-text-muted">{label}</p>
                <p className="text-base font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Table head={["Reason", "Sales", "Cart discounts"]} rows={data.cart.byReason.map((entry) => [REASON[entry.reason] ?? entry.reason, entry.sales, m(entry.amount)])} />
            <Table head={["Date", "Sales", "Cart discounts"]} rows={data.cart.byDate.map((entry) => [entry.date, entry.sales, m(entry.amount)])} />
            {data.cart.byCashier && (
              <Table head={["Cashier", "Sales", "Cart discounts", "Approved"]} rows={data.cart.byCashier.map((entry) => [entry.name, entry.sales, m(entry.amount), entry.approved_sales])} />
            )}
          </div>
        </div>
      )}
    </PosPanel>
  );
}
