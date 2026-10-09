"use client";

// The steps of a sales return that need something from the user first. Each
// sends only what was entered; the server checks quantities against what was
// delivered less what already came back (again when the return is received),
// moves the stock only on Receive, and makes credit notes at the invoice's
// own values.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import {
  cancelReturn, createReturn, creditReturn, getReturnProposal, receiveReturn, updateReturn, type Disposition, type ReturnDetail,
} from "../api/returns-api";
import { Notice } from "@/shared/ui/Panel";

export function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const optional = (value: string) => value.trim() || undefined;

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children, tone = "primary" }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode; tone?: "primary" | "danger";
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <Notice>{failureText(error, fallback)}</Notice>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

type Row = { id: string; name: string; unit: string | null; delivered: number; returned: number; returnable: number; stockTracked: boolean };
type Entry = { quantity: number; disposition: Disposition };
const CONDITION_HINT: Record<string, string> = { restock: "back to sellable stock", inspection: "held for inspection, not sellable", damaged: "held as damaged, not sellable", other: "held, not sellable" };

// Product · Delivered · Already returned · Returnable · Return now · Condition, one row per delivery line.
function ReturnRows({ rows, values, dispositions, onChange }: {
  rows: Row[]; values: Record<string, Entry>; dispositions: Array<{ code: string; label: string }>; onChange: (next: Record<string, Entry>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const entry = values[row.id] ?? { quantity: 0, disposition: "inspection" as Disposition };
        return (
          <div key={row.id} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
            <span className="flex flex-col text-sm">
              <span className="font-medium">{row.name}</span>
              <span className="text-xs text-text-muted">
                Delivered {amount(row.delivered)} · already returned {amount(row.returned)} · returnable {amount(row.returnable)}{row.unit ? ` ${row.unit}` : ""}{row.stockTracked ? "" : " · not stock tracked"}
              </span>
            </span>
            <NumberField aria-label={`Quantity of ${row.name} returned`} value={entry.quantity} minValue={0} maxValue={row.returnable} step={1}
              onChange={(value) => onChange({ ...values, [row.id]: { ...entry, quantity: Number.isFinite(value) ? value : 0 } })} />
            <Select aria-label={`Condition of ${row.name}`} selectedKey={entry.disposition} options={dispositions.map((entry) => ({ value: entry.code, label: entry.label }))}
              onSelectionChange={(selected) => onChange({ ...values, [row.id]: { ...entry, disposition: String(selected) as Disposition } })} />
          </div>
        );
      })}
    </div>
  );
}

function useWarehouses() {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options.warehouses), staleTime: 60_000 });
}

