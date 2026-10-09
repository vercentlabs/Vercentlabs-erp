"use client";

// One reservation: the source document line's demand for an item — requested, reserved, consumed, released and still held — and its allocations,
// the exact stock held (warehouse, location, batch, serial), each with what consumed it and its history. Release (with a reason) returns stock to
// Available, the source keeps its demand; Reallocate moves an allocation to other stock — the new one is reserved first, so the guarantee is never
// lost in between. Exceptions say what needs attention. There is no "edit reserved quantity".
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge, Button, Dialog, EmptyState, ErrorState, LinkButton, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { ErrorBanner, quantity } from "@/features/items/item-format";
import { getItemStock } from "@/features/stock-balance/api/stock-balance-api";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  EXCEPTION_LABEL, STATUS_TONE, errorCode, errorMessage, getReservation, reallocateAllocation, releaseAllocation, releaseReservation, type Allocation, type ReservationDetail,
} from "../api/reservations-api";
import { RESERVATIONS_BASE } from "./ReservationsScreen";

const SAME = "same";


type DialogState = { kind: "release-all" } | { kind: "release"; allocation: Allocation } | { kind: "reallocate"; allocation: Allocation } | null;

export function ReservationDetailScreen({ reservationId }: { reservationId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "reservations", "one", reservationId), queryFn: () => getReservation(reservationId) });
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "reservations") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "stock-balance") });
  };
  if (query.isLoading) return <LoadingState label="Loading reservation" rows={5} />;
  if (query.isError) return errorCode(query.error) === "STOCK_RESERVATION_NOT_FOUND"
    ? <EmptyState title="Reservation not found" description="It may be in a warehouse you cannot see." action={{ label: "Stock reservations", onPress: () => router.push(RESERVATIONS_BASE) }} />
    : <ErrorState title="Could not load the reservation" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const detail: ReservationDetail = query.data!;
  const reservation = detail.reservation;
  const unit = reservation.baseUom ?? "";
  const can = detail.capabilities;
  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{reservation.sku} <span className="text-base font-normal text-text-muted">{reservation.itemName}</span></>,
        status: <StatusBadge tone={STATUS_TONE[reservation.status]}>{reservation.statusLabel}</StatusBadge>,
        fields: [
          { label: "Source", value: <>{reservation.sourceLabel} {reservation.sourceHref ? <Link className="hover:underline" href={reservation.sourceHref}>{reservation.document ?? "Open"}</Link> : reservation.document}
            {reservation.sourceLineNumber ? ` · line ${reservation.sourceLineNumber}` : ""}</> },
          { label: "Warehouse", value: reservation.warehouses.join(", ") },
          { label: "Holding", value: quantity(reservation.active, unit) },
          { label: "Expires", value: reservation.expiresAt ? formatDateTime(reservation.expiresAt) : "Never" },
        ],
        primaryAction: can.release && reservation.status === "active" ? <Button variant="secondary" onPress={() => setDialog({ kind: "release-all" })}>Release</Button> : undefined,
        secondaryActions: (
          <>
            <LinkButton variant="outline" href={`/inventory/stock/items/${reservation.itemId}`}>View stock</LinkButton>
            {reservation.sourceHref && <LinkButton variant="outline" href={reservation.sourceHref}>View source</LinkButton>}
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          {notice && <Notice tone="success">{notice}</Notice>}
          {detail.exceptions.length > 0 && (
            <Notice><p className="font-medium">Needs attention</p>
              <ul className="list-disc pl-5">{detail.exceptions.map((entry, index) => <li key={index}>{entry.allocation}: {EXCEPTION_LABEL[entry.kind] ?? entry.kind} — {entry.message}</li>)}</ul></Notice>
          )}
        </div>
      }
    >
      <Tabs defaultSelectedKey="overview">
        <TabList aria-label="Reservation sections">
          <Tab id="overview">Overview</Tab>
          <Tab id="allocations">Allocations</Tab>
          <Tab id="history">History</Tab>
        </TabList>
        <TabPanel id="overview">
          <FactList title="Quantities" items={[
            ["Requested", quantity(reservation.requested, unit)], ["Reserved", quantity(reservation.reserved, unit)], ["Consumed", quantity(reservation.consumed, unit)],
            ["Released", quantity(reservation.released, unit)], ["Holding now", quantity(reservation.active, unit)],
            ["Unreserved", reservation.status === "active" && reservation.unreserved > 0 ? quantity(reservation.unreserved, unit) : null],
            ["Created", `${formatDateTime(reservation.createdAt)}${reservation.createdByName ? ` by ${reservation.createdByName}` : ""}`],
            ["Expires", reservation.expiresAt ? formatDateTime(reservation.expiresAt) : "Never"],
          ]} />
        </TabPanel>
        <TabPanel id="allocations">
          <Panel title="Allocations" description="Where the reserved stock is held, and what has consumed it.">
            <LinesTable columns={["Allocation", "Warehouse", "Held at", { label: "Reserved", numeric: true }, { label: "Consumed", numeric: true }, { label: "Released", numeric: true },
              { label: "Holding", numeric: true }, "Status", "Consumed by", ""]}>
              {detail.allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <Cell className="font-medium">{allocation.number}</Cell>
                  <Cell>{allocation.warehouse}</Cell>
                  <Cell><span className="flex flex-wrap items-center gap-1.5">{can.viewAllocations ? allocation.allocation : "Warehouse"}{!allocation.eligible && <Badge tone="danger">Not eligible</Badge>}</span></Cell>
                  <Cell numeric>{quantity(allocation.quantity)}</Cell>
                  <Cell numeric>{quantity(allocation.consumed)}</Cell>
                  <Cell numeric>{quantity(allocation.released)}</Cell>
                  <Cell numeric className="font-medium">{quantity(allocation.active)}</Cell>
                  <Cell><StatusBadge tone={allocation.status === "active" ? "success" : "neutral"}>{allocation.status === "active" ? "Active" : allocation.status.charAt(0).toUpperCase() + allocation.status.slice(1)}</StatusBadge></Cell>
                  <Cell>{allocation.consumptions.map((entry) => `${entry.delivery ?? entry.movement ?? "issue"} (${quantity(entry.quantity)})`).join(", ")}</Cell>
                  <Cell>{allocation.status === "active" ? <span className="flex gap-1">
                    {(can.reallocate || can.reallocateWarehouse) && <Button size="compact" variant="ghost" onPress={() => setDialog({ kind: "reallocate", allocation })}>Reallocate</Button>}
                    {can.release && <Button size="compact" variant="ghost" onPress={() => setDialog({ kind: "release", allocation })}>Release</Button>}</span> : null}</Cell>
                </tr>
              ))}
            </LinesTable>
          </Panel>
        </TabPanel>
        <TabPanel id="history">
          <HistoryList entries={detail.history.map((entry) => ({
            label: entry.type.charAt(0).toUpperCase() + entry.type.slice(1),
            summary: `${quantity(entry.quantity, unit)} · ${entry.allocation} · ${quantity(entry.activeAfter, unit)} still held after${entry.reason ? ` · ${entry.reason}` : ""}`,
            at: entry.at, actor: entry.actor,
          }))} />
        </TabPanel>
      </Tabs>
    </RecordDetailsPage>
      {dialog?.kind === "release-all" && <ReleaseDialog title={`Release ${reservation.sku} for ${reservation.document ?? reservation.sourceLabel}?`} active={reservation.active} unit={unit}
        run={(input) => releaseReservation(reservation.id, input)} onClose={() => setDialog(null)} onDone={() => done("Released: the stock is available again; the source keeps its demand.")} />}
      {dialog?.kind === "release" && <ReleaseDialog title={`Release ${dialog.allocation.number}?`} active={dialog.allocation.active} unit={unit}
        run={(input) => releaseAllocation(dialog.allocation.id, input)} onClose={() => setDialog(null)} onDone={() => done("Released: the stock is available again; the source keeps its demand.")} />}
      {dialog?.kind === "reallocate" && <ReallocateDialog allocation={dialog.allocation} canWarehouse={can.reallocateWarehouse} canTracking={can.reallocate} onClose={() => setDialog(null)}
        onDone={(number) => done(`Reallocated to ${number}.`)} />}
    </>
  );
}

