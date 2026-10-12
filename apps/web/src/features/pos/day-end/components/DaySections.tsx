"use client";

// The sections of an X / Z report, from the server's snapshot: identity, sales, tax documents, collections, returns, refunds, cash, cash
// differences, shifts, exceptions and Finance status. Sales value, collections, returns and refunds are shown apart — they are different
// measures and may differ on any day.
import type { ReactNode } from "react";

import type { DaySnapshot } from "@/features/pos/day-end/api/day-end-api";
import { dateTime, money } from "@/features/pos/shared/format";

const label = (value: string) => value.replace(/_/g, " ").toLowerCase();

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="text-xs text-text-muted">{note}</p>}
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: Array<[string, ReactNode, boolean?]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[1fr_auto]">
      {rows.map(([name, value, strong]) => (
        <div key={name} className="contents">
          <dt className={strong ? "font-medium" : "text-text-muted"}>{name}</dt>
          <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DaySections({ snapshot: s }: { snapshot: DaySnapshot }) {
  const c = s.identity.currency || "INR";
  const m = (value: string | number | null | undefined) => money(c, value ?? 0);
  return (
    <div className="flex flex-col gap-3">
      <Section title="A · Report" note={`Sales by ${s.attribution.sales}; returns by ${s.attribution.returns}; refunds by ${s.attribution.refunds}; GST documents by ${s.attribution.taxDocuments}; cash by ${s.attribution.cash}.`}>
        <Rows rows={[["Outlet", `${s.identity.outlet} (${s.identity.outletCode})`], ["Business date", s.identity.businessDate],
          ["Period", `${dateTime(s.identity.periodStart)} – ${dateTime(s.identity.periodEnd)}`], ["Cut-off", `${s.identity.cutoff} ${s.identity.timezone}`],
          ...(s.closing ? [["Report number", s.closing.reportNumber] as [string, string], ["Finalized", `${dateTime(s.closing.finalizedAt)} by ${s.closing.finalizedBy ?? "—"}`] as [string, string]] : [])]} />
      </Section>
      <Section title="B · Sales" note="Gross selling value as priced; the tax-exclusive value, GST and the tax-inclusive amount customers paid are shown separately.">
        <Rows rows={[["Completed sales", String(s.sales.count)], ["Gross sales", m(s.sales.gross)], ["Item discounts", m(s.sales.itemDiscounts)], ["Bill discounts", m(s.sales.cartDiscounts)],
          ["Loyalty redemptions", m(s.sales.loyaltyRedemptions)], ["Total discounts", m(s.sales.totalDiscounts)], ["Net sales before returns", m(s.sales.netBeforeReturns), true],
          ["Posted returns", m(s.sales.returns)], ["Net sales after returns", m(s.sales.netAfterReturns), true], ["Taxable value", m(s.sales.taxableValue)], ["GST charged", m(s.sales.taxCharged)],
          ["Rounding", m(s.sales.rounding)], ["Tax-inclusive consideration", m(s.sales.taxInclusiveConsideration)], ["Average sale", m(s.sales.averageSale)],
          ["Cancelled unpaid bills (not sales)", String(s.sales.cancelledUnpaidBills)], ["Expired bills (not sales)", String(s.sales.expiredBills)]]} />
      </Section>
      <Section title="C · GST documents" note={s.tax.note}>
        {s.tax.documents.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs text-text-muted"><tr><th className="text-left">Document</th><th className="text-right">Issued</th><th className="text-right">Taxable</th><th className="text-right">CGST</th>
              <th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Cess</th><th className="text-left">Numbers</th></tr></thead>
            <tbody>{s.tax.documents.map((row) => (
              <tr key={row.type} className="border-t border-border"><td>{label(row.type)}{row.cancelled ? ` (${row.cancelled} cancelled)` : ""}</td><td className="text-right">{row.issued}</td>
                <td className="text-right tabular-nums">{m(row.taxable)}</td><td className="text-right tabular-nums">{m(row.cgst)}</td><td className="text-right tabular-nums">{m(row.sgst)}</td>
                <td className="text-right tabular-nums">{m(row.igst)}</td><td className="text-right tabular-nums">{m(row.cess)}</td><td>{row.firstNumber} – {row.lastNumber}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="text-sm text-text-muted">No GST documents issued in the period.</p>}
        {s.tax.byRate.length > 0 && <p className="text-xs text-text-muted">By rate: {s.tax.byRate.map((row) => `${label(row.documentType)} ${row.classification ? label(row.classification) : ""} ${row.rate}% ${m(row.taxable)}`).join(" · ")}</p>}
      </Section>
      <Section title="D · Collections" note="Applied tender components of the period's sales — a split sale is one sale and several tenders. Card / UPI are confirmed at the counter, not yet settled.">
        <Rows rows={[...s.collections.byMethod.map((row) => [`${row.method.toUpperCase()} (${row.count})`, `${m(row.amount)}${row.externallyAttested && Number(row.externallyAttested) ? ` · attested ${m(row.externallyAttested)}` : ""}`] as [string, string]),
          ["Total applied collections", m(s.collections.total), true], ["Split-payment sales", String(s.collections.splitSales)],
          ...s.collections.failedOrVoided.map((row) => [`${row.method.toUpperCase()} ${row.status} (not collected)`, `${row.count} · ${m(row.amount)}`] as [string, string]),
          ...s.collections.unapplied.map((row) => [`${row.method.toUpperCase()} collected without a completed sale`, `${row.count} · ${m(row.amount)}`] as [string, string])]} />
      </Section>
      <Section title="E · Returns">
        <Rows rows={[["Posted returns", String(s.returns.count)], ["Return value", m(s.returns.value)], ["Tax adjustment", m(s.returns.taxAdjustment)], ["Refund due on these returns", m(s.returns.refundDue)]]} />
      </Section>
      <Section title="F · Refunds" note="Money actually returned, separate from returns.">
        <Rows rows={[["Paid", m(s.refunds.paid), true], ["Outstanding at the cut-off", m(s.refunds.outstanding)], ["Failed", m(s.refunds.failed)],
          ...s.refunds.byMethod.map((row) => [`${row.method.toUpperCase()} · ${row.bucket}`, `${row.count} · ${m(row.amount)}`] as [string, string])]} />
      </Section>
      <Section title="G · Cash" note={s.cash.openingFloatsNote}>
        <Rows rows={[["Cash sessions", String(s.cash.sessions)], ["Cash applied to sales", m(s.cash.appliedToSales)], ["Opening floats", m(s.cash.openingFloats)], ["Cash received", m(s.cash.cashReceived)],
          ["Change given", m(s.cash.changeGiven)], ["Cash handed back (uncompleted)", m(s.cash.uncompletedTendersReturned)], ["Cash refunds paid", m(s.cash.cashRefundsPaid)],
          ["Cash in", m(s.cash.cashMovementIn)], ["Cash out", m(s.cash.cashMovementOut)], ["Expected", m(s.cash.expected), true], ["Counted", m(s.cash.counted), true],
          ...s.cash.destinations.map((row) => [`To ${label(row.type)}`, `${m(row.amount)}${Number(row.pendingAmount) ? ` · ${m(row.pendingAmount)} awaiting acceptance` : ""}`] as [string, string])]} />
        {s.cash.perSession && s.cash.perSession.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs text-text-muted"><tr><th className="text-left">Shift</th><th className="text-left">Counter / drawer</th><th className="text-left">Cashier</th><th className="text-right">Expected</th>
              <th className="text-right">Counted</th><th className="text-right">Difference</th></tr></thead>
            <tbody>{s.cash.perSession.map((row) => (
              <tr key={row.shiftNumber + row.terminal} className="border-t border-border"><td>{row.shiftNumber}</td><td>{row.terminal}{row.drawer ? ` / ${row.drawer}` : ""}</td><td>{row.cashier ?? "—"}</td>
                <td className="text-right tabular-nums">{m(row.expected)}</td><td className="text-right tabular-nums">{m(row.counted)}</td>
                <td className="text-right tabular-nums">{m(row.variance)}{row.reasonCode ? ` (${label(row.reasonCode)}${row.approved ? ", approved" : ""})` : ""}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Section title="H · Cash differences" note="Shortages and overages are kept apart; opening and handover differences are their own contexts.">
        <Rows rows={[["Closing shortages", `${s.cash.shortageCount} · ${m(s.cash.shortageTotal)}`], ["Closing overages", `${s.cash.overageCount} · ${m(s.cash.overageTotal)}`], ["Net", m(s.cash.netVariance)],
          ...s.cashDifferences.map((row) => [`${label(row.context)} cases`, `${row.shortages} short${row.shortageAmount ? ` (${m(row.shortageAmount)})` : ""} · ${row.overages} over${row.overageAmount ? ` (${m(row.overageAmount)})` : ""}${row.unresolved ? ` · ${row.unresolved} open` : ""}`] as [string, string])]} />
      </Section>
      <Section title="I · Shifts" note={`${s.shifts.closed} of ${s.shifts.total} closed.`}>
        <ul className="text-sm">{s.shifts.list.map((row) => (
          <li key={row.id}>{row.shiftNumber} · {row.terminal} · {row.cashier ?? "—"} · {label(row.status)}{row.cashEnabled ? "" : " · card / UPI"}{row.reportedHere ? "" : " · reported on another day"}</li>
        ))}</ul>
      </Section>
      <Section title="J · Exceptions">
        {s.exceptions.length ? <ul className="text-sm">{s.exceptions.map((row) => (
          <li key={`${row.code}:${row.sourceId}`}>{row.severity === "BLOCKING" ? "Blocking" : row.severity === "APPROVABLE" ? "Approved exception" : "Tracked"}: {row.label}{row.exposure ? ` · ${m(row.exposure)}` : ""}{row.owner ? ` · ${row.owner}` : ""}</li>
        ))}</ul> : <p className="text-sm text-text-muted">None.</p>}
      </Section>
      <Section title="K · Finance" note={s.finance.note}>
        <Rows rows={[["Sales posting", Object.entries(s.finance.sales).map(([status, count]) => `${label(status)} ${count}`).join(" · ") || "—"],
          ["Settlement of card / UPI", s.finance.settlement.map((row) => `${label(row.status)} ${m(row.amount)}`).join(" · ") || "—"]]} />
      </Section>
    </div>
  );
}
