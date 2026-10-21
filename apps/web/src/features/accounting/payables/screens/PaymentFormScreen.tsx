"use client";

// Pay a supplier. Choose the supplier and its open bills appear, oldest due first; enter what this payment settles on each (or "Pay oldest
// first"), and whatever is not applied becomes an advance to the supplier — never an expense. Where the company requires approval for
// supplier payments, saving sends it to a second person, with the bills it pays; once approved it is posted. Otherwise it is posted now.
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
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

import { METHODS, cents, errorMessage, errorStatus, fromCents, inr, paymentOptions, preparePayment } from "../api/payables-api";

export function PaymentFormScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [partyId, setPartyId] = useState<string | null>(params.get("partyId"));
  const presetBill = params.get("billId");
  const base = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "payment-options"), queryFn: () => paymentOptions(), staleTime: 60_000, retry: false });
  const forParty = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "payment-options", partyId), queryFn: () => paymentOptions(partyId), enabled: Boolean(partyId), retry: false });
  const options = base.data;
  const [form, setForm] = useState({ paymentDate: "", amount: "", bankAccountId: "", paymentMethod: "bank_transfer", reference: "", notes: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [presetApplied, setPresetApplied] = useState(false);
  const bills = useMemo(() => (partyId ? forParty.data?.openBills ?? [] : []), [partyId, forParty.data]);
  const supplier = options?.suppliers.find((entry) => entry.id === partyId);
  const currency = supplier?.currency ?? options?.baseCurrency ?? "INR";
  // From a bill's "Pay": once the supplier's bills arrive, the payment is that bill's balance, applied to it (adjusted while rendering, once).
  if (!presetApplied && presetBill && forParty.data) {
    const bill = forParty.data.openBills.find((entry) => entry.id === presetBill);
    setPresetApplied(true);
    if (bill) { setAmounts({ [bill.id]: fromCents(cents(bill.outstanding)) }); setForm((current) => ({ ...current, amount: current.amount || fromCents(cents(bill.outstanding)) })); }
  }
  const paid = cents(form.amount);
  const applied = Object.entries(amounts).filter(([id]) => bills.some((bill) => bill.id === id)).reduce((sum, [, value]) => sum + cents(value), 0);
  const advance = paid - applied;
  const over = bills.find((bill) => cents(amounts[bill.id]) > cents(bill.outstanding));
  const ready = Boolean(partyId && paid > 0 && advance >= 0 && !over);
  const needsApproval = Boolean(options && (options.approval.required || (options.approval.threshold > 0 && paid / 100 >= options.approval.threshold)));
  useFormChangesWarning({ partyId, form, amounts });

  const fillOldest = () => {
    let left = paid;
    const next: Record<string, string> = {};
    for (const bill of bills) { if (left <= 0) break; const take = Math.min(left, cents(bill.outstanding)); next[bill.id] = fromCents(take); left -= take; }
    setAmounts(next);
  };
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submitKey.run(() => preparePayment({
      partyId: partyId!, paymentDate: form.paymentDate || options!.today, amount: fromCents(paid), currencyCode: currency, bankAccountId: form.bankAccountId || null,
      paymentMethod: form.paymentMethod, reference: form.reference || null, notes: form.notes || null,
      allocations: Object.entries(amounts).filter(([id, value]) => cents(value) > 0 && bills.some((bill) => bill.id === id)).map(([billId, value]) => ({ billId, amount: fromCents(cents(value)) })),
    })),
    onSuccess: (payment) => router.replace(`/accounting/payments/${payment.id}`),
  });
  const busy = save.isPending || save.isSuccess;

  if (base.isLoading) return <LoadingState label="Loading the payment form" rows={8} />;
  if (errorStatus(base.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!options) return <ErrorState title="Could not load the payment form" description={errorMessage(base.error)} />;
  const accountKey = form.bankAccountId || (options.accounts.find((entry) => !entry.cash)?.id ?? "default");

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/payments">Supplier payments</Breadcrumb>, <Breadcrumb key="this" isCurrent>New</Breadcrumb>],
        title: "Pay supplier",
        description: "A payment to a supplier, with the bills it pays. Whatever is not applied becomes an advance to the supplier.",
      }}
      banner={<div className="flex flex-col gap-3">
        {needsApproval && <Notice tone="info">Supplier payments need a second person&apos;s approval: this payment is sent for approval with the bills it pays, and posted once approved.</Notice>}
        {Boolean(save.error) && <Notice>{errorMessage(save.error)}</Notice>}
      </div>}
      aside={
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-4">
          <span className="text-sm font-semibold text-text">This payment</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-secondary">Paid</dt><dd className="text-right">{inr(paid / 100, currency)}</dd>
            <dt className="text-text-secondary">Applied to bills</dt><dd className="text-right">{inr(applied / 100, currency)}</dd>
          </dl>
          <div className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${advance < 0 ? "bg-danger-soft text-danger" : advance > 0 ? "bg-info-soft text-info" : "bg-success-soft text-success"}`}>
            {advance < 0 ? `Applied ${inr(-advance / 100, currency)} more than paid` : advance > 0 ? `${inr(advance / 100, currency)} becomes an advance` : paid > 0 ? "Fully applied" : "Enter the amount paid"}
          </div>
          {partyId && (forParty.data?.unapplied ?? 0) > 0 && <p className="text-xs text-text-muted">This supplier already holds {inr(forParty.data!.unapplied, currency)} of earlier payments; apply it from those payments.</p>}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace("/accounting/payments")}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !ready} onPress={() => save.mutate()}>{needsApproval ? "Send for approval" : "Save payment"}</Button>
        </>
      }
    >
      <FormSection columns={1} title="Payment">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label="Supplier" isRequired placeholder="Choose a supplier" selectedKey={partyId} onSelectionChange={(key) => { setPartyId(key ? String(key) : null); setAmounts({}); }}
            options={options.suppliers.map((entry) => ({ value: entry.id, label: entry.name }))} />
          <TextField label="Payment date" type="date" isRequired value={form.paymentDate || options.today} onChange={set("paymentDate")} description="Posts on this date; its period must be open." />
          <TextField label={`Amount (${currency})`} inputMode="decimal" isRequired placeholder="0.00" value={form.amount} onChange={set("amount")} />
          <Select label="Paid from" selectedKey={accountKey} onSelectionChange={(key) => set("bankAccountId")(key === "default" ? "" : String(key))}
            options={options.accounts.length ? options.accounts.map((entry) => ({ value: entry.id, label: entry.cash ? `${entry.label} (cash)` : entry.label })) : [{ value: "default", label: "Main bank (Posting accounts)" }]} />
          <Select label="How it is paid" selectedKey={form.paymentMethod} onSelectionChange={(key) => set("paymentMethod")(String(key))} options={METHODS.map(([value, label]) => ({ value, label }))} />
          <TextField label="Reference" value={form.reference} onChange={set("reference")} maxLength={200}
            description={form.paymentMethod === "cheque" ? "Cheque number." : form.paymentMethod === "bank_transfer" || form.paymentMethod === "upi" ? "UTR / transaction ID (can be added later)." : undefined} />
          <div className="sm:col-span-2 lg:col-span-3"><TextArea label="Notes for the approver" value={form.notes} onChange={set("notes")} maxLength={2000} /></div>
        </div>
      </FormSection>
      <FormSection columns={1} title="Bills paid" description="Enter what this payment settles on each bill. A bill is never paid beyond what it still owes."
        actions={bills.length > 0 ? <span className="flex gap-1">
          <Button size="compact" variant="secondary" isDisabled={paid <= 0} onPress={fillOldest}>Pay oldest first</Button>
          <Button size="compact" variant="ghost" onPress={() => setAmounts({})}>Clear</Button></span> : undefined}>
        {!partyId ? <p className="text-sm text-text-muted">Choose the supplier to see what is owed.</p>
          : forParty.isLoading ? <LoadingState label="Loading open bills" rows={3} />
          : bills.length === 0 ? <Notice tone="neutral">{supplier?.name ?? "This supplier"} has no open bill in {currency}. The whole payment becomes an advance.</Notice> : (
            <ul className="flex flex-col divide-y divide-border">
              {bills.map((bill) => (
                <li key={bill.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 flex-col text-sm">
                    <span className="font-medium text-text">{bill.number}{bill.supplierInvoice ? <span className="font-normal text-text-muted"> · invoice {bill.supplierInvoice}</span> : null}</span>
                    <span className={`text-xs ${bill.overdue ? "text-danger" : "text-text-muted"}`}>{formatDate(bill.date)} · due {formatDate(bill.dueDate)}{bill.overdue ? " · overdue" : ""}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right text-sm tabular-nums"><span className="block text-xs text-text-muted">Owed</span>{inr(bill.outstanding, currency)}</span>
                    <TextField aria-label={`Pay on ${bill.number}`} size="compact" inputMode="decimal" className="w-36" placeholder="0.00" value={amounts[bill.id] ?? ""}
                      errorMessage={cents(amounts[bill.id]) > cents(bill.outstanding) ? "More than owed" : undefined} onChange={(value) => setAmounts((current) => ({ ...current, [bill.id]: value }))} />
                  </span>
                </li>
              ))}
            </ul>
          )}
      </FormSection>
    </DocumentFormPage>
  );
}
