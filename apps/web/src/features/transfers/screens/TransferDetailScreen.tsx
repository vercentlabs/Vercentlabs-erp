"use client";

// One transfer: Overview, Items, Tracking (batches and serial numbers), Dispatch, Receipt, Inventory (its Stock Ledger postings) and History.
// A draft is edited, confirmed (reserving the source stock) or cancelled; a confirmed one is dispatched (in transit) or completed (direct); what
// arrives is received, fully or partly, and anything confirmed lost is written off on purpose. A completed transfer is reversed, never edited.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, EmptyState, ErrorState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { PropertyList } from "@/shared/ui/PropertyList";
import { Cell, HistoryList, LinesTable, MoreActions, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  DISPOSITION_LABEL, STATUS_LABEL, STATUS_TONE, TRANSFERS_BASE, cancelTransfer, completeTransfer, confirmTransfer, dispatchTransfer, errorCode, errorMessage, errorsOf, getTransfer,
  getTransferOptions, receiveTransfer, returnToDraft, reverseTransfer, validateTransfer, writeOffTransit, type ReceiptLineInput, type TransferDetail, type TransferLine,
} from "../api/transfers-api";

export function TransferDetailScreen({ transferId }: { transferId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "transfers", "detail", transferId);
  const detail = useQuery({ queryKey: key, queryFn: () => getTransfer(transferId) });
  const refresh = (data?: TransferDetail) => { if (data) queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "transfers") }); };
  const [dialog, setDialog] = useState<"cancel" | "receive" | "write-off" | "reverse" | null>(null);
  const [tab, setTab] = useState("overview");
  const status = detail.data?.transfer.status;
  const validation = useQuery({ queryKey: [...key, "validation", status], queryFn: () => validateTransfer(transferId), enabled: status === "draft" || status === "confirmed" });
  const step = useMutation({
    mutationFn: (action: "confirm" | "draft" | "dispatch" | "complete") => ({ confirm: confirmTransfer, draft: returnToDraft, dispatch: dispatchTransfer, complete: completeTransfer })[action](transferId),
    onSuccess: refresh,
  });

  if (detail.isLoading) return <LoadingState label="Loading transfer" rows={6} />;
  if (detail.isError) return errorCode(detail.error) === "TRANSFER_NOT_FOUND"
    ? <EmptyState title="Transfer not found" description="It does not exist, or it is between warehouses you cannot see." action={{ label: "Back to transfers", onPress: () => router.push(TRANSFERS_BASE) }} />
    : <ErrorState title="Could not load the transfer" description={errorMessage(detail.error)} action={{ label: "Try again", onPress: () => void detail.refetch() }} />;
  const data = detail.data!;
  const head = data.transfer;
  const can = data.capabilities;
  const kind = head.type === "location" ? "Location transfer" : head.mode === "direct" ? "Direct warehouse transfer" : "Warehouse transfer through transit";
  const open = head.status === "draft" || head.status === "confirmed";
  const busy = (action: string) => step.isPending && step.variables === action;
  // The next step is the primary action; Edit and Back to draft sit beside it; cancelling, writing off and reversing are in More actions.
  const primaryAction = can.confirm ? <Button variant="primary" isLoading={busy("confirm")} onPress={() => step.mutate("confirm")}>Confirm and reserve</Button>
    : can.dispatch ? <Button variant="primary" isLoading={busy("dispatch")} onPress={() => step.mutate("dispatch")}>Dispatch</Button>
      : can.complete ? <Button variant="primary" isLoading={busy("complete")} onPress={() => step.mutate("complete")}>Complete transfer</Button>
        : can.receive ? <Button variant="primary" onPress={() => setDialog("receive")}>Receive</Button> : undefined;

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{head.number} <span className="text-base font-normal whitespace-nowrap text-text-muted">{kind}</span></>,
          status: <StatusBadge tone={STATUS_TONE[head.status]}>{STATUS_LABEL[head.status]}</StatusBadge>,
          fields: [
            { label: "From", value: head.source },
            { label: "To", value: head.type === "location" ? "Same warehouse" : head.destination },
            { label: "Date", value: formatDate(head.transferDate) },
            ...(head.type === "warehouse" ? [{ label: "Expected arrival", value: head.expectedArrivalDate ? formatDate(head.expectedArrivalDate) : "Not set" }] : []),
            { label: "Items", value: String(data.lines.length) },
            ...(head.inTransit > 0 ? [{ label: "In transit", value: quantity(head.inTransit) }] : []),
          ],
          primaryAction,
          secondaryActions: (
            <>
              {can.edit && <Button variant="secondary" onPress={() => router.push(`${TRANSFERS_BASE}/${head.id}/edit`)}>Edit</Button>}
              {can.backToDraft && <Button variant="secondary" isLoading={busy("draft")} onPress={() => step.mutate("draft")}>Back to draft</Button>}
              <MoreActions actions={[
                { id: "cancel", label: "Cancel transfer", show: can.cancel, run: () => setDialog("cancel") },
                { id: "write-off", label: "Write off transit loss", show: can.writeOff, run: () => setDialog("write-off") },
                { id: "reverse", label: "Reverse transfer", show: can.reverse, run: () => setDialog("reverse") },
              ]} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            {step.error ? <Notice>{errorMessage(step.error)}
              {errorsOf(step.error).length > 1 && <ul className="mt-1 list-disc pl-5">{errorsOf(step.error).map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}</Notice> : null}
            {open && validation.data && !validation.data.ready && !step.error && (
              <Notice tone="warning"><p className="font-medium">Not ready against current stock:</p>
                <ul className="list-disc pl-5">{validation.data.errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul></Notice>
            )}
            {head.inTransit > 0 && <Notice tone="neutral">{quantity(head.inTransit)} still in transit: owned by the company, at neither warehouse, until received or written off.</Notice>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Transfer sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items</Tab>
            <Tab id="tracking">Tracking</Tab>
            {head.type === "warehouse" && <Tab id="dispatch">Dispatch</Tab>}
            {head.type === "warehouse" && <Tab id="receipt">Receipt</Tab>}
            <Tab id="inventory">Inventory</Tab>
            <Tab id="history">History</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <PropertyList title="Transfer" columns={3} items={[
                { label: "Type", value: kind },
                { label: "From", value: `${head.source} · ${head.sourceName}` },
                { label: "To", value: head.type === "location" ? "The same warehouse" : `${head.destination} · ${head.destinationName}` },
                { label: "Transfer date", value: formatDate(head.transferDate) },
                { label: "Expected arrival", value: head.expectedArrivalDate ? formatDate(head.expectedArrivalDate) : null },
                { label: "Reason", value: head.reason },
                { label: "Reference", value: head.reference },
                { label: "Notes", value: head.notes ? <span className="whitespace-pre-wrap">{head.notes}</span> : null, wide: true },
              ]} />
              {data.reservations.length > 0 && (
                <Panel title="Reservations" description="Source stock held for this transfer until it moves.">
                  <LinesTable columns={["Reservation", "Status", { label: "Held", numeric: true }, { label: "Moved", numeric: true }]}>
                    {data.reservations.map((entry) => (
                      <tr key={entry.number}><Cell>{entry.number}</Cell><Cell>{entry.status}</Cell><Cell numeric>{quantity(entry.active)}</Cell><Cell numeric>{quantity(entry.consumed)}</Cell></tr>
                    ))}
                  </LinesTable>
                </Panel>
              )}
              <PropertyList title="Record" columns={3} items={[
                { label: "Created", value: byLine(head.createdAt, head.createdByName) },
                { label: "Confirmed", value: byLine(head.confirmedAt, head.confirmedByName) },
                { label: "Cancelled", value: head.cancelledAt ? `${formatDateTime(head.cancelledAt)}${head.cancelReason ? ` · ${head.cancelReason}` : ""}` : null },
                { label: "Reversed", value: head.reversedAt ? `${formatDateTime(head.reversedAt)}${head.reversalReason ? ` · ${head.reversalReason}` : ""}` : null },
              ]} />
            </div>
          </TabPanel>

          <TabPanel id="items">
            <Panel title="Items" description="Quantities in the unit entered and in the item's base unit.">
              <LinesTable columns={["#", "SKU", "Item", "From", "To", "Stock", { label: "Quantity", numeric: true }, { label: "Base quantity", numeric: true },
                ...(open ? [{ label: "Available now", numeric: true }] : [{ label: "Dispatched", numeric: true }, { label: "Received", numeric: true }, { label: "Lost", numeric: true }, { label: "In transit", numeric: true }])]}>
                {data.lines.map((line) => (
                  <tr key={line.id}>
                    <Cell>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.itemName}</Cell><Cell>{line.sourceLocation}</Cell><Cell>{line.destinationLocation}</Cell>
                    <Cell>{DISPOSITION_LABEL[line.disposition]}</Cell>
                    <Cell numeric>{quantity(line.quantity, line.uom)}{line.conversion !== 1 ? ` × ${line.conversion}` : ""}</Cell><Cell numeric>{quantity(line.baseQuantity, line.baseUom)}</Cell>
                    {open
                      ? <Cell numeric>{line.availableNow === undefined ? null : <span className={line.availableNow < line.baseQuantity ? "text-warning" : ""}>{quantity(line.availableNow)}</span>}</Cell>
                      : <><Cell numeric>{quantity(line.dispatched)}</Cell><Cell numeric>{quantity(line.received)}</Cell><Cell numeric>{line.lost ? quantity(line.lost) : null}</Cell>
                        <Cell numeric>{line.inTransit ? quantity(line.inTransit) : null}</Cell></>}
                  </tr>
                ))}
              </LinesTable>
            </Panel>
          </TabPanel>

          <TabPanel id="tracking">
            <Panel title="Batches and serial numbers">
              {data.lines.every((line) => !line.batches.length && !line.serials.length) ? <p className="text-sm text-text-muted">No batch or serial-numbered items.</p> : (
                <div className="flex flex-col gap-3 text-sm">
                  {data.lines.filter((line) => line.batches.length || line.serials.length).map((line) => (
                    <div key={line.id} className="flex flex-col gap-1">
                      <p className="font-medium">Line {line.lineNumber} · {line.sku}</p>
                      {line.batches.map((batch) => <p key={batch.batchId}>Batch {batch.batch}{batch.expiresOn ? ` (expires ${formatDate(batch.expiresOn)})` : ""}: {quantity(batch.quantity)}
                        {batch.received ? ` · ${quantity(batch.received)} received` : ""}{batch.lost ? ` · ${quantity(batch.lost)} lost` : ""}</p>)}
                      {line.serials.length > 0 && <p>Serials: {line.serials.map((serial) => `${serial.serialNumber} (${serial.status.replace("_", " ")})`).join(", ")}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </TabPanel>

          {head.type === "warehouse" && (
            <TabPanel id="dispatch">
              <PropertyList title="Dispatch" columns={3} items={[
                { label: "Mode", value: head.mode === "direct" ? "Direct: out and in in one posting" : "In transit" },
                { label: "Dispatched", value: byLine(head.dispatchedAt, head.dispatchedByName) },
                { label: "Dispatch date", value: head.dispatchDate ? formatDate(head.dispatchDate) : null },
                { label: "Carrier", value: head.carrier }, { label: "Vehicle", value: head.vehicleNumber }, { label: "Transport document", value: head.transportReference },
              ]} />
            </TabPanel>
          )}
          {head.type === "warehouse" && (
            <TabPanel id="receipt">
              <div className="flex flex-col gap-6">
                <PropertyList title="Receipt" columns={3} items={[
                  { label: "Receipt date", value: head.receiptDate ? formatDate(head.receiptDate) : null },
                  { label: "Completed", value: byLine(head.completedAt, head.completedByName) },
                  { label: "Discrepancy", value: head.discrepancyNote },
                ]} />
                <HistoryList title="Receipts and losses" empty="Nothing received yet."
                  entries={data.history.filter((entry) => ["partially_received", "completed", "transit_loss"].includes(entry.type)).map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor }))} />
              </div>
            </TabPanel>
          )}

          <TabPanel id="inventory">
            <Panel title="Stock movements" description="What this transfer posted to the stock ledger."
              actions={data.movements.length ? <>
                <Link className="text-sm text-brand hover:underline" href={`/inventory/transactions?tab=movements&mode=events&sourceId=${head.id}`}>Movement history</Link>
                <Link className="text-sm text-brand hover:underline" href={`/inventory/transactions?tab=ledger&sourceId=${head.id}`}>Stock ledger</Link>
              </> : undefined}>
              {data.movements.length === 0
                ? <p className="text-sm text-text-muted">{open ? "Nothing has moved yet: a confirmed transfer only reserves its source stock." : "No stock movements."}</p>
                : (
                  <LinesTable columns={["Movement", "Type", "Effective", "Item", "Warehouse", "Location", "Batch / Serial", { label: "Quantity", numeric: true }]}>
                    {data.movements.map((movement) => (
                      <tr key={movement.id}>
                        <Cell><Link className="text-brand hover:underline" href={`/inventory/stock-ledger/${movement.id}`}>{movement.number}</Link></Cell><Cell>{movement.typeLabel}</Cell>
                        <Cell>{formatDateTime(movement.effectiveAt)}</Cell><Cell>{movement.sku}</Cell><Cell>{movement.warehouse}</Cell><Cell>{movement.location}</Cell>
                        <Cell>{movement.serial ?? movement.batch}</Cell><Cell numeric>{quantity(movement.quantity, movement.baseUom)}</Cell>
                      </tr>
                    ))}
                  </LinesTable>
                )}
            </Panel>
          </TabPanel>

          <TabPanel id="history">
            <HistoryList entries={data.history.map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor }))} />
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "cancel" && <CancelDialog detail={data} onClose={() => setDialog(null)} onDone={refresh} />}
      {(dialog === "receive" || dialog === "write-off") && <ArrivalDialog kind={dialog} detail={data} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "reverse" && <ReverseDialog detail={data} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function CancelDialog({ detail, onClose, onDone }: { detail: TransferDetail; onClose: () => void; onDone: (data: TransferDetail) => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({ mutationFn: () => cancelTransfer(detail.transfer.id, reason), onSuccess: (data) => { onDone(data); onClose(); } });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Cancel ${detail.transfer.number}`}>
      <div className="flex flex-col gap-3">
        {detail.transfer.status === "confirmed" && <p className="text-sm text-text-muted">Its reservation is released; the stock becomes available again.</p>}
        <TextArea label="Reason" value={reason} onChange={setReason} />
        <ErrorBanner message={cancel.isError ? errorMessage(cancel.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Keep it</Button><Button variant="danger" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel transfer</Button></div>
      </div>
    </Dialog>
  );
}

// Receive what arrived (or write off what was confirmed lost): everything still in transit, or per line a quantity, the batches or the serial numbers.
function ArrivalDialog({ kind, detail, onClose, onDone }: { kind: "receive" | "write-off"; detail: TransferDetail; onClose: () => void; onDone: (data: TransferDetail) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "transfers", "options"), queryFn: getTransferOptions, staleTime: 60_000, enabled: kind === "receive" });
  const locations = options.data?.warehouses.find((entry) => entry.id === detail.transfer.destinationWarehouseId)?.locations ?? [];
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<Record<string, Record<string, string>>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [where, setWhere] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const open = detail.lines.filter((line) => line.inTransit > 0);
  const lineInput = (line: TransferLine): ReceiptLineInput | null => {
    const destinationLocationId = where[line.id] || undefined;
    if (line.trackingType === "serial") return serials[line.id]?.length ? { lineId: line.id, serialIds: serials[line.id], destinationLocationId } : null;
    if (line.trackingType === "batch") {
      const chosen = Object.entries(batches[line.id] ?? {}).filter(([, value]) => value).map(([batchId, value]) => ({ batchId, quantity: value }));
      return chosen.length ? { lineId: line.id, batches: chosen, destinationLocationId } : null;
    }
    return amounts[line.id] ? { lineId: line.id, quantity: amounts[line.id], destinationLocationId } : null;
  };
  const chosen = open.map(lineInput).filter((entry): entry is ReceiptLineInput => entry !== null);
  const everything = chosen.length === 0;
  const run = useMutation({
    mutationFn: () => {
      const lines = everything ? (Object.keys(where).length ? open.map((line) => ({ lineId: line.id, quantity: line.trackingType === "none" ? String(line.inTransit) : undefined,
        batches: line.trackingType === "batch" ? line.batches.filter((batch) => batch.quantity - batch.received - batch.lost > 0).map((batch) => ({ batchId: batch.batchId, quantity: String(batch.quantity - batch.received - batch.lost) })) : undefined,
        serialIds: line.trackingType === "serial" ? line.serials.filter((serial) => serial.status === "in_transit").map((serial) => serial.id) : undefined,
        destinationLocationId: where[line.id] || undefined })) : undefined) : chosen;
      return kind === "receive" ? receiveTransfer(detail.transfer.id, { lines, idempotencyKey: key }) : writeOffTransit(detail.transfer.id, { reason, lines, idempotencyKey: key });
    },
    onSuccess: (data) => { onDone(data); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(value) => !value && onClose()} title={kind === "receive" ? `Receive ${detail.transfer.number}` : `Write off transit loss on ${detail.transfer.number}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">{kind === "receive"
          ? "Enter what physically arrived. Leave everything empty to receive all that is still in transit. Anything not received stays in transit, never silently lost."
          : "Only for goods confirmed lost or destroyed on the way (carrier loss, theft, accident). It leaves the company's stock with this reason; leave the quantities empty to write off everything still in transit."}</p>
        {open.map((line) => (
          <div key={line.id} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border p-2">
            <p className="font-medium">Line {line.lineNumber} · {line.sku} · {quantity(line.inTransit, line.baseUom)} in transit</p>
            {line.trackingType === "serial" ? (
              <div className="flex flex-wrap gap-3">{line.serials.filter((serial) => serial.status === "in_transit").map((serial) => (
                <label key={serial.id} className="flex items-center gap-1"><input type="checkbox" checked={serials[line.id]?.includes(serial.id) ?? false}
                  onChange={(event) => setSerials((current) => ({ ...current, [line.id]: event.target.checked ? [...(current[line.id] ?? []), serial.id] : (current[line.id] ?? []).filter((id) => id !== serial.id) }))} />{serial.serialNumber}</label>))}</div>
            ) : line.trackingType === "batch" ? line.batches.filter((batch) => batch.quantity - batch.received - batch.lost > 0).map((batch) => (
              <TextField key={batch.batchId} label={`Batch ${batch.batch} (up to ${quantity(batch.quantity - batch.received - batch.lost)})`} inputMode="decimal" value={batches[line.id]?.[batch.batchId] ?? ""}
                onChange={(value) => setBatches((current) => ({ ...current, [line.id]: { ...(current[line.id] ?? {}), [batch.batchId]: value } }))} />
            )) : (
              <TextField label={`Quantity (up to ${quantity(line.inTransit)} ${line.baseUom ?? ""})`} inputMode="decimal" value={amounts[line.id] ?? ""}
                onChange={(value) => setAmounts((current) => ({ ...current, [line.id]: value }))} />
            )}
            {kind === "receive" && locations.length > 1 && <Select label="Put away at" selectedKey={where[line.id] || line.destinationLocationId || null}
              onSelectionChange={(value) => setWhere((current) => ({ ...current, [line.id]: String(value) }))} options={locations.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
              description="Another location of the same warehouse is recorded; it must hold the same kind of stock." />}
          </div>
        ))}
        {kind === "write-off" && <TextArea label="Reason" isRequired value={reason} onChange={setReason} placeholder="Carrier lost one carton; claim filed" />}
        <ErrorBanner message={run.isError ? errorMessage(run.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant={kind === "receive" ? "primary" : "danger"} isDisabled={kind === "write-off" && reason.trim().length < 3} isLoading={run.isPending} onPress={() => run.mutate()}>
            {kind === "receive" ? (everything ? "Receive everything in transit" : "Receive selected") : (everything ? "Write off everything in transit" : "Write off selected")}</Button></div>
      </div>
    </Dialog>
  );
}

function ReverseDialog({ detail, onClose, onDone }: { detail: TransferDetail; onClose: () => void; onDone: (data: TransferDetail) => void }) {
  const [reason, setReason] = useState("");
  const reverse = useMutation({ mutationFn: () => reverseTransfer(detail.transfer.id, reason), onSuccess: (data) => { onDone(data); onClose(); } });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Reverse ${detail.transfer.number}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Only when the transfer was posted in error and the goods are still at the destination. Every posting is reversed; the same batches and serial numbers go
          back to where they came from, and the original stays in the Stock Ledger. To send goods back on purpose, create a new transfer instead.</p>
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <ErrorBanner message={reverse.isError ? errorMessage(reverse.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="danger" isDisabled={reason.trim().length < 3} isLoading={reverse.isPending} onPress={() => reverse.mutate()}>Reverse transfer</Button></div>
      </div>
    </Dialog>
  );
}
