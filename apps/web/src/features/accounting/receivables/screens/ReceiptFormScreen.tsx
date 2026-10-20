"use client";

// Record a customer's payment. Choose the customer and its open invoices appear, oldest due first; enter what this payment settles on each
// (or "Apply to oldest"), and whatever is not applied stays on the customer as an advance — never income. Saving posts the receipt
// (Dr bank or cash · Cr the customer) and applies it in one step. Opened from an invoice ("Record payment"), the customer and that invoice
// are filled in.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Breadcrumb, Button, ComboBox, ErrorState, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { formatDate } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { METHODS, cents, errorMessage, errorStatus, fromCents, inr, receiptOptions, recordReceipt } from "../api/receivables-api";

export function ReceiptFormScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [partyId, setPartyId] = useState<string | null>(params.get("partyId"));
  const presetInvoice = params.get("invoiceId");
  const base = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "receipt-options"), queryFn: () => receiptOptions(), staleTime: 60_000, retry: false });
  const forParty = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "receipt-options", partyId), queryFn: () => receiptOptions(partyId), enabled: Boolean(partyId), retry: false });
  const options = base.data;
  const [form, setForm] = useState({ receiptDate: "", amount: "", bankAccountId: "", paymentMethod: "bank_transfer", reference: "", notes: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [presetApplied, setPresetApplied] = useState(false);
  const invoices = useMemo(() => (partyId ? forParty.data?.openInvoices ?? [] : []), [partyId, forParty.data]);
  const customer = options?.customers.find((entry) => entry.id === partyId);
  const currency = customer?.currency ?? options?.baseCurrency ?? "INR";

  // From an invoice's "Record payment": once its customer's invoices arrive, the payment is that invoice's balance, applied to it
  // (state adjusted while rendering, once).
  if (!presetApplied && presetInvoice && forParty.data) {
    const invoice = forParty.data.openInvoices.find((entry) => entry.id === presetInvoice);
    setPresetApplied(true);
    if (invoice) { setAmounts({ [invoice.id]: fromCents(cents(invoice.outstanding)) }); setForm((current) => ({ ...current, amount: current.amount || fromCents(cents(invoice.outstanding)) })); }
  }

  const received = cents(form.amount);
  const applied = Object.entries(amounts).filter(([id]) => invoices.some((invoice) => invoice.id === id)).reduce((sum, [, value]) => sum + cents(value), 0);
  const advance = received - applied;
  const overInvoice = invoices.find((invoice) => cents(amounts[invoice.id]) > cents(invoice.outstanding));
  const ready = Boolean(partyId && received > 0 && advance >= 0 && !overInvoice);
  useFormChangesWarning({ partyId, form, amounts });

  const fillOldest = () => {
    let left = received;
    const next: Record<string, string> = {};
    for (const invoice of invoices) { if (left <= 0) break; const take = Math.min(left, cents(invoice.outstanding)); next[invoice.id] = fromCents(take); left -= take; }
    setAmounts(next);
  };
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submitKey.run(() => recordReceipt({
      partyId: partyId!, receiptDate: form.receiptDate || options!.today, amount: fromCents(received), currencyCode: currency, bankAccountId: form.bankAccountId || null,
      paymentMethod: form.paymentMethod, reference: form.reference || null, notes: form.notes || null,
      allocations: Object.entries(amounts).filter(([id, value]) => cents(value) > 0 && invoices.some((invoice) => invoice.id === id)).map(([invoiceId, value]) => ({ invoiceId, amount: fromCents(cents(value)) })),
    })),
    onSuccess: (receipt) => router.replace(`/accounting/receipts/${receipt.id}`),
  });
  const busy = save.isPending || save.isSuccess;

  if (base.isLoading) return <LoadingState label="Loading the receipt form" rows={8} />;
  if (errorStatus(base.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!options) return <ErrorState title="Could not load the receipt form" description={errorMessage(base.error)} />;
  const accountKey = form.bankAccountId || (options.accounts.find((entry) => !entry.cash)?.id ?? "default");

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/receipts">Receipts</Breadcrumb>, <Breadcrumb key="this" isCurrent>New</Breadcrumb>],
        title: "Record payment",
        description: "A payment received from a customer. Apply it to the invoices it pays; whatever is left stays on the customer as an advance.",
      }}
      banner={Boolean(save.error) && <Notice>{errorMessage(save.error)}</Notice>}
      aside={
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-4">
          <span className="text-sm font-semibold text-text">This payment</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-secondary">Received</dt><dd className="text-right">{inr(received / 100, currency)}</dd>
            <dt className="text-text-secondary">Applied to invoices</dt><dd className="text-right">{inr(applied / 100, currency)}</dd>
          </dl>
          <div className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${advance < 0 ? "bg-danger-soft text-danger" : advance > 0 ? "bg-info-soft text-info" : "bg-success-soft text-success"}`}>
            {advance < 0 ? `Applied ${inr(-advance / 100, currency)} more than received` : advance > 0 ? `${inr(advance / 100, currency)} stays as an advance` : received > 0 ? "Fully applied" : "Enter the amount received"}
          </div>
          {partyId && (forParty.data?.unapplied ?? 0) > 0 && (
            <p className="text-xs text-text-muted">This customer already holds {inr(forParty.data!.unapplied, currency)} from earlier receipts; apply it from those receipts.</p>
          )}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace("/accounting/receipts")}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !ready} onPress={() => save.mutate()}>Save payment</Button>
        </>
      }
    >
      <FormSection columns={1} title="Payment">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label="Customer" isRequired placeholder="Choose a customer" selectedKey={partyId} onSelectionChange={(key) => { setPartyId(key ? String(key) : null); setAmounts({}); }}
            options={options.customers.map((entry) => ({ value: entry.id, label: entry.number ? `${entry.name} · ${entry.number}` : entry.name }))} />
          <TextField label="Date received" type="date" isRequired value={form.receiptDate || options.today} onChange={set("receiptDate")} description="Posts on this date; its period must be open." />
          <TextField label={`Amount (${currency})`} inputMode="decimal" isRequired placeholder="0.00" value={form.amount} onChange={set("amount")} />
          <Select label="Received into" selectedKey={accountKey} onSelectionChange={(key) => set("bankAccountId")(key === "default" ? "" : String(key))}
            options={options.accounts.length ? options.accounts.map((entry) => ({ value: entry.id, label: entry.cash ? `${entry.label} (cash)` : entry.label }))
              : [{ value: "default", label: "Main bank (Posting accounts)" }]} />
          <Select label="How it was paid" selectedKey={form.paymentMethod} onSelectionChange={(key) => set("paymentMethod")(String(key))} options={METHODS.map(([value, label]) => ({ value, label }))} />
          <TextField label="Reference" value={form.reference} onChange={set("reference")} maxLength={200}
            description={form.paymentMethod === "cheque" ? "Cheque number and bank." : form.paymentMethod === "upi" || form.paymentMethod === "bank_transfer" ? "UTR / transaction ID." : undefined} />
          <div className="sm:col-span-2 lg:col-span-3"><TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={2000} /></div>
        </div>
      </FormSection>

      <FormSection columns={1} title="Apply to invoices" description="Enter what this payment settles on each invoice. An invoice is never settled beyond what it still owes."
        actions={invoices.length > 0 ? <span className="flex gap-1">
          <Button size="compact" variant="secondary" isDisabled={received <= 0} onPress={fillOldest}>Apply to oldest</Button>
          <Button size="compact" variant="ghost" onPress={() => setAmounts({})}>Clear</Button></span> : undefined}>
        {!partyId ? <p className="text-sm text-text-muted">Choose the customer to see what it owes.</p>
          : forParty.isLoading ? <LoadingState label="Loading open invoices" rows={3} />
          : invoices.length === 0 ? <Notice tone="neutral">{customer?.name ?? "This customer"} has no open invoice in {currency}. The whole payment will be held as an advance.</Notice> : (
            <ul className="flex flex-col divide-y divide-border">
              {invoices.map((invoice) => {
                const over = cents(amounts[invoice.id]) > cents(invoice.outstanding);
                return (
                  <li key={invoice.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex min-w-0 flex-col text-sm">
                      <span className="font-medium text-text">{invoice.number}</span>
                      <span className={`text-xs ${invoice.overdue ? "text-danger" : "text-text-muted"}`}>{formatDate(invoice.date)} · due {formatDate(invoice.dueDate)}{invoice.overdue ? " · overdue" : ""}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-right text-sm tabular-nums"><span className="block text-xs text-text-muted">Owes</span>{inr(invoice.outstanding, currency)}</span>
                      <TextField aria-label={`Apply to ${invoice.number}`} size="compact" inputMode="decimal" className="w-36" placeholder="0.00" value={amounts[invoice.id] ?? ""}
                        errorMessage={over ? "More than it owes" : undefined} onChange={(value) => setAmounts((current) => ({ ...current, [invoice.id]: value }))} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
      </FormSection>
    </DocumentFormPage>
  );
}
