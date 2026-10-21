"use client";

// New (or draft) finished-goods receipt for one manufacturing order. It starts from the order's accepted, unreceived output — each reported
// production entry with what is accepted, already received and still receivable — so the storekeeper enters how much is handed over, where it
// goes and, for tracked goods, its lot or serial numbers; production is never re-entered. A destination other than the order's finished-goods
// warehouse needs an approval. "Save draft" moves nothing; the receipt's own page checks and posts it.
import { useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { itemUnits } from "@/features/manufacturing/boms/api/bom-api";
import { MO_BASE, errorMessage, errorStatus, newKey, qty } from "@/features/manufacturing/orders/api/mo-api";
import { FGR_BASE, createReceipt, getReceipt, receivableOutput, updateReceipt, type FinishedGoodsReceipt, type ReceivableOutput } from "../api/fgr-api";

type Row = { entryId: string; include: boolean; quantity: string; uomId: string; lotNumber: string; manufacturedOn: string; expiresOn: string; serials: string };
const NONE = "none";

export function FinishedGoodsReceiptFormScreen({ orderId, receiptId }: { orderId?: string; receiptId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "finished-goods-receipt", receiptId ?? ""), queryFn: () => getReceipt(receiptId!), enabled: Boolean(receiptId) });
  const order = orderId ?? existing.data?.order.id;
  const output = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "receivable-output", order ?? ""), queryFn: () => receivableOutput(order!), enabled: Boolean(order) });
  if (!orderId && !receiptId) return <ErrorState title="Choose a manufacturing order" description="Start a finished-goods receipt from the order's Production tab." />;
  if ((receiptId && existing.isLoading) || output.isLoading) return <LoadingState label="Loading the order's accepted output" rows={6} />;
  const failure = existing.error ?? output.error;
  if (failure || !output.data) {
    if (errorStatus(failure) === 403) return <PermissionState title="You don't have access to finished-goods receipts" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order's output" description={errorMessage(failure)} />;
  }
  return <ReceiptForm data={output.data} existing={existing.data ?? null} />;
}

function initialRows(data: ReceivableOutput, existing: FinishedGoodsReceipt | null): Row[] {
  return data.entries.filter((entry) => Number(entry.accepted) > 0 || existing?.lines.some((line) => line.productionEntryId === entry.id)).map((entry) => {
    const line = existing?.lines.find((row) => row.productionEntryId === entry.id);
    if (line) {
      return { entryId: entry.id, include: true, quantity: line.quantity, uomId: line.uomId, lotNumber: line.lotNumber ?? "", manufacturedOn: line.manufacturedOn ?? "", expiresOn: line.expiresOn ?? "",
        serials: line.serialNumbers.join("\n") };
    }
    const receivable = Number(entry.receivable);
    // A new receipt proposes everything receivable; the lot proposes the production batch's reference and its production day.
    return { entryId: entry.id, include: !existing && receivable > 0, quantity: receivable > 0 ? entry.receivable : "", uomId: data.item.uomId, lotNumber: entry.batch ?? "",
      manufacturedOn: entry.producedAt ? entry.producedAt.slice(0, 10) : "", expiresOn: "", serials: "" };
  });
}

