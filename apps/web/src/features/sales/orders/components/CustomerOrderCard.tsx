"use client";

// The customer beside the order form (Sales plan, Flow 1): GSTIN, what it owes and how much is overdue, the credit left and the last order —
// read before the order is taken, not discovered at confirmation. Figures the person may not see are left out.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { calendarDate, money } from "@/features/sales/shared/format";
import { getCustomer, getCustomerOverview } from "@/features/sales/customers/api/customers-api";

export function CustomerOrderCard({ partyId }: { partyId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-overview", partyId), queryFn: () => getCustomerOverview(partyId), retry: false, staleTime: 30_000 });
  const customer = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "order-card-customer", partyId), queryFn: () => getCustomer(partyId), retry: false, staleTime: 30_000 });
  const gstin = customer.data?.gstin ?? null;
  const overview = query.data;
  if (!overview) return null;
  const finance = overview.finance;
  const credit = overview.credit;
  const currency = credit?.currencyCode ?? finance?.currencyCode ?? "INR";
  return (
    <Panel title="Customer" description={<Link className="text-brand hover:underline" href={`/sales/customers/${partyId}`}>Open the customer</Link>}>
      <Facts items={[
        { label: "GSTIN", value: gstin || "Unregistered" },
        ...(finance ? [{ label: "Outstanding", value: money(finance.currencyCode ?? currency, finance.outstanding) },
          { label: "Overdue", value: <span className={finance.overdue > 0.005 ? "text-danger" : undefined}>{money(finance.currencyCode ?? currency, finance.overdue)}</span> }] : []),
        ...(credit ? [{ label: "Credit left", value: credit.availableCredit == null ? "No limit" : money(currency, credit.availableCredit) }] : []),
        { label: "Last order", value: overview.sales?.lastOrderDate ? calendarDate(overview.sales.lastOrderDate) : "None yet" },
      ]} />
      {credit && (credit.overLimit || credit.overdueTooLong) && credit.control !== "off" && (
        <Notice tone="warning">{credit.overLimit ? "Already over the credit limit" : `A bill is overdue ${credit.overdueDays} days`}: the order will be {credit.control === "block" ? "held for credit" : "confirmed with a warning"}.</Notice>
      )}
    </Panel>
  );
}
