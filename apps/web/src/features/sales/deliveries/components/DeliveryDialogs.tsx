"use client";

// The steps of a delivery that need something from the user first. Each sends
// only what was entered; the server checks quantities against what is really
// left on the order (counting other deliveries not yet dispatched), checks
// the stock again at dispatch, and refuses what the delivery's state does
// not allow.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { SalesAlert } from "@/features/sales/shared/SalesUi";
import { listCustomerAddresses, listCustomerContacts } from "@/features/sales/customers/api/customers-api";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import {
  cancelDelivery, changeDeliveryWarehouse, createDelivery, dispatchDelivery, getDeliveryProposal, markDeliveryDelivered, updateDraftDelivery,
  updateShipmentDetails, type DeliveryDetail,
} from "../api/deliveries-api";

export function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
export const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const optional = (value: string) => value.trim() || undefined;
const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : "");

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode;
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <SalesAlert>{failureText(error, fallback)}</SalesAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// One row per line: what can go now, and the quantity on this delivery.
type QuantityRow = { id: string; name: string; unit: string | null; max: number; initial: number; hint: string };
function QuantityRows({ rows, values, onChange }: { rows: QuantityRow[]; values: Record<string, number>; onChange: (next: Record<string, number>) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <span className="flex flex-col text-sm">
            <span className="font-medium">{row.name}</span>
            <span className="text-xs text-text-muted">{row.hint}</span>
          </span>
          <NumberField aria-label={`Quantity of ${row.name}`} value={values[row.id] ?? row.initial} minValue={0} maxValue={row.max} step={1}
            onChange={(value) => onChange({ ...values, [row.id]: Number.isFinite(value) ? value : 0 })} />
        </div>
      ))}
    </div>
  );
}
const chosenLines = (rows: QuantityRow[], values: Record<string, number>) =>
  rows.map((row) => ({ salesOrderLineId: row.id, quantity: values[row.id] ?? row.initial })).filter((line) => line.quantity > 0);

