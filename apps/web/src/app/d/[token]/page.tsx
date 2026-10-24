import { notFound } from "next/navigation";
import { loadSharedDocument } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

import { AcceptQuotationForm } from "./AcceptQuotationForm";
import { PayOnlineButton } from "./PayOnlineButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your document", robots: { index: false, follow: false } };

const money = (currency: string, value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(value);
const day = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "");

type Line = { description: string; quantity: number; unit: string | null; unitPrice: number; taxRate: number; lineTotal: number };

// The customer's page for a quotation or invoice shared from Sales (Sales audit: customer portal): the document, its PDF, and answering the
// quotation (accept and sign, ask for changes, decline) or paying the invoice by UPI. The token in the link is the only credential; an unknown or revoked link is not found.
export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await ingressTransaction((client) => loadSharedDocument(client, token)).catch(() => null);
  if (!view) notFound();
  const quotation = view.kind === "quotation";
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8 max-lg:pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-wide text-text-muted uppercase">{view.company}</p>
            <h1 className="text-xl font-semibold text-text">{quotation ? "Quotation" : "Invoice"} {view.number}</h1>
            <p className="text-sm text-text-secondary">
              {view.customer ? `For ${view.customer} · ` : ""}{day(view.date)}
              {quotation && view.validUntil ? ` · valid until ${day(view.validUntil)}` : ""}{!quotation && view.dueDate ? ` · due ${day(view.dueDate)}` : ""}
            </p>
          </div>
          <a href={`/api/sales/public/documents/${token}/pdf`} className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover">
            Download PDF
          </a>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-text-secondary">
            <tr><th className="py-2 font-medium">Item</th><th className="py-2 text-right font-medium">Qty</th><th className="py-2 text-right font-medium">GST</th><th className="py-2 text-right font-medium">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(view.lines as Line[]).map((line, index) => (
              <tr key={index}>
                <td className="py-2 pr-2">{line.description}</td>
                <td className="py-2 text-right tabular-nums">{line.quantity} {line.unit ?? ""}</td>
                <td className="py-2 text-right tabular-nums">{line.taxRate}%</td>
                <td className="py-2 text-right tabular-nums">{money(view.currencyCode, line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col items-end gap-1 text-sm">
          <span className="text-text-secondary">Tax {money(view.currencyCode, view.totals.tax)}</span>
          <span className="text-lg font-semibold text-text">Total {money(view.currencyCode, view.totals.total)}</span>
          {!quotation && view.totals.due > 0 && view.totals.due < view.totals.total && <span className="text-text-secondary">Still due {money(view.currencyCode, view.totals.due)}</span>}
        </div>
        {quotation && view.newerVersion && (
          <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
            A newer version of this quotation is available:{" "}
            <a className="font-medium text-brand underline-offset-2 hover:underline" href={view.newerVersion.url}>{view.newerVersion.number}</a>
          </p>
        )}
        {quotation && (view.accepted
          ? <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">You have accepted this quotation. Thank you.</p>
          : view.declined ? <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">You declined this quotation. Thank you for letting us know.</p>
          : view.expired ? <p className="text-sm text-text-secondary">This quotation has expired. Ask {view.company} for a new one.</p>
            : view.canAccept ? <AcceptQuotationForm token={token} extras={((view.optionalLines ?? []) as Array<{ index: number; description: string; quantity: number; unit: string | null; lineTotal: number }>)
              .map((line) => ({ index: line.index, label: `${line.description} (${line.quantity} ${line.unit ?? ""})`.replace(" )", ")"), amount: money(view.currencyCode, line.lineTotal) }))} /> : null)}
        {!quotation && (view.paid
          ? <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">This invoice is paid. Thank you.</p>
          : view.payOnline || view.upiLink ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              {view.payOnline && <PayOnlineButton token={token} label={`Pay ${money(view.currencyCode, view.totals.due)} now`} />}
              {view.upiLink && (
                <a href={view.upiLink} className={`inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] px-4 text-sm font-medium ${view.payOnline
                  ? "border border-border bg-surface text-text hover:bg-surface-muted" : "bg-brand text-text-inverse hover:bg-brand-hover"}`}>
                  Pay {money(view.currencyCode, view.totals.due)} by UPI
                </a>
              )}
            </div>
          ) : null)}
        {view.terms && <p className="whitespace-pre-line border-t border-border pt-4 text-xs text-text-secondary">{view.terms}</p>}
      </div>
    </main>
  );
}
