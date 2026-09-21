"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { act, AccountingApiError, readView, useAccountingOptions, type Row } from "@/features/accounting/shared/client";
import { AccountingAlert, AccountingPanel } from "@/features/accounting/shared/AccountingUi";
import { money } from "@/features/accounting/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const METHODS = ["bank_transfer", "cash", "card", "upi", "cheque", "gateway", "other"].map((value) => ({ value, label: value.replace("_", " ") }));
const errorText = (e: unknown) => (e instanceof AccountingApiError ? e.message : "This could not be completed.");

// Receipts (money in, from a customer) and payments (money out, to a supplier). A receipt posts straight from
// draft; a payment goes through maker-checker (submit, a second person approves, then post). Allocation then
// settles the posted document against the party's open invoices or bills.
export function SettlementScreen({ side }: { side: "receipt" | "payment" }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const options = useAccountingOptions();
  const isReceipt = side === "receipt";
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [created, setCreated] = useState<Row | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", `${side}-open`, partyId),
    enabled: Boolean(partyId),
    queryFn: async () => ((await readView(isReceipt ? "customer-invoices" : "vendor-bills")).rows as Row[]).filter((r) => r.party_id === partyId && ["posted", "partially_paid", "overdue"].includes(String(r.status))),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const fail = (e: unknown) => { setError(errorText(e)); setMessage(null); };
  const done = (m: string) => { setMessage(m); setError(null); void refresh(); };

  const create = useMutation({
    mutationFn: async () => (await act<{ record: Row }>(isReceipt ? "receipt-create" : "payment-create", { partyId, amount: Number(amount), paymentMethod: method, bankAccountId: bankAccountId || undefined, externalReference: reference || undefined })).record,
    onSuccess: (r) => { setCreated(r); done(`${isReceipt ? "Receipt" : "Payment"} ${String(r.receipt_number ?? r.payment_number)} saved as a draft.`); },
    onError: fail,
  });
  const step = useMutation({
    mutationFn: async (action: string) => (await act<{ record: Row }>(action, { id: created?.id })).record,
    onSuccess: async (r) => {
      // submit/approve return a small status object; reload nothing and just carry the new status forward
      setCreated((cur) => (cur ? { ...cur, ...r, id: cur.id } : r));
      done("Done.");
    },
    onError: fail,
  });
  const allocate = useMutation({
    mutationFn: async () => (await act<{ record: Row }>(isReceipt ? "receipt-allocate" : "payment-allocate", {
      id: created?.id,
      allocations: Object.entries(allocations).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ [isReceipt ? "invoiceId" : "billId"]: id, amount: Number(v) })),
    })).record,
    onSuccess: (r) => { setCreated((cur) => (cur ? { ...cur, ...r } : r)); setAllocations({}); done("Allocated."); },
    onError: fail,
  });

  const status = String(created?.status ?? "");
  const total = Object.values(allocations).reduce((s, v) => s + Number(v || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={isReceipt ? "Customer receipts" : "Supplier payments"} description={isReceipt ? "Record money received, post it to the bank, and settle open invoices." : "Record a payment to a supplier. A payment needs a second person to approve it before it posts."} />
      {error && <AccountingAlert>{error}</AccountingAlert>}
      {message && <AccountingAlert tone="success">{message}</AccountingAlert>}
      <AccountingPanel title="1. Record">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label={isReceipt ? "Customer" : "Supplier"} options={((isReceipt ? options.data?.customers : options.data?.suppliers) ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={partyId || null} onSelectionChange={(k) => setPartyId(String(k ?? ""))} isRequired />
          <TextField label="Amount" value={amount} onChange={setAmount} isRequired />
          <Select label="Method" options={METHODS} selectedKey={method} onSelectionChange={(k) => setMethod(String(k))} />
          <Select label="Bank account" options={(options.data?.bankAccounts ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={bankAccountId || null} onSelectionChange={(k) => setBankAccountId(String(k ?? ""))} />
          <TextField label="Reference" value={reference} onChange={setReference} />
        </div>
        <div className="flex justify-end">
          <Button variant="primary" isDisabled={!partyId || Number(amount) <= 0} isLoading={create.isPending} onPress={() => create.mutate()}>Save draft</Button>
        </div>
      </AccountingPanel>
      {created && (
        <AccountingPanel title={`2. ${isReceipt ? "Post" : "Approve and post"}: ${String(created.receipt_number ?? created.payment_number ?? "")} (${status.replace(/_/g, " ")})`}>
          <div className="flex flex-wrap gap-2">
            {isReceipt && status === "draft" && <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate("receipt-post")}>Post receipt</Button>}
            {!isReceipt && status === "draft" && <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate("payment-submit")}>Submit for approval</Button>}
            {!isReceipt && status === "pending_approval" && <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate("payment-approve")}>Approve (must be someone other than the submitter)</Button>}
            {!isReceipt && status === "approved" && <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate("payment-post")}>Post payment</Button>}
          </div>
        </AccountingPanel>
      )}
      {created && ["posted", "partially_applied"].includes(status) && (
        <AccountingPanel title={`3. Allocate to open ${isReceipt ? "invoices" : "bills"} (unapplied ${money(created.unapplied_amount)})`}>
          {(open.data ?? []).length === 0 && <p className="text-sm text-text-muted">No open {isReceipt ? "invoices" : "bills"} for this {isReceipt ? "customer" : "supplier"}.</p>}
          <div className="flex flex-col gap-2">
            {(open.data ?? []).map((r) => (
              <div key={r.id} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
                <span className="text-sm font-medium">{String(r.invoice_number ?? r.bill_number)}: outstanding {money(r.outstanding_amount)}</span>
                <TextField label="Apply amount" value={allocations[r.id] ?? ""} onChange={(v) => setAllocations((cur) => ({ ...cur, [r.id]: v }))} />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" isDisabled={total <= 0} isLoading={allocate.isPending} onPress={() => allocate.mutate()}>Allocate {money(total)}</Button>
          </div>
        </AccountingPanel>
      )}
    </div>
  );
}