function ReleaseDialog({ title, active, unit, run, onClose, onDone }: {
  title: string; active: number; unit: string; run: (input: { quantity?: string | null; reason: string }) => Promise<unknown>; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const release = useMutation({ mutationFn: () => run({ quantity: amount.trim() || null, reason: reason.trim() }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description="The source document keeps its demand, now unreserved.">
      <div className="flex flex-col gap-3">
        <ErrorBanner message={release.isError ? errorMessage(release.error) : null} />
        <TextField label={`Quantity (${unit || "base units"})`} inputMode="decimal" value={amount} onChange={setAmount} description={`Empty: all ${active}.`} />
        <TextArea label="Reason" isRequired rows={2} value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isDisabled={!reason.trim()} isLoading={release.isPending} onPress={() => release.mutate()}>Release</Button></div>
      </div>
    </Dialog>
  );
}

function ReallocateDialog({ allocation, canWarehouse, canTracking, onClose, onDone }: {
  allocation: Allocation; canWarehouse: boolean; canTracking: boolean; onClose: () => void; onDone: (number: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const options = useInvOptions();
  const stock = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "item", allocation.itemId), queryFn: () => getItemStock(allocation.itemId) });
  const [warehouseId, setWarehouseId] = useState(allocation.warehouseId);
  const [locationId, setLocationId] = useState(SAME);
  const [batchId, setBatchId] = useState(SAME);
  const [serialId, setSerialId] = useState(SAME);
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => reallocateAllocation(allocation.id, { warehouseId, locationId: locationId === SAME ? null : locationId, batchId: batchId === SAME ? null : batchId,
      serialId: serialId === SAME ? null : serialId, reason: reason.trim() }),
    onSuccess: (result) => onDone(result.to.reservation_number),
  });
  const warehouses = (options.data?.warehouses ?? []).filter((entry) => canWarehouse || entry.id === allocation.warehouseId);
  const locations = (options.data?.locations ?? []).filter((entry) => entry.warehouse_id === warehouseId);
  const batches = (options.data?.batches ?? []).filter((entry) => entry.item_id === allocation.itemId);
  const serials = (stock.data?.serials ?? []).filter((entry) => warehouses.find((warehouse) => warehouse.id === warehouseId)?.code === entry.warehouse);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Reallocate ${allocation.number}`}
      description={`${allocation.active} ${allocation.baseUom ?? ""} move to the stock chosen here. The new allocation is reserved first; if it cannot be, nothing changes.`}>
      <div className="flex flex-col gap-3">
        <ErrorBanner message={run.isError ? errorMessage(run.error) : null} />
        <Select label="Warehouse" isDisabled={!canWarehouse} selectedKey={warehouseId} onSelectionChange={(key) => { setWarehouseId(String(key)); setLocationId(SAME); setSerialId(SAME); }}
          options={warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
          description={canWarehouse ? undefined : "Moving to another warehouse needs its own permission."} />
        {canTracking && <>
          <Select label="Location" selectedKey={locationId} onSelectionChange={(key) => setLocationId(String(key))}
            options={[{ value: SAME, label: "Any eligible location" }, ...locations.map((entry) => ({ value: entry.id, label: entry.code }))]} />
          {batches.length > 0 && <Select label="Batch" selectedKey={batchId} onSelectionChange={(key) => setBatchId(String(key))}
            options={[{ value: SAME, label: "Any eligible batch" }, ...batches.map((entry) => ({ value: entry.id, label: entry.code }))]} />}
          {allocation.serial !== null || serials.length > 0 ? <Select label="Serial" selectedKey={serialId} onSelectionChange={(key) => setSerialId(String(key))}
            options={[{ value: SAME, label: "No specific serial" }, ...serials.map((entry) => ({ value: entry.id, label: entry.serial }))]} /> : null}
        </>}
        <TextArea label="Reason" isRequired rows={2} value={reason} onChange={setReason} description="Such as: batch quarantined, shipping from Mumbai instead." />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!reason.trim()} isLoading={run.isPending} onPress={() => run.mutate()}>Reallocate</Button></div>
      </div>
    </Dialog>
  );
}
