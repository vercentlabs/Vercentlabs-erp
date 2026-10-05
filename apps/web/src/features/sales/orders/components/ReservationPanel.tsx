"use client";

// Stock reserved for a sales order, line by line: ordered, delivered,
// reserved and still unreserved in the warehouse each line ships from, with
// Reserve Remaining, a chosen quantity, and Release with a reason. Below,
// each reservation (RES-…) with what it still holds, what deliveries consumed
// and what was released, and for how long it has been held. Reservation is
// shown beside the order's status, never as its status.
import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button, Dialog, NumberField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { dateTime } from "@/features/sales/shared/format";
import { SalesAlert, SalesPanel } from "@/features/sales/shared/SalesUi";

import {
  RELEASE_REASONS, listSalesOrderReservations, releaseSalesOrderReservation, reserveSalesOrderLine, type SalesOrderDetail, type SalesOrderLine,
} from "../api/orders-api";
import { failureText } from "./OrderDialogs";

const amount = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const withUnit = (value: number | string | null | undefined, unit: string | null) => `${amount(value)}${unit ? ` ${unit}` : ""}`;
const unreservedOf = (line: SalesOrderLine) => Math.max(0, Number(line.remaining_to_deliver) - Number(line.reserved_quantity));
const RESERVATION_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = { fully_reserved: "success", partially_reserved: "warning", not_reserved: "danger", not_required: "neutral" };
const RECORD_TONE: Record<string, "success" | "info" | "neutral"> = { active: "info", consumed: "success", released: "neutral", cancelled: "neutral" };
const HISTORY = new Set(["sales_order.stock_reserved", "sales_order.stock_released", "sales_order.reservation_consumed", "sales_order.warehouse_changed"]);

type Dialogs = { kind: "reserve" | "release"; line: SalesOrderLine | null } | null;

