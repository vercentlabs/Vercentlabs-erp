import { notFound } from "next/navigation";
import { loadSupplierPage } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

import { InvoiceUpload, OrderAnswer, RfqPrices } from "./SupplierAnswers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier page", robots: { index: false, follow: false } };

const money = (currency: string, value: string | number | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(Number(value));
const day = (value: string | null) => (value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "");
const quantity = (value: string) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });

type OrderView = {
  kind: "purchase_order"; company: string | null;
  order: { number: string; date: string; expectedDate: string | null; status: string; currencyCode: string; total: string; supplierName: string; acknowledgedAt: string | null;
    proposedDate: string | null; proposedNote: string | null };
  lines: Array<{ number: number; name: string; quantity: string; unit: string | null; rate: string; expectedDate: string | null }>;
  invoices: Array<{ number: string; date: string; total: string | null; status: string }>;
  actions: { confirm: boolean; propose: boolean; invoice: boolean };
};
type RfqView = {
  kind: "rfq"; company: string | null;
  rfq: { number: string; title: string | null; dueDate: string | null; currencyCode: string; supplierName: string; status: string; quotedAt: string | null; quotationNumber: string | null };
  lines: Array<{ id: string; number: number; name: string; description: string | null; quantity: string; unit: string | null; requiredBy: string | null }>;
  actions: { quote: boolean };
};

// The supplier's page for an order or a price request (Procurement report H5), opened from the link sent to them. The token in the link
// is the only credential; an unknown or revoked link, or a company without Procurement, is not found.
export default async function SupplierPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = (await ingressTransaction((client) => loadSupplierPage(client, token)).catch(() => null)) as OrderView | RfqView | null;
  if (!view) notFound();
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8 max-lg:pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6">
        {view.kind === "purchase_order" ? <OrderSection token={token} view={view} /> : <RfqSection token={token} view={view} />}
      </div>
    </main>
  );
}

function OrderSection({ token, view }: { token: string; view: OrderView }) {
  const { order } = view;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-text-muted uppercase">{view.company}</p>
          <h1 className="text-xl font-semibold text-text">Purchase order {order.number}</h1>
          <p className="text-sm text-text-secondary">For {order.supplierName} · {day(order.date)}{order.expectedDate ? ` · needed by ${day(order.expectedDate)}` : ""}</p>
        </div>
        <a href={`/api/procurement/public/purchase-orders/${token}/pdf`} className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover">
          Download PDF
        </a>
      </div>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {view.lines.map((line) => (
          <li key={line.number} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
            <span className="font-medium text-text">{line.name}{line.expectedDate ? <span className="block text-xs font-normal text-text-muted">By {day(line.expectedDate)}</span> : null}</span>
            <span className="tabular-nums text-text-secondary">{quantity(line.quantity)} {line.unit ?? ""} × {money(order.currencyCode, line.rate)}</span>
          </li>
        ))}
      </ul>
      <p className="text-right text-base font-semibold tabular-nums text-text">Total {money(order.currencyCode, order.total)}</p>
      {order.acknowledgedAt && <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">You confirmed this order. Thank you.</p>}
      {order.proposedDate && <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">You proposed delivery on {day(order.proposedDate)}{order.proposedNote ? `: ${order.proposedNote}` : ""}.</p>}
      {(view.actions.confirm || view.actions.propose) && <OrderAnswer token={token} canConfirm={view.actions.confirm} expectedDate={order.expectedDate} />}
      {view.actions.invoice && <InvoiceUpload token={token} />}
      {view.invoices.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm">
          <p className="font-medium text-text">Invoices you sent</p>
          {view.invoices.map((invoice) => (
            <p key={`${invoice.number}-${invoice.date}`} className="text-text-secondary">{invoice.number} · {day(invoice.date)}{invoice.total ? ` · ${money(order.currencyCode, invoice.total)}` : ""} · received</p>
          ))}
        </div>
      )}
    </>
  );
}

function RfqSection({ token, view }: { token: string; view: RfqView }) {
  const { rfq } = view;
  return (
    <>
      <div>
        <p className="text-xs tracking-wide text-text-muted uppercase">{view.company}</p>
        <h1 className="text-xl font-semibold text-text">Price request {rfq.number}</h1>
        <p className="text-sm text-text-secondary">For {rfq.supplierName}{rfq.title ? ` · ${rfq.title}` : ""}{rfq.dueDate ? ` · reply by ${day(rfq.dueDate)}` : ""}</p>
      </div>
      {rfq.quotedAt ? <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">Your prices were received (quotation {rfq.quotationNumber}). Thank you.</p>
        : rfq.status !== "sent" ? <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">This price request is closed.</p>
          : <RfqPrices token={token} currencyCode={rfq.currencyCode} lines={view.lines.map((line) => ({ ...line, quantityText: `${quantity(line.quantity)} ${line.unit ?? ""}`, requiredByText: line.requiredBy ? day(line.requiredBy) : null }))} />}
    </>
  );
}
