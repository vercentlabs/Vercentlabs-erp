"use client";

// Raise a debit note on a posted invoice (Sales plan): why, and the taxable amount each line adds — taxed at that line's own GST.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { Cell, LinesTable } from "@/shared/ui/record";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

import { createDebitNote, getDebitNoteProposal } from "./api";

export function CreateDebitNoteDialog({ invoiceId, onClose, onDone }: { invoiceId: string; onClose: () => void; onDone: (debitNoteId: string) => void }) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "debit-proposal", invoiceId), queryFn: () => getDebitNoteProposal(invoiceId) });
  const [reason, setReason] = useState("rate_difference");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const data = proposal.data;
  const currency = data?.invoice.currencyCode ?? "INR";
  const lines = (data?.lines ?? []).map((line) => ({ ...line, amount: Number.isFinite(amounts[line.invoiceLineId]) ? amounts[line.invoiceLineId] : 0 }));
  const taxable = lines.reduce((total, line) => total + line.amount, 0);
  const tax = lines.reduce((total, line) => total + Math.round(line.amount * line.taxRate) / 100, 0);
  const save = useMutation({
    mutationFn: () => createDebitNote(invoiceId, { idempotencyKey, reasonCode: reason, reasonNote: note.trim() || undefined, debitDate: date,
      lines: lines.filter((line) => line.amount > 0).map((line) => ({ invoiceLineId: line.invoiceLineId, amount: line.amount })) }),
    onSuccess: ({ result }) => onDone(result.debitNoteId),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Debit note on ${data?.invoice.number ?? "the invoice"}`} size="lg"
      description="For an undercharge, a rate difference or a missed charge. Each amount is taxed at its line's GST; the customer owes it like a bill once posted.">
      <div className="flex flex-col gap-4">
        {(save.isError || proposal.isError) && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {((save.error ?? proposal.error) instanceof SalesApiError) ? (save.error ?? proposal.error)!.message : "The debit note could not be raised."}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Why" selectedKey={reason} onSelectionChange={(key) => setReason(String(key))}
            options={(data?.reasons ?? [{ code: "rate_difference", label: "Rate difference" }]).map((entry) => ({ value: entry.code, label: entry.label }))} />
          <TextField label="Debit note date" type="date" value={date} onChange={setDate} />
          <TextField label={reason === "other" ? "Explain" : "Note"} isRequired={reason === "other"} value={note} onChange={setNote} />
        </div>
        <LinesTable columns={["Item", { label: "Invoiced", numeric: true }, { label: "GST", numeric: true }, { label: "Add (taxable)", numeric: true }]}
          empty={proposal.isLoading ? "Loading…" : lines.length ? undefined : "The invoice has no lines."}>
          {lines.map((line) => (
            <tr key={line.invoiceLineId}>
              <Cell>{line.item}{line.hsnSacCode ? <span className="text-xs text-text-muted"> · HSN {line.hsnSacCode}</span> : null}</Cell>
              <Cell numeric>{money(currency, line.taxable)}</Cell>
              <Cell numeric>{line.taxRate}%</Cell>
              <Cell numeric><NumberField aria-label={`Add to ${line.item}`} size="compact" className="ml-auto w-36" value={line.amount} minValue={0} step={0.01}
                onChange={(value) => setAmounts((current) => ({ ...current, [line.invoiceLineId]: value }))} /></Cell>
            </tr>
          ))}
        </LinesTable>
        <p className="text-sm text-text-secondary">Taxable {money(currency, taxable)} · GST about {money(currency, tax)} · total about {money(currency, taxable + tax)}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!(taxable > 0) || (reason === "other" && !note.trim()) || save.isPending || save.isSuccess} onPress={() => save.mutate()}>
            Raise debit note
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