// From a confirmed order: a Draft delivery from one warehouse. Reserved stock is proposed first.
export function CreateDeliveryDialog({ orderId, number, onClose, onDone }: {
  orderId: string; number: string; onClose: () => void; onDone: (deliveryId: string, deliveryNumber: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "delivery-proposal"),
    queryFn: () => getDeliveryProposal(orderId).then((r) => r.proposal),
    staleTime: 0, gcTime: 0,
  });
  const open = (proposal.data?.lines ?? []).filter((line) => line.assignable > 0);
  // One delivery ships from one warehouse.
  const warehouses = [...new Map(open.filter((line) => line.stockTracked && line.warehouseId).map((line) => [line.warehouseId as string, line.warehouseName ?? "Warehouse"])).entries()];
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const from = warehouseId ?? warehouses[0]?.[0] ?? null;
  const [values, setValues] = useState<Record<string, number>>({});
  const [instructions, setInstructions] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  // One key per opened dialog: a double click or a retry creates one delivery.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const rows: QuantityRow[] = open.filter((line) => !line.stockTracked || line.warehouseId === from).map((line) => ({
    id: line.salesOrderLineId, name: line.itemName, unit: line.unit, max: line.assignable, initial: line.suggested,
    hint: [
      `Ordered ${amount(line.ordered)}`, `delivered ${amount(line.delivered)}`, line.cancelled ? `cancelled ${amount(line.cancelled)}` : null,
      `remaining ${amount(line.remaining)}${line.unit ? ` ${line.unit}` : ""}`, line.stockTracked ? `reserved ${amount(line.reserved)}` : "not stock tracked",
      line.openElsewhere ? `${amount(line.openElsewhere)} on another delivery not yet dispatched` : null,
    ].filter(Boolean).join(" · "),
  }));
  const blocked = (proposal.data?.lines ?? []).filter((line) => line.remaining > 0 && line.assignable <= 0);
  const lines = chosenLines(rows, values);
  const save = useMutation({
    mutationFn: () => createDelivery(orderId, {
      idempotencyKey, lines, warehouseId: from ?? undefined, deliveryInstructions: optional(instructions), internalNotes: optional(internalNotes),
    }),
    onSuccess: ({ result }) => onDone(result.deliveryId, result.deliveryNumber),
  });
  return (
    <Shell title={`Create a delivery for ${number}`}
      description="The delivery is created as a draft: no stock moves until it is dispatched. Enter what goes on this delivery; what is left stays open for the next one."
      size="lg" error={save.error ?? proposal.error} fallback="The delivery could not be created." onClose={onClose} label="Create Delivery" isLoading={save.isPending}
      isDisabled={!lines.length} onPress={() => save.mutate()}>
      {warehouses.length > 1 && (
        <Select label="Ship from" description="One delivery ships from one warehouse. Create another delivery for the other warehouse." selectedKey={from}
          options={warehouses.map(([id, name]) => ({ value: id, label: name }))} onSelectionChange={(selected) => { setWarehouseId(String(selected)); setValues({}); }} />
      )}
      {warehouses.length === 1 && <p className="text-sm text-text-secondary">Ships from <span className="font-medium text-text">{warehouses[0][1]}</span>.</p>}
      {proposal.isLoading ? <p className="text-sm text-text-muted">Loading what is left to deliver…</p>
        : !rows.length ? <p className="text-sm text-text-muted">Nothing can be put on a new delivery now.</p>
          : <QuantityRows rows={rows} values={values} onChange={setValues} />}
      {blocked.length > 0 && (
        <p className="text-xs text-text-muted">{blocked.map((line) => line.itemName).join(", ")}: already on deliveries not yet dispatched.</p>
      )}
      {(proposal.data?.services ?? []).length > 0 && (
        <p className="text-xs text-text-muted">{proposal.data?.services.map((line) => line.itemName).join(", ")}: no physical delivery required.</p>
      )}
      <TextArea label="Delivery instructions" description="Printed on the delivery note. Left empty, the order's delivery terms or customer notes are used." value={instructions} onChange={setInstructions} />
      <TextArea label="Internal notes" description="Never printed or shown to the customer." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

// A draft's lines and details. Lines are the full set: a quantity of 0 takes the line off.
export function EditDeliveryDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const delivery = detail.delivery;
  const draft = delivery.status === "draft";
  const rows: QuantityRow[] = detail.lines.map((line) => {
    // What this delivery can carry: what is left on the order line, less what other open deliveries carry.
    const max = Math.max(0, line.remaining_now - line.open_elsewhere);
    return {
      id: line.sales_order_line_id, name: line.item_name_snapshot, unit: line.uom_snapshot, max, initial: line.quantity,
      hint: `Ordered ${amount(line.ordered_now)} · delivered ${amount(line.delivered_now)} · reserved ${amount(line.reserved_now)} · up to ${amount(max)}${line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}`,
    };
  });
  const [values, setValues] = useState<Record<string, number>>({});
  const [expected, setExpected] = useState(day(delivery.expected_delivery_date));
  const [instructions, setInstructions] = useState(delivery.delivery_instructions ?? "");
  const [internalNotes, setInternalNotes] = useState(delivery.internal_notes ?? "");
  const [packageCount, setPackageCount] = useState<number | null>(delivery.package_count);
  const [packageNotes, setPackageNotes] = useState(delivery.package_notes ?? "");
  const lines = rows.map((row) => ({ salesOrderLineId: row.id, quantity: values[row.id] ?? row.initial }));
  const save = useMutation({
    mutationFn: () => updateDraftDelivery(delivery.id, {
      expectedVersion: delivery.version, ...(draft ? { lines } : {}), expectedDeliveryDate: expected || null, deliveryInstructions: instructions.trim() || null,
      internalNotes: internalNotes.trim() || null, packageCount, packageNotes: packageNotes.trim() || null,
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title={`Edit ${delivery.request_number}`} description={draft ? "Change the quantities while the delivery is a draft." : "Return the delivery to draft to change its quantities."}
      size="lg" error={save.error} fallback="The delivery could not be saved." onClose={onClose} label="Save" isLoading={save.isPending}
      isDisabled={draft && !lines.some((line) => line.quantity > 0)} onPress={() => save.mutate()}>
      {draft && <QuantityRows rows={rows} values={values} onChange={setValues} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Expected delivery date" type="date" value={expected} onChange={setExpected} />
        <NumberField label="Packages" value={packageCount ?? Number.NaN} minValue={0} step={1} onChange={(value) => setPackageCount(Number.isFinite(value) ? value : null)} />
      </div>
      <TextField label="Package details" value={packageNotes} onChange={setPackageNotes} />
      <TextArea label="Delivery instructions" description="Printed on the delivery note." value={instructions} onChange={setInstructions} />
      <TextArea label="Internal notes" description="Never printed or shown to the customer." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

// The ship-to address and contact, from the customer's own, before dispatch. The change is recorded with its reason.
export function ChangeAddressDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const delivery = detail.delivery;
  const partyId = delivery.party_id ?? "";
  const addresses = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", partyId, "addresses"), queryFn: () => listCustomerAddresses(partyId), enabled: Boolean(partyId) });
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", partyId, "contacts"), queryFn: () => listCustomerContacts(partyId), enabled: Boolean(partyId) });
  const [addressId, setAddressId] = useState(delivery.shipping_address_id ?? "");
  const [contactId, setContactId] = useState(delivery.contact_id ?? "");
  const [reason, setReason] = useState("");
  const shipping = (addresses.data ?? []).filter((address) => address.isActive && (address.isDefaultShipping || ["shipping", "plant", "office", "registered"].includes(address.addressType)));
  const addressChanged = addressId && addressId !== delivery.shipping_address_id;
  const save = useMutation({
    mutationFn: () => updateDraftDelivery(delivery.id, {
      expectedVersion: delivery.version, ...(addressChanged ? { shippingAddressId: addressId, addressChangeReason: optional(reason) } : {}),
      ...(contactId !== (delivery.contact_id ?? "") ? { contactId: contactId || null } : {}),
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title="Ship-to address and contact" description="Only the customer's own addresses and contacts can be used. The change is kept in the delivery's history."
      error={save.error ?? addresses.error} fallback="The address could not be changed." onClose={onClose} label="Save" isLoading={save.isPending}
      isDisabled={Boolean(addressChanged && !reason.trim())} onPress={() => save.mutate()}>
      <Select label="Ship-to address" selectedKey={addressId || null} placeholder="Choose an address"
        options={shipping.map((address) => ({ value: address.id, label: [address.label, address.line1, address.city].filter(Boolean).join(", ") }))}
        onSelectionChange={(selected) => setAddressId(String(selected ?? ""))} />
      {addressChanged && <TextField label="Reason for the change" isRequired value={reason} onChange={setReason} />}
      <Select label="Contact" selectedKey={contactId || "none"}
        options={[{ value: "none", label: "No contact" }, ...(contacts.data ?? []).map((contact) => ({ value: contact.id, label: [contact.name, contact.phone ?? contact.email].filter(Boolean).join(" · ") }))]}
        onSelectionChange={(selected) => setContactId(selected === "none" ? "" : String(selected ?? ""))} />
    </Shell>
  );
}

// The goods leave: stock is issued now. Carrier and tracking can be given here or later.
export function DispatchDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const delivery = detail.delivery;
  const [dispatchDate, setDispatchDate] = useState(today);
  const [carrier, setCarrier] = useState(delivery.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(delivery.tracking_number ?? "");
  const [trackingUrl, setTrackingUrl] = useState(delivery.tracking_url ?? "");
  const [vehicle, setVehicle] = useState(delivery.vehicle_reference ?? "");
  const [packages, setPackages] = useState<number | null>(delivery.package_count);
  const save = useMutation({
    mutationFn: () => dispatchDelivery(delivery.id, {
      expectedVersion: delivery.version, dispatchDate: dispatchDate || undefined, carrier: optional(carrier), trackingNumber: optional(trackingNumber), trackingUrl: optional(trackingUrl),
      vehicleReference: optional(vehicle), packageCount: packages,
    }),
    onSuccess: onDone,
  });
  const stockLines = detail.lines.filter((line) => line.warehouse_id);
  return (
    <Shell title={`Dispatch ${delivery.request_number}?`}
      description={`The goods leave ${delivery.warehouse_name ?? "the warehouse"}: ${stockLines.length ? "stock is issued now, from what is reserved for the order first. " : ""}A dispatched delivery cannot be cancelled; goods that come back are recorded as a sales return.`}
      size="lg" error={save.error} fallback="The delivery could not be dispatched." onClose={onClose} label="Dispatch" isLoading={save.isPending} onPress={() => save.mutate()}>
      <ul className="flex flex-col gap-1 text-sm">
        {detail.lines.map((line) => (
          <li key={line.id}><span className="font-medium">{line.item_name_snapshot}</span> × {amount(line.quantity)}{line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}
            {line.warehouse_id ? <span className="text-text-muted"> · reserved {amount(line.reserved_now)}</span> : <span className="text-text-muted"> · not stock tracked</span>}</li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Dispatch date" type="date" value={dispatchDate} onChange={setDispatchDate} />
        <TextField label="Carrier / transporter" value={carrier} onChange={setCarrier} />
        <TextField label="Tracking / LR number" value={trackingNumber} onChange={setTrackingNumber} />
        <TextField label="Tracking link" placeholder="https://" value={trackingUrl} onChange={setTrackingUrl} />
        <TextField label="Vehicle" value={vehicle} onChange={setVehicle} />
        <NumberField label="Packages" value={packages ?? Number.NaN} minValue={0} step={1} onChange={(value) => setPackages(Number.isFinite(value) ? value : null)} />
      </div>
    </Shell>
  );
}

export function MarkDeliveredDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const delivery = detail.delivery;
  const [deliveredAt, setDeliveredAt] = useState(today);
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => markDeliveryDelivered(delivery.id, { deliveredAt: deliveredAt || undefined, receivedBy: optional(receivedBy), note: optional(note) }),
    onSuccess: onDone,
  });
  return (
    <Shell title={`${delivery.request_number} delivered to the customer`} description="Add the signed delivery note or a photo as proof of delivery once it is marked delivered."
      error={save.error} fallback="The delivery could not be marked delivered." onClose={onClose} label="Mark Delivered" isLoading={save.isPending} onPress={() => save.mutate()}>
      <TextField label="Delivered on" type="date" value={deliveredAt} onChange={setDeliveredAt} />
      <TextField label="Received by" value={receivedBy} onChange={setReceivedBy} />
      <TextArea label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}

export function CancelDeliveryDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelDelivery(detail.delivery.id, { reasonCode, reason: optional(reason) }), onSuccess: onDone });
  return (
    <Shell title={`Cancel ${detail.delivery.request_number}?`} description="Nothing has left the warehouse, so no stock moves. The order's reservations stay as they are and its quantities can go on another delivery."
      error={save.error} fallback="The delivery could not be cancelled." onClose={onClose} label="Cancel Delivery" isLoading={save.isPending}
      isDisabled={!reasonCode || (reasonCode === "other" && !reason.trim())} onPress={() => save.mutate()}>
      <Select label="Reason" isRequired placeholder="Choose a reason" options={detail.cancelReasons.map((entry) => ({ value: entry.code, label: entry.label }))}
        selectedKey={reasonCode || null} onSelectionChange={(selected) => setReasonCode(String(selected ?? ""))} />
      <TextArea label="Details" isRequired={reasonCode === "other"} value={reason} onChange={setReason} />
    </Shell>
  );
}

export function ShipmentDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const delivery = detail.delivery;
  const [carrier, setCarrier] = useState(delivery.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(delivery.tracking_number ?? "");
  const [trackingUrl, setTrackingUrl] = useState(delivery.tracking_url ?? "");
  const [vehicle, setVehicle] = useState(delivery.vehicle_reference ?? "");
  const [expected, setExpected] = useState(day(delivery.expected_delivery_date));
  const [packages, setPackages] = useState<number | null>(delivery.package_count);
  const [packageNotes, setPackageNotes] = useState(delivery.package_notes ?? "");
  const save = useMutation({
    mutationFn: () => updateShipmentDetails(delivery.id, {
      expectedVersion: delivery.version, carrier: carrier.trim() || null, trackingNumber: trackingNumber.trim() || null, trackingUrl: trackingUrl.trim() || null,
      vehicleReference: vehicle.trim() || null, expectedDeliveryDate: expected || null, packageCount: packages, packageNotes: packageNotes.trim() || null,
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title={`Shipment of ${delivery.request_number}`} error={save.error} fallback="The shipment could not be saved." onClose={onClose} label="Save" isLoading={save.isPending}
      onPress={() => save.mutate()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Carrier / transporter" value={carrier} onChange={setCarrier} />
        <TextField label="Tracking / LR number" value={trackingNumber} onChange={setTrackingNumber} />
        <TextField label="Tracking link" placeholder="https://" value={trackingUrl} onChange={setTrackingUrl} />
        <TextField label="Vehicle" value={vehicle} onChange={setVehicle} />
        <TextField label="Expected delivery date" type="date" value={expected} onChange={setExpected} />
        <NumberField label="Packages" value={packages ?? Number.NaN} minValue={0} step={1} onChange={(value) => setPackages(Number.isFinite(value) ? value : null)} />
      </div>
      <TextField label="Package details" value={packageNotes} onChange={setPackageNotes} />
    </Shell>
  );
}

// Moves a draft to another warehouse: the order lines' reservations move with it.
export function ChangeWarehouseDialog({ detail, onClose, onDone }: { detail: DeliveryDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options), staleTime: 60_000 });
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => changeDeliveryWarehouse(detail.delivery.id, { warehouseId, reason: optional(reason) }), onSuccess: onDone });
  return (
    <Shell title={`Ship ${detail.delivery.request_number} from another warehouse`}
      description="The order lines on this delivery move to the new warehouse: what is reserved for them is released where it is and reserved again in the new warehouse, as far as stock allows."
      error={save.error} fallback="The warehouse could not be changed." onClose={onClose} label="Change Warehouse" isLoading={save.isPending} isDisabled={!warehouseId} onPress={() => save.mutate()}>
      <Select label="Warehouse" isRequired placeholder="Choose a warehouse" selectedKey={warehouseId || null}
        options={(options.data?.warehouses ?? []).filter((warehouse) => warehouse.id !== detail.delivery.warehouse_id).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
        onSelectionChange={(selected) => setWarehouseId(String(selected ?? ""))} />
      <TextField label="Reason" value={reason} onChange={setReason} />
    </Shell>
  );
}
