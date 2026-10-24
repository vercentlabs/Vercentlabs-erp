import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadCustomerPortal } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";
import { portalCookie } from "@/app/api/sales/public/portal/[key]/portal-route";

import { PortalSignIn, PortalSignOut } from "./PortalSignIn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer portal", robots: { index: false, follow: false } };

const money = (currency: string, value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(value);
const day = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "");

// A company's customer portal (Sales report Phase 3): sign in with a code sent by email, then the customer's quotations, orders and
// invoices, what is owed, and each quotation or invoice opened on its shared link (accept, download, pay now). Unknown address: not found.
export default async function CustomerPortalPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const token = (await cookies()).get(portalCookie(key))?.value ?? null;
  const view = await ingressTransaction((client) => loadCustomerPortal(client, key, token)).catch(() => null);
  if (!view) notFound();
  if (!view.signedIn) {
    return (
      <main className="flex min-h-screen items-start justify-center bg-surface-muted px-4 py-12">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-6">
          <div>
            <p className="text-xs tracking-wide text-text-muted uppercase">{view.company}</p>
            <h1 className="text-xl font-semibold text-text">Customer portal</h1>
            <p className="text-sm text-text-secondary">Your quotations, orders and invoices in one place.</p>
          </div>
          <PortalSignIn portalKey={key} />
        </div>
      </main>
    );
  }
  const currency = view.invoices[0]?.currencyCode ?? "INR";
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8 max-lg:pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs tracking-wide text-text-muted uppercase">{view.company}</p>
            <h1 className="text-xl font-semibold text-text">{view.customers.join(", ")}</h1>
            <p className="text-sm text-text-secondary">Signed in as {view.email}</p>
          </div>
          <PortalSignOut portalKey={key} />
        </header>

        <section aria-label="What you owe" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">To pay</p>
            <p className="text-2xl font-semibold tabular-nums text-text">{money(currency, view.owed.due)}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">Overdue</p>
            <p className={`text-2xl font-semibold tabular-nums ${view.owed.overdue > 0 ? "text-danger" : "text-text"}`}>{money(currency, view.owed.overdue)}</p>
          </div>
        </section>

        <PortalList title="Invoices" empty="No invoices yet." rows={view.invoices.map((row) => ({
          key: row.number, href: row.url, title: row.number, meta: `${day(row.date)}${row.dueDate ? ` · due ${day(row.dueDate)}` : ""}`,
          right: row.due > 0.005 ? `${money(row.currencyCode, row.due)} to pay` : "Paid", tone: row.overdue ? "danger" : row.due > 0.005 ? "default" : "muted",
          action: row.due > 0.005 ? "Open and pay" : "Open",
        }))} />
        <PortalList title="Quotations" empty="No quotations yet." rows={view.quotations.map((row) => ({
          key: row.number, href: row.url, title: row.number, meta: `${day(row.date)}${row.validUntil ? ` · valid until ${day(row.validUntil)}` : ""} · ${row.status}`,
          right: money(row.currencyCode, row.total), tone: "default", action: row.status === "Awaiting your answer" ? "Open and answer" : "Open",
        }))} />
        <PortalList title="Orders" empty="No orders yet." rows={view.orders.map((row) => ({
          key: row.number, href: null, title: row.number, meta: `${day(row.date)}${row.yourPo ? ` · your PO ${row.yourPo}` : ""} · ${row.status}`,
          right: money(row.currencyCode, row.total), tone: "default", action: null,
        }))} />
      </div>
    </main>
  );
}

type Row = { key: string; href: string | null; title: string; meta: string; right: string; tone: "default" | "danger" | "muted"; action: string | null };

function PortalList({ title, empty, rows }: { title: string; empty: string; rows: Row[] }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{title}</h2>
      {rows.length === 0 ? <p className="px-4 py-5 text-sm text-text-secondary">{empty}</p> : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-text">{row.title}</span>
                <span className="text-xs text-text-secondary">{row.meta}</span>
              </span>
              <span className="flex items-center justify-between gap-3 sm:justify-end">
                <span className={`tabular-nums ${row.tone === "danger" ? "font-medium text-danger" : row.tone === "muted" ? "text-text-muted" : "text-text"}`}>{row.right}</span>
                {row.href && row.action && (
                  <a href={row.href} className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium text-text hover:bg-surface-muted">
                    {row.action}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
