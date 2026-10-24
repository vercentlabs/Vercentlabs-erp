"use client";

// What the supplier did on their page for this order (Procurement report H5): whether they opened it, a date they proposed, and the
// invoices they sent (with the draft bill made from each, when there was something to bill).
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Notice, Panel } from "@/shared/ui/Panel";
import { request } from "@/features/procurement/shared/http";
import { calendarDate, money } from "@/features/procurement/shared/format";

type Activity = {
  reminders: Array<{ kind: "before" | "overdue"; runOn: string; status: "sent" | "previewed"; recipients: string }>;
  views: number; lastViewedAt: string | null; proposedDate: string | null; proposedNote: string | null;
  invoices: Array<{ number: string; date: string; total: string | null; status: string; note: string | null; billId: string | null; billNumber: string | null; at: string }>;
};

export function SupplierPagePanel({ orderId, currencyCode }: { orderId: string; currencyCode: string }) {
  const query = useQuery({ queryKey: ["procurement", "supplier-page", orderId], queryFn: () => request<{ activity: Activity }>(`/purchase-orders/${orderId}/supplier-page`).then((result) => result.activity) });
  const activity = query.data;
  if (!activity || (!activity.views && !activity.proposedDate && !activity.invoices.length && !activity.reminders.length)) return null;
  return (
    <Panel title="Supplier's page" description="What the supplier did through the link sent to them.">
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-text-secondary">{activity.views ? `Opened ${activity.views} time${activity.views === 1 ? "" : "s"}${activity.lastViewedAt ? `, last on ${calendarDate(String(activity.lastViewedAt).slice(0, 10))}` : ""}.` : "Not opened yet."}</p>
        {activity.reminders.map((reminder) => (
          <p key={`${reminder.kind}-${reminder.status}`} className="text-text-secondary">
            {reminder.status === "previewed" ? "Would have reminded" : "Reminded"} {reminder.recipients} {reminder.kind === "before" ? "before the expected date" : "after the expected date"} on {calendarDate(reminder.runOn)}.
          </p>
        ))}
        {activity.proposedDate && <Notice tone="warning">The supplier proposes delivery on {calendarDate(activity.proposedDate)}{activity.proposedNote ? `: ${activity.proposedNote}` : ""}. Change the order if you agree.</Notice>}
        {activity.invoices.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {activity.invoices.map((invoice) => (
              <li key={`${invoice.number}-${invoice.at}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span>Invoice {invoice.number} · {calendarDate(invoice.date)}{invoice.total ? ` · ${money(currencyCode, invoice.total)}` : ""}
                  <span className="block text-xs text-text-muted">{invoice.billId ? "A draft bill was started from it." : invoice.note ? `Waiting for a bill: ${invoice.note}` : "Waiting for a bill."}</span></span>
                {invoice.billId ? <Link className="text-brand hover:underline" href={`/procurement/supplier-bills/${invoice.billId}`}>{invoice.billNumber ?? "Open bill"}</Link>
                  : <Link className="text-brand hover:underline" href={`/procurement/supplier-bills/new?source=po&purchaseOrderId=${orderId}`}>Create the bill</Link>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
