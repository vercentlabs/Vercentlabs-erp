"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { act, AccountingApiError, useAccountingOptions } from "@/features/accounting/shared/client";
import { AccountingAlert, AccountingPanel } from "@/features/accounting/shared/AccountingUi";
import { money } from "@/features/accounting/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export type BuilderKind = "journal" | "invoice" | "bill";
type Line = { accountId: string; description: string; quantity: string; unitPrice: string; taxAmount: string; debit: string; credit: string };
const blank = (): Line => ({ accountId: "", description: "", quantity: "1", unitPrice: "", taxAmount: "", debit: "", credit: "" });
const today = () => new Date().toISOString().slice(0, 10);
const num = (value: string) => Number(value || 0);
const errorText = (e: unknown) => (e instanceof AccountingApiError ? e.message : "This could not be saved.");

const COPY: Record<BuilderKind, { title: string; description: string; back: string; action: string }> = {
  journal: { title: "New journal entry", description: "Debits must equal credits. The entry is saved as a draft; submit it, then post it once approved.", back: "/accounting/journals", action: "journal-create" },
  invoice: { title: "New customer invoice", description: "Lines book revenue (or the account you pick); tax on a line is recorded in the tax ledger when the invoice posts.", back: "/accounting/customer-invoices", action: "invoice-create" },
  bill: { title: "New supplier bill", description: "Lines book expense (or the account you pick). A bill defaults to needing a second approver before it can post.", back: "/accounting/supplier-invoices", action: "bill-create" },
};

// A document with a dynamic list of lines -- too much structure for the generic Register dialog. One screen
// serves the three line-based documents (journal entry, customer invoice, supplier bill).
export function DocumentBuilder({ kind }: { kind: BuilderKind }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const options = useAccountingOptions();
  const copy = COPY[kind];
  const [partyId, setPartyId] = useState("");
  const [journalId, setJournalId] = useState("");
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>(kind === "journal" ? [blank(), blank()] : [blank()]);
  const [error, setError] = useState<string | null>(null);

  const debit = lines.reduce((s, l) => s + num(l.debit), 0);
  const credit = lines.reduce((s, l) => s + num(l.credit), 0);
  const docTotal = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice) + num(l.taxAmount), 0);
  const update = (i: number, patch: Partial<Line>) => setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () => {
      if (kind === "journal") {
        return act(copy.action, { journalId, accountingDate: date, description, reference: reference || undefined, lines: lines.map((l) => ({ accountId: l.accountId, description: l.description || undefined, debit: num(l.debit), credit: num(l.credit) })) });
      }
      const docLines = lines.map((l) => ({ description: l.description, quantity: num(l.quantity) || 1, unitPrice: num(l.unitPrice), taxAmount: num(l.taxAmount) || undefined, ...(l.accountId ? { accountId: l.accountId } : {}) }));
      if (kind === "invoice") return act(copy.action, { partyId, invoiceDate: date, notes: description || undefined, lines: docLines });
      return act(copy.action, { partyId, billDate: date, supplierInvoiceNumber: reference || undefined, notes: description || undefined, lines: docLines });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
      router.push(copy.back);
    },
    onError: (e) => setError(errorText(e)),
  });

  const partyOptions = (kind === "invoice" ? options.data?.customers : options.data?.suppliers) ?? [];
  const accountOptions = (options.data?.postingAccounts ?? []).map((o) => ({ value: o.id, label: `${o.code} ${o.name}` }));
  const balanced = kind !== "journal" || (debit > 0 && Math.abs(debit - credit) < 0.005);
  const missing = (kind === "journal" ? !journalId || !description.trim() || lines.some((l) => !l.accountId) : !partyId || lines.some((l) => !l.description.trim() || num(l.unitPrice) <= 0)) || !balanced;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={copy.title} description={copy.description} />
      {error && <AccountingAlert>{error}</AccountingAlert>}
      <AccountingPanel title="Header">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {kind === "journal" ? (
            <Select label="Journal" options={(options.data?.journals ?? []).map((o) => ({ value: o.id, label: `${o.name} (${o.code})` }))} selectedKey={journalId || null} onSelectionChange={(k) => setJournalId(String(k ?? ""))} isRequired />
          ) : (
            <Select label={kind === "invoice" ? "Customer" : "Supplier"} options={partyOptions.map((o) => ({ value: o.id, label: o.name }))} selectedKey={partyId || null} onSelectionChange={(k) => setPartyId(String(k ?? ""))} isRequired />
          )}
          <TextField label={kind === "journal" ? "Accounting date" : kind === "invoice" ? "Invoice date" : "Bill date"} type="date" value={date} onChange={setDate} isRequired />
          <TextField label={kind === "journal" ? "Description" : "Notes"} value={description} onChange={setDescription} isRequired={kind === "journal"} />
          {kind !== "invoice" && <TextField label={kind === "journal" ? "Reference" : "Supplier invoice number"} value={reference} onChange={setReference} />}
        </div>
      </AccountingPanel>
      <AccountingPanel title="Lines" actions={<Button variant="secondary" onPress={() => setLines((cur) => [...cur, blank()])}>Add line</Button>}>
        <div className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Select label={kind === "journal" ? "Account" : "Account (optional, defaults from mapping)"} options={accountOptions} selectedKey={l.accountId || null} onSelectionChange={(k) => update(i, { accountId: String(k ?? "") })} isRequired={kind === "journal"} />
              </div>
              {kind === "journal" ? (
                <>
                  <TextField label="Description" value={l.description} onChange={(v) => update(i, { description: v })} />
                  <TextField label="Debit" value={l.debit} onChange={(v) => update(i, { debit: v, credit: v ? "" : l.credit })} />
                  <TextField label="Credit" value={l.credit} onChange={(v) => update(i, { credit: v, debit: v ? "" : l.debit })} />
                </>
              ) : (
                <>
                  <TextField label="Description" value={l.description} onChange={(v) => update(i, { description: v })} isRequired />
                  <TextField label="Quantity" value={l.quantity} onChange={(v) => update(i, { quantity: v })} />
                  <TextField label="Unit price" value={l.unitPrice} onChange={(v) => update(i, { unitPrice: v })} isRequired />
                  <TextField label="Tax amount" value={l.taxAmount} onChange={(v) => update(i, { taxAmount: v })} />
                </>
              )}
              {lines.length > (kind === "journal" ? 2 : 1) && <Button variant="ghost" onPress={() => setLines((cur) => cur.filter((_, idx) => idx !== i))}>Remove</Button>}
            </div>
          ))}
        </div>
        <div className="mt-2 text-sm text-text-muted">
          {kind === "journal" ? (
            <span>Debit {money(debit)} · Credit {money(credit)} · {balanced ? "Balanced" : `Out of balance by ${money(Math.abs(debit - credit))}`}</span>
          ) : (
            <span>Document total {money(docTotal)}</span>
          )}
        </div>
      </AccountingPanel>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={() => router.push(copy.back)}>Cancel</Button>
        <Button variant="primary" isDisabled={missing} isLoading={save.isPending} onPress={() => save.mutate()}>Save draft</Button>
      </div>
    </div>
  );
}