function ReceiptForm({ data, existing }: { data: ReceivableOutput; existing: FinishedGoodsReceipt | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => initialRows(data, existing));
  const [warehouseId, setWarehouseId] = useState(existing?.destination.warehouse?.id ?? data.defaultWarehouseId);
  const [binId, setBinId] = useState(existing?.destination.location?.id ?? data.bins.find((bin) => bin.warehouseId === (existing?.destination.warehouse?.id ?? data.defaultWarehouseId) && bin.defaultReceiving)?.id ?? NONE);
  const [receiptDate, setReceiptDate] = useState(existing?.receiptDate ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", data.item.id), queryFn: () => itemUnits(data.item.id), staleTime: 60_000 });
  const set = (entryId: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.entryId === entryId ? { ...row, ...patch } : row)));
  const chosen = rows.filter((row) => row.include && Number(row.quantity) > 0);
  const total = chosen.reduce((sum, row) => sum + (row.uomId === data.item.uomId ? Number(row.quantity) : 0), 0);
  const elsewhere = warehouseId !== data.defaultWarehouseId;
  const bins = data.bins.filter((bin) => bin.warehouseId === warehouseId);
  const tracking = data.item.trackingType;
  const serialCount = (text: string) => new Set(text.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean)).size;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const lines = chosen.map((row) => ({ productionEntryId: row.entryId, quantity: row.quantity, uomId: row.uomId,
        ...(tracking === "batch" ? { lotNumber: row.lotNumber.trim() || null, manufacturedOn: row.manufacturedOn || null, expiresOn: row.expiresOn || null } : {}),
        ...(tracking === "serial" ? { serialNumbers: row.serials.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean) } : {}) }));
      const input = { lines, destinationWarehouseId: warehouseId, destinationLocationId: binId === NONE ? null : binId, receiptDate, notes: notes.trim() || undefined };
      const saved = await submitKey.run(async () => existing ? await updateReceipt(existing.id, { ...input, expectedVersion: existing.rowVersion })
        : await createReceipt({ ...input, manufacturingOrderId: data.orderId, idempotencyKey: key }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${FGR_BASE}/${saved.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing ? `Edit ${existing.number}` : "Receive finished goods"}
        description={`${data.orderNumber} · ${data.item.code} ${data.item.name}. Accepted ${qty(data.totals.accepted)} · received ${qty(data.totals.received)} · receivable ${qty(data.totals.receivable)} ${data.item.uom}. Saving keeps a draft: nothing enters stock until the receipt is posted.`} />
      {!data.eligible && <Notice tone="warning">{data.reason}</Notice>}
      {Number(data.totals.pending) > 0 && <Notice tone="neutral">{qty(data.totals.pending)} {data.item.uom} still waits for a quality decision and cannot be received yet.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Accepted output" description="Only accepted output that is not yet received can be taken. Several receipts may take from one entry; posting checks the quantities again.">
        <LinesTable columns={["", "Production entry", { label: "Accepted", numeric: true }, { label: "Received", numeric: true }, { label: "Receivable", numeric: true }, "Receive now",
          ...(tracking === "batch" ? ["Lot"] : tracking === "serial" ? ["Serial numbers"] : [])]}>
          {data.entries.filter((entry) => rows.some((row) => row.entryId === entry.id)).map((entry) => {
            const row = rows.find((candidate) => candidate.entryId === entry.id)!;
            const over = row.include && row.uomId === data.item.uomId && Number(row.quantity) > Number(entry.receivable);
            const serialsGiven = serialCount(row.serials);
            return (
              <tr key={entry.id}>
                <Cell><Checkbox aria-label={`Receive from ${entry.number}`} isSelected={row.include} isDisabled={Number(entry.receivable) === 0 && !row.include} onChange={(value) => set(entry.id, { include: value })} /></Cell>
                <Cell><span className="flex flex-col"><span>{entry.number}{entry.batch ? ` · ${entry.batch}` : ""}</span>
                  <span className="text-xs text-text-muted">{entry.producedAt ? formatDate(entry.producedAt) : ""}{Number(entry.rejected) ? ` · ${qty(entry.rejected)} rejected` : ""}{Number(entry.pending) ? ` · ${qty(entry.pending)} awaiting inspection` : ""}
                    {entry.drafted ? ` · ${qty(entry.drafted.quantity)} on draft ${entry.drafted.receipts}` : ""}</span></span></Cell>
                <Cell numeric>{qty(entry.accepted)}</Cell><Cell numeric>{qty(entry.received)}</Cell><Cell numeric>{qty(entry.receivable)}</Cell>
                <Cell>{row.include && (
                  <span className="flex flex-col gap-1">
                    <span className="flex gap-1">
                      <TextField aria-label={`${entry.number} quantity`} size="compact" inputMode="decimal" className="w-24" value={row.quantity} onChange={(value) => set(entry.id, { quantity: value })} />
                      <Select aria-label={`${entry.number} unit`} size="compact" selectedKey={row.uomId} onSelectionChange={(value) => set(entry.id, { uomId: String(value) })}
                        options={(units.data?.units ?? [{ uomId: data.item.uomId, code: data.item.uom }]).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
                    </span>
                    {over && <StatusBadge tone="danger">More than receivable</StatusBadge>}
                  </span>
                )}</Cell>
                {tracking === "batch" && <Cell>{row.include && (
                  <span className="flex flex-col gap-1">
                    <TextField aria-label={`${entry.number} lot number`} size="compact" placeholder="Lot number" value={row.lotNumber} onChange={(value) => set(entry.id, { lotNumber: value })} />
                    <span className="flex gap-1">
                      <TextField aria-label={`${entry.number} manufactured on`} size="compact" type="date" value={row.manufacturedOn} onChange={(value) => set(entry.id, { manufacturedOn: value })} />
                      <TextField aria-label={`${entry.number} expires on`} size="compact" type="date" value={row.expiresOn} onChange={(value) => set(entry.id, { expiresOn: value })} />
                    </span>
                    <span className="text-xs text-text-muted">Made on · expires on. The production batch is proposed as the lot.</span>
                  </span>
                )}</Cell>}
                {tracking === "serial" && <Cell>{row.include && (
                  <span className="flex flex-col gap-1">
                    <TextArea aria-label={`${entry.number} serial numbers`} rows={3} value={row.serials} onChange={(value) => set(entry.id, { serials: value })} placeholder="One per line, or separated by commas" />
                    <span className={`text-xs ${serialsGiven === Number(row.quantity) ? "text-text-muted" : "text-danger"}`}>{serialsGiven} of {qty(row.quantity || "0")} serial numbers</span>
                  </span>
                )}</Cell>}
              </tr>
            );
          })}
        </LinesTable>
        {!rows.length && <p className="text-sm text-text-muted">Nothing has been accepted on this order yet.</p>}
      </Panel>
      <Panel title="Destination">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Warehouse" selectedKey={warehouseId} onSelectionChange={(value) => { setWarehouseId(String(value)); setBinId(data.bins.find((bin) => bin.warehouseId === String(value) && bin.defaultReceiving)?.id ?? NONE); }}
            options={data.warehouses.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}${row.isOrderDefault ? " (the order's)" : ""}` }))} />
          <Select label="Bin" selectedKey={binId} onSelectionChange={(value) => setBinId(String(value))}
            options={[{ value: NONE, label: "Warehouse default" }, ...bins.map((bin) => ({ value: bin.id, label: `${bin.code} · ${bin.name}${bin.disposition !== "available" ? ` (${bin.disposition.replace(/_/g, " ")})` : ""}` }))]} />
          <TextField label="Receipt date" type="date" value={receiptDate} onChange={setReceiptDate} />
        </div>
        {elsewhere && <Notice tone="warning">This is not the order&apos;s finished-goods warehouse: the receipt needs an approval before it can post.</Notice>}
        <TextArea label="Notes" value={notes} onChange={setNotes} maxLength={1000} />
      </Panel>
      <div className="flex items-center justify-end gap-3">
        {chosen.length > 0 && <span className="text-sm text-text-muted">{chosen.length} entr{chosen.length === 1 ? "y" : "ies"}{total ? ` · ${qty(String(total))} ${data.item.uom}` : ""}</span>}
        <Button variant="ghost" onPress={() => router.replace(existing ? `${FGR_BASE}/${existing.id}` : `${MO_BASE}/${data.orderId}?tab=production`)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!chosen.length || !data.eligible || busy} onPress={save}>Save draft</Button>
      </div>
    </div>
  );
}
