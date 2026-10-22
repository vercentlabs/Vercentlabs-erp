"use client";

// Payments Received › New (Sales plan, Flow 4): the customer, the amount and how it was paid (UPI, NEFT/RTGS with its UTR, a cheque with
// its number, date and bank, cash). The bills it pays are filled oldest first and can be changed one by one; what is not applied stays
// the customer's advance, offered on its next invoice. Saved once (one key per form), then the receipt opens.
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, RecordFormPage, Select, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice } from "@/shared/ui/Panel";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";
import { CustomerPicker } from "@/features/sales/shared/CustomerPicker";
import { listPaymentAccounts } from "@/features/sales/invoices/api/invoices-api";

import { getOpenItems, oldestFirst, recordPayment } from "./api";

const DEFAULT_ACCOUNT = "default";
const METHODS = [
  { value: "upi", label: "UPI" }, { value: "bank_transfer", label: "NEFT / RTGS / IMPS" }, { value: "cheque", label: "Cheque" }, { value: "cash", label: "Cash" },
  { value: "card", label: "Card" }, { value: "other", label: "Other" },
];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export function PaymentFormScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const submit = useSubmitKey();
  const [partyId, setPartyId] = useState<string | null>(params.get("customerId"));
  const [amount, setAmount] = useState<number>(Number(params.get("amount")) || 0);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const [cheque, setCheque] = useState({ number: "", date: today(), bank: "" });
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [notes, setNotes] = useState("");
  // Bills changed by hand keep their amount; the rest follow the oldest-first split of what is left.
  const [manual, setManual] = useState<Record<string, number>>({});
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "payment-accounts"), queryFn: listPaymentAccounts, staleTime: 60_000 });
  const open = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "open-items", partyId ?? ""), queryFn: () => getOpenItems(partyId!), enabled: Boolean(partyId) });
  const invoices = useMemo(() => open.data?.invoices ?? [], [open.data]);
  const currency = open.data?.customer.currencyCode ?? invoices[0]?.currency_code ?? "INR";
  const allocation = useMemo(() => {
    const fixed = Object.entries(manual).filter(([id]) => invoices.some((invoice) => invoice.id === id));
    const fixedTotal = fixed.reduce((total, [, value]) => total + value, 0);
    const auto = oldestFirst(invoices.filter((invoice) => !(invoice.id in manual)), Math.max(0, (Number.isFinite(amount) ? amount : 0) - fixedTotal));
    return { ...auto, ...Object.fromEntries(fixed) } as Record<string, number>;
  }, [invoices, manual, amount]);
  const applied = Math.round(Object.values(allocation).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0) * 100) / 100;
  const advance = Math.round(((Number.isFinite(amount) ? amount : 0) - applied) * 100) / 100;
  const overApplied = advance < -0.005;
  const save = useMutation({
    mutationFn: () => submit.run(() => recordPayment({
      partyId: partyId!, amount, receiptDate: date, paymentMethod: method, reference: reference.trim() || undefined, notes: notes.trim() || undefined,
      bankAccountId: account === DEFAULT_ACCOUNT ? null : account,
      ...(method === "cheque" ? { chequeNumber: cheque.number.trim(), chequeDate: cheque.date, draweeBank: cheque.bank.trim() || undefined } : {}),
      allocations: invoices.map((invoice) => ({ invoiceId: invoice.id, amount: allocation[invoice.id] ?? 0 })).filter((entry) => entry.amount > 0),
    })),
    onSuccess: ({ result }) => router.replace(`/sales/payments/${result.receiptId}`),
  });
  const chequeMissing = method === "cheque" && (!cheque.number.trim() || !cheque.date);
  const ready = Boolean(partyId) && amount > 0 && !overApplied && !chequeMissing;

  return (
    <RecordFormPage
      header={{ title: "Payment received", description: "What the customer paid and the bills it settles. What is not applied stays the customer's advance." }}
      banner={save.isError ? <Notice tone="danger">{save.error instanceof SalesApiError ? save.error.message : "The payment could not be recorded."}</Notice> : undefined}
      formActions={(
        <>
          <Button variant="secondary" onPress={() => router.back()}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending || save.isSuccess} onPress={() => save.mutate()}>Record payment</Button>
        </>
      )}
    >
      <FormSection title="Customer and amount">
        <CustomerPicker value={partyId} isRequired onPick={(customer) => { setPartyId(customer?.id ?? null); setManual({}); }} />
        <NumberField label={`Amount received (${currency})`} isRequired value={amount} onChange={setAmount} minValue={0} step={0.01} />
        <TextField label="Received on" type="date" isRequired value={date} onChange={setDate} />
        <Select label="Paid by" selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} options={METHODS} />
        {method === "cheque" ? (
          <>
            <TextField label="Cheque number" isRequired value={cheque.number} onChange={(number) => setCheque((current) => ({ ...current, number }))} />
            <TextField label="Cheque date" type="date" isRequired value={cheque.date} onChange={(value) => setCheque((current) => ({ ...current, date: value }))} />
            <TextField label="Drawn on (bank)" value={cheque.bank} onChange={(bank) => setCheque((current) => ({ ...current, bank }))} />
          </>
        ) : (
          <TextField label={method === "upi" ? "UPI reference" : method === "bank_transfer" ? "UTR number" : "Reference"} value={reference} onChange={setReference} />
        )}
        <Select label="Into" selectedKey={account} onSelectionChange={(key) => setAccount(String(key))}
          options={[{ value: DEFAULT_ACCOUNT, label: "The company's bank account" }, ...(accounts.data?.accounts ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <TextField label="Note" value={notes} onChange={setNotes} />
      </FormSection>

      {partyId && (
        <FormSection title="Bills it pays" columns={1}
          description="Filled oldest first. Change an amount to settle the bills the customer named; the rest is kept as an advance."
          actions={Object.keys(manual).length ? <Button variant="ghost" size="compact" onPress={() => setManual({})}>Oldest first again</Button> : undefined}>
          {open.isError ? <ErrorState title="Could not load the customer's bills" action={{ label: "Try again", onPress: () => void open.refetch() }} />
            : open.isLoading ? <p className="text-sm text-text-secondary">Loading bills…</p> : (
              <>
                <LinesTable columns={["Bill", "Date", "Due", { label: "Overdue", numeric: true }, { label: "Owed", numeric: true }, { label: "Pay now", numeric: true }]}
                  empty={invoices.length ? undefined : "Nothing is owed: the whole amount is kept as an advance."}>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <Cell>{invoice.invoice_number}{invoice.invoice_type === "debit_note" ? " (debit note)" : ""}</Cell>
                      <Cell>{calendarDate(invoice.invoice_date)}</Cell>
                      <Cell>{calendarDate(invoice.due_date)}</Cell>
                      <Cell numeric>{invoice.days_overdue > 0 ? `${invoice.days_overdue} days` : "—"}</Cell>
                      <Cell numeric>{money(invoice.currency_code, invoice.outstanding_amount)}</Cell>
                      <Cell numeric>
                        <NumberField aria-label={`Pay on ${invoice.invoice_number}`} size="compact" className="ml-auto w-36" value={allocation[invoice.id] ?? 0}
                          minValue={0} maxValue={invoice.outstanding_amount} step={0.01}
                          onChange={(value) => setManual((current) => ({ ...current, [invoice.id]: Number.isFinite(value) ? value : 0 }))} />
                      </Cell>
                    </tr>
                  ))}
                </LinesTable>
                <p className={`text-sm ${overApplied ? "text-danger" : "text-text-secondary"}`}>
                  {overApplied
                    ? `The bills take ${money(currency, applied)}, more than the ${money(currency, amount)} received.`
                    : `${money(currency, applied)} to bills${advance > 0.005 ? ` · ${money(currency, advance)} kept as an advance` : ""}.`}
                  {open.data && open.data.advances.length > 0 && ` The customer already has ${money(currency, open.data.advances.reduce((total, row) => total + row.unapplied_amount, 0))} in advances.`}
                </p>
              </>
            )}
        </FormSection>
      )}
    </RecordFormPage>
  );
}