// From a dispatched delivery: a Draft return. Nothing moves until it is received.
export function CreateReturnDialog({ deliveryId, number, onClose, onDone }: { deliveryId: string; number: string; onClose: () => void; onDone: (returnId: string) => void }) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "delivery", deliveryId, "return-proposal"),
    queryFn: () => getReturnProposal(deliveryId).then((r) => r.proposal), staleTime: 0, gcTime: 0,
  });
  const warehouses = useWarehouses();
  const [values, setValues] = useState<Record<string, Entry>>({});
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const rows: Row[] = (proposal.data?.lines ?? []).map((line) => ({
    id: line.deliveryLineId, name: line.itemName, unit: line.unit, delivered: line.delivered, returned: line.returned, returnable: line.returnable, stockTracked: line.stockTracked,
  }));
  const lines = Object.entries(values).filter(([, entry]) => entry.quantity > 0).map(([deliveryLineId, entry]) => ({ deliveryLineId, quantity: entry.quantity, disposition: entry.disposition }));
  const target = warehouseId ?? proposal.data?.warehouseId ?? null;
  const save = useMutation({
    mutationFn: () => createReturn(deliveryId, {
      idempotencyKey, lines, reasonCode, reasonNote: optional(reasonNote), warehouseId: target ?? undefined, customerNotes: optional(customerNotes), internalNotes: optional(internalNotes),
    }),
    onSuccess: ({ result }) => onDone(result.returnId),
  });
  return (
    <Shell title={`Create a sales return from ${number}`} description="The return is created as a draft: stock comes back only when it is received. Enter what comes back, why and in what condition."
      size="lg" error={save.error ?? proposal.error} fallback="The return could not be created." onClose={onClose} label="Create Draft" isLoading={save.isPending}
      isDisabled={!lines.length || !reasonCode || (reasonCode === "other" && !reasonNote.trim()) || !target} onPress={() => save.mutate()}>
      {proposal.isLoading ? <p className="text-sm text-text-muted">Loading what can come back…</p>
        : !rows.some((row) => row.returnable > 0) ? <p className="text-sm text-text-muted">Everything delivered has already come back.</p>
          : <ReturnRows rows={rows.filter((row) => row.returnable > 0)} values={values} dispositions={proposal.data?.dispositions ?? []} onChange={setValues} />}
      {lines.length > 0 && (
        <p className="text-xs text-text-muted">{lines.map((line) => `${rows.find((row) => row.id === line.deliveryLineId)?.name}: ${CONDITION_HINT[line.disposition]}`).join(" · ")}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Reason" isRequired placeholder="Choose a reason" options={(proposal.data?.reasons ?? []).map((entry) => ({ value: entry.code, label: entry.label }))}
          selectedKey={reasonCode || null} onSelectionChange={(selected) => setReasonCode(String(selected ?? ""))} />
        <Select label="Return warehouse" isRequired description="Where the goods physically come back to. Another warehouse than the delivery's needs permission."
          selectedKey={target} options={(warehouses.data ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
          onSelectionChange={(selected) => setWarehouseId(String(selected))} />
      </div>
      <TextField label="Reason details" isRequired={reasonCode === "other"} value={reasonNote} onChange={setReasonNote} />
      <TextArea label="Customer notes" description="Printed on the return note." value={customerNotes} onChange={setCustomerNotes} />
      <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

// A draft: what comes back, condition, reason, warehouse, date, notes.
export function EditReturnDialog({ detail, onClose, onDone }: { detail: ReturnDetail; onClose: () => void; onDone: () => void }) {
  const salesReturn = detail.salesReturn;
  const warehouses = useWarehouses();
  const rows: Row[] = detail.lines.map((line) => ({
    id: line.delivery_line_id, name: line.item_name_snapshot, unit: line.uom_snapshot, delivered: line.delivered ?? 0, returned: line.returned_elsewhere ?? 0,
    returnable: line.returnable_now ?? line.quantity, stockTracked: true,
  }));
  const [values, setValues] = useState<Record<string, Entry>>(() => Object.fromEntries(detail.lines.map((line) => [line.delivery_line_id, { quantity: line.quantity, disposition: line.disposition }])));
  const [reasonCode, setReasonCode] = useState(salesReturn.reason_code);
  const [reasonNote, setReasonNote] = useState(salesReturn.reason_note ?? "");
  const [warehouseId, setWarehouseId] = useState(salesReturn.warehouse_id);
  const [returnDate, setReturnDate] = useState(String(salesReturn.return_date).slice(0, 10));
  const [customerNotes, setCustomerNotes] = useState(salesReturn.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(salesReturn.internal_notes ?? "");
  const lines = Object.entries(values).map(([deliveryLineId, entry]) => ({ deliveryLineId, quantity: entry.quantity, disposition: entry.disposition }));
  const save = useMutation({
    mutationFn: () => updateReturn(salesReturn.id, {
      expectedVersion: salesReturn.version, lines, reasonCode, reasonNote: reasonNote.trim() || null, ...(warehouseId !== salesReturn.warehouse_id ? { warehouseId } : {}),
      returnDate, customerNotes: customerNotes.trim() || null, internalNotes: internalNotes.trim() || null,
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title={`Edit ${salesReturn.return_number}`} size="lg" error={save.error} fallback="The return could not be saved." onClose={onClose} label="Save" isLoading={save.isPending}
      isDisabled={!lines.some((line) => line.quantity > 0) || (reasonCode === "other" && !reasonNote.trim())} onPress={() => save.mutate()}>
      <ReturnRows rows={rows} values={values} dispositions={detail.dispositions} onChange={setValues} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Reason" options={detail.reasons.map((entry) => ({ value: entry.code, label: entry.label }))} selectedKey={reasonCode} onSelectionChange={(selected) => setReasonCode(String(selected))} />
        <Select label="Return warehouse" isDisabled={!detail.actions.selectWarehouse} selectedKey={warehouseId}
          options={(warehouses.data ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} onSelectionChange={(selected) => setWarehouseId(String(selected))} />
        <TextField label="Return date" type="date" value={returnDate} onChange={setReturnDate} />
      </div>
      <TextField label="Reason details" isRequired={reasonCode === "other"} value={reasonNote} onChange={setReasonNote} />
      <TextArea label="Customer notes" description="Printed on the return note." value={customerNotes} onChange={setCustomerNotes} />
      <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

export function ReceiveReturnDialog({ detail, onClose, onDone }: { detail: ReturnDetail; onClose: () => void; onDone: () => void }) {
  const salesReturn = detail.salesReturn;
  const save = useMutation({ mutationFn: () => receiveReturn(salesReturn.id, salesReturn.version), onSuccess: onDone });
  return (
    <Shell title={`Receive ${salesReturn.return_number}?`}
      description={`The goods come back into ${salesReturn.warehouse_name ?? "the warehouse"} now. A received return cannot be edited or cancelled; corrections go through inventory.`}
      error={save.error} fallback="The return could not be received." onClose={onClose} label="Receive Return" isLoading={save.isPending} onPress={() => save.mutate()}>
      <ul className="flex flex-col gap-1 text-sm">
        {detail.lines.map((line) => (
          <li key={line.id}><span className="font-medium">{line.item_name_snapshot}</span> × {amount(line.quantity)}{line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}
            <span className="text-text-muted"> · {line.dispositionLabel}: {CONDITION_HINT[line.disposition]}</span></li>
        ))}
      </ul>
      {detail.draftWarnings.map((warning, index) => <Notice key={index} tone="warning">{warning.message}</Notice>)}
    </Shell>
  );
}

export function CancelReturnDialog({ detail, onClose, onDone }: { detail: ReturnDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelReturn(detail.salesReturn.id, optional(reason)), onSuccess: onDone });
  return (
    <Shell title={`Cancel draft ${detail.salesReturn.return_number}?`} description="Nothing has come back into stock, so nothing is reversed." error={save.error}
      fallback="The return could not be cancelled." onClose={onClose} label="Cancel Draft" tone="danger" isLoading={save.isPending} onPress={() => save.mutate()}>
      <TextArea label="Reason" value={reason} onChange={setReason} />
    </Shell>
  );
}

// A draft credit note, against the original invoice, for what came back after it was invoiced.
export function ReturnCreditDialog({ detail, onClose, onDone }: { detail: ReturnDetail; onClose: () => void; onDone: (creditNotes: Array<{ creditNoteId: string; creditNoteNumber: string }>) => void }) {
  const lines = detail.credit.lines.filter((line) => line.creditable > 0);
  const [values, setValues] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const chosen = lines.map((line) => ({ returnLineId: line.returnLineId, quantity: values[line.returnLineId] ?? line.creditable })).filter((line) => line.quantity > 0);
  const save = useMutation({
    mutationFn: () => creditReturn(detail.salesReturn.id, { idempotencyKey, reason: optional(reason), lines: chosen }),
    onSuccess: ({ result }) => onDone(result.creditNotes),
  });
  return (
    <Shell title={`Credit note for ${detail.salesReturn.return_number}`}
      description="For what came back after it was invoiced: credited against the original invoice at its prices, discounts and tax. One draft credit note per invoice; nothing is posted until someone posts it. No refund is made."
      size="lg" error={save.error} fallback="The credit note could not be created." onClose={onClose} label="Create Draft Credit Note" isLoading={save.isPending} isDisabled={!chosen.length} onPress={() => save.mutate()}>
      {lines.map((line) => (
        <div key={line.returnLineId} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <span className="flex flex-col text-sm"><span className="font-medium">{line.item}</span>
            <span className="text-xs text-text-muted">Returned {amount(line.quantity)} · invoiced before it came back {amount(line.invoiced)} · credited {amount(line.credited)}</span></span>
          <NumberField aria-label={`Quantity of ${line.item} to credit`} value={values[line.returnLineId] ?? line.creditable} minValue={0} maxValue={line.creditable} step={1}
            onChange={(value) => setValues({ ...values, [line.returnLineId]: Number.isFinite(value) ? value : 0 })} />
        </div>
      ))}
      <TextField label="Reason" description="Left empty, the return reason is used." value={reason} onChange={setReason} />
    </Shell>
  );
}
