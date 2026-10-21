"use client";

// Record a customer's payment on the invoice (Sales audit B7): how much, when, how, into which account. The receipt is posted and applied
// to this invoice — with or without the Accounting app.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

import { listPaymentAccounts, recordInvoicePayment } from "../api/invoices-api";

const DEFAULT_ACCOUNT = "default";

export function RecordPaymentDialog({ invoiceId, invoiceNumber, currencyCode, balance, onClose, onDone }: {
  invoiceId: string; invoiceNumber: string; currencyCode: string; balance: number; onClose: () => void; onDone: (message: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "payment-accounts"), queryFn: listPaymentAccounts, staleTime: 60_000 });
  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const save = useMutation({
    mutationFn: () => recordInvoicePayment(invoiceId, {
      amount, receiptDate: date, paymentMethod: method, reference: reference.trim() || undefined, bankAccountId: account === DEFAULT_ACCOUNT ? null : account,
    }),
    onSuccess: ({ result }) => onDone(result.outstanding > 0.005
      ? `Payment ${result.receiptNumber} recorded. ${money(currencyCode, result.outstanding)} is still due.`
      : `Payment ${result.receiptNumber} recorded. The invoice is paid.`),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Record payment on ${invoiceNumber}`} size="md"
      description={`${money(currencyCode, balance)} is due. The payment is entered in the books and applied to this invoice.`}>
      <div className="flex flex-col gap-4">
        {save.isError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {save.error instanceof SalesApiError ? save.error.message : "The payment could not be recorded."}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label={`Amount received (${currencyCode})`} isRequired value={amount} onChange={setAmount} minValue={0.01} maxValue={balance} step={0.01} />
          <TextField label="Received on" type="date" isRequired value={date} onChange={setDate} />
          <Select label="How" selectedKey={method} onSelectionChange={(key) => setMethod(String(key))}
            options={(accounts.data?.methods ?? [{ code: "upi", label: "UPI" }]).map((entry) => ({ value: entry.code, label: entry.label }))} />
          <Select label="Into" selectedKey={account} onSelectionChange={(key) => setAccount(String(key))}
            options={[{ value: DEFAULT_ACCOUNT, label: "The company's bank account" }, ...(accounts.data?.accounts ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
          <TextField className="sm:col-span-2" label="Reference" description="UTR, cheque number or UPI reference." value={reference} onChange={setReference} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!(amount > 0) || amount > balance + 0.005} onPress={() => save.mutate()}>Record payment</Button>
        </div>
      </div>
    </Dialog>
  );
}
