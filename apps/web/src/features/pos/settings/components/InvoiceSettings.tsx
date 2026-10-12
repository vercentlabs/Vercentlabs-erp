"use client";

// GST invoice numbering and e-invoicing (administrators). Each GST registration numbers its tax invoices, bills of supply and credit notes in
// its own series per financial year — prefix + year + number, at most 16 characters. A series is created with its default format the first
// time it is used; set the prefix before then. Once a series has issued numbers its format is fixed. E-invoicing: whether the registration
// is under the mandate (your turnover and the current notifications decide); no IRP is connected, so a B2B bill needing an IRN is then
// stopped at POS and issued through your e-invoicing workflow.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";
import type { InvoiceRegistration } from "@vercentlabs/api";

import { SERIES_LABEL, invoiceSeries, saveEInvoice, saveSeries } from "@/features/pos/invoices/api/invoices-api";
import { PosApiError } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";

const KINDS = ["tax_invoice", "bill_of_supply", "credit_note"] as const;

function RegistrationInvoicing({ registration, financialYear, series, defaults, onSaved }: {
  registration: InvoiceRegistration; financialYear: string; defaults: Record<string, string>; onSaved: () => void;
  series: Array<{ kind: string; financialYear: string; prefix: string; padding: number; issued: number; nextFormatted: string; status: string }>;
}) {
  const current = (kind: string) => series.find((row) => row.kind === kind && row.financialYear === financialYear);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(KINDS.map((kind) => [kind, current(kind)?.prefix ?? defaults[kind] ?? ""])));
  const [einvoice, setEinvoice] = useState({ applicable: registration.einvoiceApplicable, from: registration.einvoiceApplicableFrom ? String(registration.einvoiceApplicableFrom).slice(0, 10) : "" });
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try { await work(); setMessage({ error: false, text: done }); onSaved(); } catch (failure) { setMessage({ error: true, text: failure instanceof PosApiError ? failure.message : "Could not save." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{registration.name} · {registration.gstin ?? "no GSTIN"}</p>
        <StatusBadge tone={registration.registrationType === "regular" ? "success" : "warning"}>{registration.registrationType}</StatusBadge>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Series ({financialYear})</th><th className="pb-1 text-left">Prefix</th><th className="pb-1 text-left">Next number</th><th className="pb-1 text-right">Issued</th></tr></thead>
        <tbody>{KINDS.map((kind) => {
          const row = current(kind);
          const used = (row?.issued ?? 0) > 0;
          return (
            <tr key={kind} className="border-t border-border">
              <td className="py-1.5">{SERIES_LABEL[kind]}</td>
              <td>{used ? row!.prefix : <TextField aria-label={`${SERIES_LABEL[kind]} prefix`} size="compact" value={drafts[kind]} maxLength={8} onChange={(value) => setDrafts((all) => ({ ...all, [kind]: value }))} />}</td>
              <td className="tabular-nums">{row?.nextFormatted ?? `${drafts[kind]}${financialYear.slice(2, 4)}${financialYear.slice(5, 7)}/00001`}</td>
              <td className="text-right tabular-nums">{row?.issued ?? 0}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <div>
        <Button variant="secondary" size="compact" isLoading={busy} onPress={() => run(async () => {
          for (const kind of KINDS) if (!((current(kind)?.issued ?? 0) > 0)) await saveSeries({ registrationId: registration.id, kind, prefix: drafts[kind], financialYear });
        }, "Numbering saved.")}>Save numbering</Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Switch isSelected={einvoice.applicable} onChange={(value) => setEinvoice((all) => ({ ...all, applicable: value }))}>This registration is under the e-invoice mandate</Switch>
        {einvoice.applicable && <TextField label="Applies from" type="date" className="sm:max-w-xs" value={einvoice.from} onChange={(value) => setEinvoice((all) => ({ ...all, from: value }))} />}
        {einvoice.applicable && <p className="text-xs text-warning-emphasis">No e-invoice provider is connected: B2B bills from this registration will be stopped at POS. B2C bills are not affected.</p>}
        <div>
          <Button variant="secondary" size="compact" isLoading={busy} onPress={() => run(() => saveEInvoice(registration.id, { applicable: einvoice.applicable, applicableFrom: einvoice.from || null }),
            "E-invoicing saved.")}>Save e-invoicing</Button>
        </div>
      </div>
      {message && <p className={`text-sm ${message.error ? "text-danger-emphasis" : "text-text-muted"}`}>{message.text}</p>}
    </div>
  );
}

export function InvoiceSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pos-invoice-series"], queryFn: invoiceSeries });
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const data = query.data;
  if (!data || data.registrations.length === 0) return null;
  const selected = data.registrations.find((row) => row.id === registrationId) ?? data.registrations[0];
  return (
    <PosPanel title="GST invoices" description="Invoice numbering per GST registration and financial year, and e-invoicing. Invoice numbers are given by the server when a sale completes.">
      {data.registrations.length > 1 && (
        <Select label="GST registration" className="sm:max-w-sm" selectedKey={selected.id} onSelectionChange={(key) => setRegistrationId(String(key))}
          options={data.registrations.map((row) => ({ value: row.id, label: `${row.name} · ${row.gstin ?? "—"}` }))} />
      )}
      <RegistrationInvoicing key={`${selected.id}:${query.dataUpdatedAt}`} registration={selected} financialYear={data.currentFinancialYear} defaults={data.defaultPrefixes}
        series={data.series.filter((row) => row.registrationId === selected.id)} onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["pos-invoice-series"] }); }} />
    </PosPanel>
  );
}