export function ReservationPanel({ orderId, detail, reserving, onReserveRemaining, onDeliver, onChanged }: {
  orderId: string; detail: SalesOrderDetail; reserving: boolean; onReserveRemaining: () => void; onDeliver: () => void; onChanged: (message?: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const order = detail.order;
  const actions = detail.actions;
  const goods = detail.lines.filter((line) => !line.is_service);
  const confirmed = order.status === "confirmed";
  const canReserve = confirmed && Boolean(detail.capabilities.reserve);
  const canRelease = Boolean(detail.capabilities.releaseReservation);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [open, setOpen] = useState<string | null>(null);
  const records = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "reservations"),
    queryFn: () => listSalesOrderReservations(orderId).then((r) => r.reservations),
    enabled: Boolean(detail.capabilities.viewReservations) && goods.some((line) => line.is_stock_tracked),
  });
  const history = detail.events.filter((event) => HISTORY.has(event.event_type));
  return (
    <>
      <SalesPanel title="Reservation"
        description={order.status === "draft" ? "Stock is reserved once the order is confirmed; a draft never holds stock."
          : "Reserved stock is set aside in the line's warehouse: it is no longer available to other orders but stays on hand until it is delivered."}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={RESERVATION_TONE[order.reservation] ?? "neutral"}>{order.reservationLabel}</StatusBadge>
            {actions.reserve && <Button variant="secondary" size="compact" isLoading={reserving} onPress={onReserveRemaining}>Reserve Remaining</Button>}
            {actions.release && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "release", line: null })}>Release All</Button>}
            {actions.deliver && <Button variant="primary" size="compact" onPress={onDeliver}>Create Delivery</Button>}
          </div>
        )}>
        {!goods.length ? <p className="text-sm text-text-muted">This order has only services: there is nothing to reserve or deliver.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 font-medium">Warehouse</th>
                  <th className="py-2 pr-3 text-right font-medium">Ordered</th><th className="py-2 pr-3 text-right font-medium">Delivered</th>
                  <th className="py-2 pr-3 text-right font-medium">Cancelled</th><th className="py-2 pr-3 text-right font-medium">Reserved</th>
                  <th className="py-2 pr-3 text-right font-medium">Unreserved</th><th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {goods.map((line) => {
                  const unreserved = unreservedOf(line);
                  return (
                    <tr key={line.id} className="border-b border-border align-top">
                      <td className="py-2 pr-3 font-medium">{line.item_name_snapshot}</td>
                      <td className="py-2 pr-3">{line.is_stock_tracked ? line.warehouse_name ?? "Warehouse required" : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{withUnit(line.ordered_quantity, line.uom_snapshot)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{amount(line.delivered_quantity)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{line.cancelled_quantity ? amount(line.cancelled_quantity) : ""}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{line.is_stock_tracked ? amount(line.reserved_quantity) : "—"}</td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">{line.is_stock_tracked ? amount(unreserved) : "Not required"}</td>
                      <td className="py-2">
                        <span className="flex justify-end gap-1">
                          {line.is_stock_tracked && canReserve && unreserved > 0 && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "reserve", line })}>Reserve</Button>}
                          {line.is_stock_tracked && canRelease && Number(line.reserved_quantity) > 0 && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "release", line })}>Release</Button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SalesPanel>

      {detail.capabilities.viewReservations && (records.data?.length ?? 0) > 0 && (
        <SalesPanel title="Reservations" description="Each reservation keeps what it reserved; deliveries consume it and releases give it back, never by rewriting it.">
          {records.isError && <SalesAlert>{failureText(records.error, "The reservations could not be loaded.")}</SalesAlert>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Reservation</th><th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 font-medium">Warehouse</th>
                  <th className="py-2 pr-3 text-right font-medium">Reserved</th><th className="py-2 pr-3 text-right font-medium">Still held</th>
                  <th className="py-2 pr-3 text-right font-medium">Consumed</th><th className="py-2 pr-3 text-right font-medium">Released</th><th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.data?.map((record) => {
                  const expanded = open === record.id;
                  return (
                    <Fragment key={record.id}>
                      <tr className="border-b border-border">
                        <td className="py-2 pr-3">
                          <button type="button" className="inline-flex items-center gap-1 font-medium tabular-nums text-brand hover:underline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : record.id)}>
                            {expanded ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}{record.reservationNumber ?? "Earlier reservation"}
                          </button>
                        </td>
                        <td className="py-2 pr-3">{record.itemName}</td>
                        <td className="py-2 pr-3">{[record.warehouseName, record.location, record.batch].filter(Boolean).join(" · ")}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{withUnit(record.reserved, record.unit)}</td>
                        <td className="py-2 pr-3 text-right font-medium tabular-nums">{amount(record.active)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{record.consumed ? amount(record.consumed) : ""}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{record.released ? amount(record.released) : ""}</td>
                        <td className="py-2">
                          <span className="flex flex-wrap items-center gap-1">
                            <StatusBadge tone={RECORD_TONE[record.status] ?? "neutral"}>{record.statusLabel}</StatusBadge>
                            {record.daysHeld != null && <span className={`text-xs ${record.stale ? "text-warning" : "text-text-muted"}`}>{record.stale ? "Held " : "For "}{record.daysHeld} day{record.daysHeld === 1 ? "" : "s"}</span>}
                          </span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-border bg-surface-muted">
                          <td colSpan={8} className="px-3 py-2 text-sm">
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                              <div><dt className="inline text-text-muted">Reserved: </dt><dd className="inline">{dateTime(record.reservedAt)}{record.reservedByName ? ` by ${record.reservedByName}` : ""}</dd></div>
                              <div><dt className="inline text-text-muted">Order: </dt><dd className="inline">{order.sales_order_number}</dd></div>
                              {record.consumptions.map((consumption, index) => (
                                <div key={index}><dt className="inline text-text-muted">Consumed: </dt><dd className="inline">{withUnit(consumption.quantity, record.unit)} by {consumption.deliveryNumber ?? "a delivery"} on {dateTime(consumption.consumedAt)}</dd></div>
                              ))}
                              {record.releasedAt && record.released > 0 && (
                                <div><dt className="inline text-text-muted">Released: </dt><dd className="inline">{withUnit(record.released, record.unit)}{record.releasedByName ? ` by ${record.releasedByName}` : ""}{record.releaseReason ? ` · ${record.releaseReason}` : ""}</dd></div>
                              )}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SalesPanel>
      )}

      {history.length > 0 && (
        <SalesPanel title="Reservation history">
          <ol className="flex flex-col divide-y divide-border text-sm">
            {history.map((event, index) => {
              const m = (event.metadata ?? {}) as Record<string, unknown>;
              const lines = Array.isArray(m.lines) ? (m.lines as Array<Record<string, unknown>>) : [];
              const what = { "sales_order.stock_reserved": "Reserved", "sales_order.stock_released": "Released", "sales_order.reservation_consumed": `Consumed by ${String(m.deliveryNumber ?? "a delivery")}`, "sales_order.warehouse_changed": "Warehouse changed" }[event.event_type];
              return (
                <li key={event.id ?? index} className="flex flex-col gap-0.5 py-2">
                  <span className="font-medium">{what}</span>
                  <span className="text-text-secondary">
                    {event.event_type === "sales_order.warehouse_changed"
                      ? `${String(m.item ?? "")}: ${String(m.from ?? "—")} → ${String(m.to ?? "")}`
                      : lines.map((line) => `${String(line.item ?? "")} ${amount(line.quantity as number)}${line.unit ? ` ${line.unit}` : ""}${line.warehouse ? ` in ${line.warehouse}` : ""}`).join(", ")}
                    {m.reason ? ` · ${String(m.reason)}` : ""}
                  </span>
                  <span className="text-xs text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
                </li>
              );
            })}
          </ol>
        </SalesPanel>
      )}

      {dialog?.kind === "reserve" && dialog.line && <ReserveLineDialog orderId={orderId} line={dialog.line} onClose={() => setDialog(null)} onDone={(message) => { setDialog(null); onChanged(message); }} />}
      {dialog?.kind === "release" && <ReleaseDialog orderId={orderId} line={dialog.line} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged("The reservation was released."); }} />}
    </>
  );
}

function ReserveLineDialog({ orderId, line, onClose, onDone }: { orderId: string; line: SalesOrderLine; onClose: () => void; onDone: (message: string) => void }) {
  const unreserved = unreservedOf(line);
  const [quantity, setQuantity] = useState(unreserved);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => reserveSalesOrderLine(orderId, line.id, { quantity, idempotencyKey }),
    onSuccess: ({ result }) => {
      const outcome = result.lines[0];
      onDone(outcome && outcome.reserved + 1e-9 < outcome.wanted
        ? `Reserved ${amount(outcome.reserved)} of ${amount(outcome.wanted)}: ${outcome.problem ?? "stock is short"}. ${amount(outcome.shortage)} stays unreserved.`
        : `${amount(outcome?.reserved)} ${line.uom_snapshot ?? ""} reserved${outcome?.reservations?.length ? ` (${outcome.reservations.join(", ")})` : ""}.`);
    },
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Reserve ${line.item_name_snapshot}`}
      description={`Up to ${withUnit(unreserved, line.uom_snapshot)} is still unreserved in ${line.warehouse_name ?? "the line's warehouse"}. Stock is checked again now; if less is available, what is available is reserved.`}>
      <div className="flex flex-col gap-3">
        {save.isError && <SalesAlert>{failureText(save.error, "The stock could not be reserved.")}</SalesAlert>}
        <NumberField label={`Quantity (${line.uom_snapshot ?? "units"})`} value={quantity} minValue={0} maxValue={unreserved} step={1} onChange={(value) => setQuantity(Number.isFinite(value) ? value : 0)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!(quantity > 0)} onPress={() => save.mutate()}>Reserve</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReleaseDialog({ orderId, line, onClose, onDone }: { orderId: string; line: SalesOrderLine | null; onClose: () => void; onDone: () => void }) {
  const held = Number(line?.reserved_quantity ?? 0);
  const [quantity, setQuantity] = useState(held);
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => releaseSalesOrderReservation(orderId, { lineId: line?.id, quantity: line && quantity < held ? quantity : undefined, reasonCode, reason: reason.trim() || undefined }),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={line ? `Release ${line.item_name_snapshot}` : "Release all reserved stock"}
      description="The stock becomes available to other orders. The order stays confirmed and can be reserved again.">
      <div className="flex flex-col gap-3">
        {save.isError && <SalesAlert>{failureText(save.error, "The reservation could not be released.")}</SalesAlert>}
        {line && <NumberField label={`Quantity (${line.uom_snapshot ?? "units"})`} value={quantity} minValue={0} maxValue={held} step={1} onChange={(value) => setQuantity(Number.isFinite(value) ? value : 0)} />}
        <Select label="Reason" isRequired placeholder="Choose a reason" options={RELEASE_REASONS.map((entry) => ({ value: entry.code, label: entry.label }))}
          selectedKey={reasonCode || null} onSelectionChange={(key) => setReasonCode(String(key ?? ""))} />
        <TextField label="Details" isRequired={reasonCode === "other"} value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!reasonCode || (reasonCode === "other" && !reason.trim()) || (Boolean(line) && !(quantity > 0))} onPress={() => save.mutate()}>Release</Button>
        </div>
      </div>
    </Dialog>
  );
}
