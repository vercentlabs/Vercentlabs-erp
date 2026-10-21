import { notFound } from "next/navigation";
import { loadSharedDealQuote, resolveSharedDealQuote } from "@vercentlabs/api/crm";

import { ingressTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotation", robots: { index: false, follow: false } };

const money = (currency: string, value: string | number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(Number(value));
const day = (value: string | null) => (value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "");

// The customer's page for a quote sent from CRM (by WhatsApp or a message): what was offered, the total, and the PDF. The token in the
// link is the only credential; an unknown link, or a company that switched CRM off, is not found.
export default async function SharedQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await ingressTransaction(async (client) => {
    const shared = await resolveSharedDealQuote(client, token);
    if (!shared) return null;
    const data = await loadSharedDealQuote(client, shared.organizationId, shared.quoteId);
    const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [shared.organizationId])).rows[0]?.name ?? null;
    return { ...data, company };
  }).catch(() => null);
  if (!view) notFound();
  const { quote, lines } = view;
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-wide text-text-muted uppercase">{view.company}</p>
            <h1 className="text-xl font-semibold text-text">{quote.kindLabel} {quote.number}</h1>
            <p className="text-sm text-text-secondary">
              {quote.companyName ? `For ${quote.companyName} · ` : ""}{day(quote.quoteDate)}{quote.validUntil ? ` · valid until ${day(quote.validUntil)}` : ""}
            </p>
          </div>
          <a href={`/api/crm/public/quotes/${token}/pdf`} className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover">
            Download PDF
          </a>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-text-secondary">
            <tr><th className="py-2 font-medium">Item</th><th className="py-2 text-right font-medium">Qty</th><th className="py-2 text-right font-medium">GST</th><th className="py-2 text-right font-medium">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={String(line.id)}>
                <td className="py-2 pr-2">{String(line.description)}</td>
                <td className="py-2 text-right tabular-nums">{Number(line.quantity)}</td>
                <td className="py-2 text-right tabular-nums">{Number(line.gstRate)}%</td>
                <td className="py-2 text-right tabular-nums">{money(quote.currencyCode, String(line.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col items-end gap-1 text-sm">
          <span className="text-text-secondary">Tax {money(quote.currencyCode, quote.taxTotal)}</span>
          <span className="text-lg font-semibold text-text">Total {money(quote.currencyCode, quote.grandTotal)}</span>
        </div>
        {quote.terms && <p className="whitespace-pre-line border-t border-border pt-4 text-xs text-text-secondary">{quote.terms}</p>}
      </div>
    </main>
  );
}
