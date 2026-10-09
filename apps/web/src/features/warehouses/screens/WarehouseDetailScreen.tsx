"use client";

// One warehouse: Overview, Stock, Locations, Movements, Incoming & Outgoing, Transfers, Batches & Serials, Access and History. Every
// quantity is read from Inventory (balances, the ledger and open documents); incoming and outgoing are never added to on hand.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  AlertDialog, Badge, Button, Checkbox, CheckboxGroup, ComboBox, Dialog, EmptyState, ErrorState, RecordDetailsPage, SearchField, Select, StatusBadge, Tab,
  TabList, TabPanel, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { listAdjustments } from "@/features/adjustments/api/adjustments-api";
import { InventoryAttention } from "@/features/replenishment/components/InventoryAttention";
import { listRules, STATUS_TONE as REORDER_TONE } from "@/features/replenishment/api/replenishment-api";
import { listReservations } from "@/features/reservations/api/reservations-api";
import { ErrorBanner, NONE, money, orNull, quantity, withNone } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { WarehouseValuationCard } from "@/features/valuation/components/ValuationCards";

import {
  blockersOf, createLocation, deleteWarehouse, errorCode, errorMessage, fieldErrors, getDeactivationBlockers, getWarehouse, getWarehouseBatches, getWarehouseHistory, getWarehouseIncoming,
  getWarehouseMovements, getWarehouseOptions, getWarehouseOutgoing, getWarehouseSerials, getWarehouseStock, getWarehouseTransfers, listWarehouses, setDefaultLocation, setLocationStatus,
  setMyDefaultWarehouse, setWarehouseAccess, setWarehouseStatus, updateLocation, updateWarehouse, type Blocker, type FlowRow, type WarehouseDetail, type WarehouseLocation,
  type WarehouseOperation, type WarehouseOptions,
} from "../api/warehouses-api";
import { WarehouseFormDialog, type WarehouseFormTarget } from "../components/WarehouseFormDialog";
import { WAREHOUSE_BASE } from "./WarehousesScreen";

// Overview, On Hand (with batches and serials), Locations, Reservations, Incoming & Outgoing, Transfers, Transactions (movements and the
// adjustments posted here), Replenishment, History, Settings. Earlier tab ids keep working: tracking opens On Hand, adjustments Transactions.
const TABS = ["overview", "stock", "locations", "reservations", "flows", "transfers", "movements", "replenishment", "history", "access"] as const;
const EARLIER_TABS: Record<string, string> = { tracking: "stock", adjustments: "movements" };
const FLOW_LABEL: Record<string, string> = {
  purchase_order: "Purchase order", transfer_in: "Transfer in", sales_return: "Sales return", reservation: "Reservation", delivery: "Delivery", transfer_out: "Transfer out",
  purchase_return: "Purchase return",
};


function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}


export function WarehouseDetailScreen({ warehouseId, initialTab }: { warehouseId: string; initialTab?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(() => {
    const requested = initialTab ? EARLIER_TABS[initialTab] ?? initialTab : null;
    return requested && (TABS as readonly string[]).includes(requested) ? requested : "overview";
  });
  const [form, setForm] = useState<WarehouseFormTarget | null>(null);
  const [dialog, setDialog] = useState<"deactivate" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "one", warehouseId), queryFn: () => getWarehouse(warehouseId) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "options"), queryFn: getWarehouseOptions, staleTime: 60_000 });
  const refresh = (message?: string) => { setError(null); if (message) setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "warehouses") }); };
  const fail = (failure: unknown) => setError(errorMessage(failure));
  const makeDefault = useMutation({ mutationFn: () => updateWarehouse(warehouseId, { isDefault: true }), onSuccess: (warehouse) => refresh(`${warehouse.name} is now the company's default warehouse.`), onError: fail });
  const preferred = useMutation({ mutationFn: (id: string | null) => setMyDefaultWarehouse(id), onSuccess: (result) => refresh(result ? `New documents now start in ${result.code}.` : "Preference cleared."), onError: fail });
  const activate = useMutation({ mutationFn: () => setWarehouseStatus(warehouseId, { status: "active" }), onSuccess: () => refresh("Reactivated."), onError: fail });
  const remove = useMutation({ mutationFn: () => deleteWarehouse(warehouseId), onSuccess: () => { refresh(); router.push(WAREHOUSE_BASE); }, onError: (failure) => { setDialog(null); fail(failure); } });

  if (query.isLoading) return <LoadingState label="Loading warehouse" rows={6} />;
  if (query.isError) return errorCode(query.error) === "WAREHOUSE_NOT_FOUND"
    ? <EmptyState title="Warehouse not found" description="It may have been deleted." action={{ label: "All warehouses", onPress: () => router.push(WAREHOUSE_BASE) }} />
    : <ErrorState title="Could not load the warehouse" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const warehouse = query.data!;
  const can = warehouse.capabilities;
  const mine = options.data?.myDefault?.warehouseId === warehouse.id && options.data.myDefault.source === "user";
  const menu = [
    ...(can.edit && warehouse.isActive && !warehouse.isDefault ? [{ id: "default", label: "Make company default", run: () => makeDefault.mutate() }] : []),
    ...(warehouse.isActive && !mine ? [{ id: "mine", label: "Use as my default warehouse", run: () => preferred.mutate(warehouse.id) }] : []),
    ...(mine ? [{ id: "not-mine", label: "Stop using as my default", run: () => preferred.mutate(null) }] : []),
    ...(can.status && warehouse.isActive ? [{ id: "deactivate", label: "Deactivate", run: () => setDialog("deactivate") }] : []),
    ...(can.status && !warehouse.isActive ? [{ id: "activate", label: "Reactivate", run: () => activate.mutate() }] : []),
    ...(can.status ? [{ id: "delete", label: "Delete", run: () => setDialog("delete") }] : []),
  ];

  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{warehouse.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{warehouse.code}</span></>,
        status: (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={warehouse.isActive ? "success" : "neutral"}>{warehouse.isActive ? "Active" : "Inactive"}</StatusBadge>
            {warehouse.isDefault && <Badge tone="info">Company default</Badge>}
            {mine && <Badge tone="brand">My default</Badge>}
          </span>
        ),
        fields: [
          { label: "Type", value: warehouse.typeLabel },
          { label: "Address", value: warehouse.addressText || "Not set" },
          { label: "Manager", value: warehouse.managerName ?? "Not set" },
        ],
        secondaryActions: (
          <>
            {can.edit && <Button variant="secondary" onPress={() => setForm({ mode: "edit", warehouse })}>Edit</Button>}
            <MoreActions actions={menu.map((entry) => ({ id: entry.id, label: entry.label, run: () => { setError(null); setNotice(null); entry.run(); } }))} />
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {notice && <Notice tone="success">{notice}</Notice>}
          <InventoryAttention warehouseId={warehouse.id} />
          {warehouse.showsStock && <WarehouseActions warehouseId={warehouse.id} />}
        </div>
      }
    >
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
        <TabList aria-label="Warehouse sections">
          <Tab id="overview">Overview</Tab>
          {warehouse.showsStock && <Tab id="stock">On Hand</Tab>}
          <Tab id="locations">Locations</Tab>
          {warehouse.showsStock && <Tab id="reservations">Reservations</Tab>}
          {warehouse.showsStock && <Tab id="flows">Incoming &amp; Outgoing</Tab>}
          {warehouse.showsStock && <Tab id="transfers">Transfers</Tab>}
          {warehouse.showsStock && <Tab id="movements">Transactions</Tab>}
          {warehouse.showsStock && <Tab id="replenishment">Replenishment</Tab>}
          <Tab id="history">History</Tab>
          <Tab id="access">Settings</Tab>
        </TabList>
        <TabPanel id="overview" className="pt-3"><Overview warehouse={warehouse} /></TabPanel>
        <TabPanel id="stock" className="flex flex-col gap-6 pt-3"><StockPanel warehouse={warehouse} /><TrackingPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="locations" className="pt-3"><LocationsPanel warehouse={warehouse} options={options.data} onChanged={refresh} /></TabPanel>
        <TabPanel id="reservations" className="pt-3"><ReservationsPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="flows" className="pt-3"><FlowsPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="transfers" className="pt-3"><TransfersPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="movements" className="flex flex-col gap-6 pt-3"><MovementsPanel warehouse={warehouse} /><AdjustmentsPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="replenishment" className="pt-3"><ReplenishmentPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="history" className="pt-3"><HistoryPanel warehouse={warehouse} /></TabPanel>
        <TabPanel id="access" className="pt-3"><AccessPanel warehouse={warehouse} options={options.data} onChanged={refresh} /></TabPanel>
      </Tabs>
    </RecordDetailsPage>

      <WarehouseFormDialog target={form} options={options.data} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh("Saved."); }} />
      {dialog === "deactivate" && <DeactivateDialog warehouse={warehouse} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Deactivated. Its history stays."); }} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${warehouse.name}?`}
        description="Only a warehouse nothing has ever used can be deleted. Anything else is deactivated, keeping its history." confirmLabel="Delete"
        isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function Overview({ warehouse }: { warehouse: WarehouseDetail }) {
  const stock = warehouse.stock;
  return (
    <div className="flex flex-col gap-4">
      {stock && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure label="On hand" value={quantity(stock.onHand)} hint={`${stock.items} item${stock.items === 1 ? "" : "s"}`} />
          <Figure label="Reserved" value={quantity(stock.reserved)} />
          <Figure label="Available" value={quantity(stock.available)} hint={stock.restricted ? `${quantity(stock.restricted)} in quality hold` : undefined} />
          {stock.value !== undefined ? <Figure label="Value" value={money(stock.value)} /> : <Figure label="Incoming / Outgoing" value={`${quantity(stock.incoming ?? 0)} / ${quantity(stock.outgoing ?? 0)}`} />}
          {stock.value !== undefined && <Figure label="Incoming" value={quantity(stock.incoming ?? 0)} hint="Expected, not on hand" />}
          {stock.value !== undefined && <Figure label="Outgoing" value={quantity(stock.outgoing ?? 0)} hint="Reserved or to ship" />}
        </div>
      )}
      {stock?.value !== undefined && <WarehouseValuationCard warehouseId={warehouse.id} />}
      <FactList items={[
        ["Code", warehouse.code], ["Type", warehouse.typeLabel], ["Address", warehouse.addressText], ["State code (GST)", warehouse.address.stateCode],
        ["GST registration", warehouse.taxRegistration], ["Time zone", warehouse.timezone], ["Manager", warehouse.managerName], ["Contact", warehouse.contactName],
        ["Phone", warehouse.phone], ["Email", warehouse.email],
        ["Operations", [warehouse.receivingEnabled && "Receives", warehouse.shippingEnabled && "Ships", warehouse.transferEnabled && "Transfers", warehouse.returnsEnabled && "Takes returns"].filter(Boolean).join(" · ") || "None"],
        ["Locations", `${warehouse.locations.filter((location) => location.isActive).length} active`], ["Description", warehouse.description],
      ]} />
    </div>
  );
}

function StockPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState(NONE);
  const [status, setStatus] = useState(NONE);
  const filters = { search: search.trim() || undefined, locationId: orNull(locationId) ?? undefined, status: orNull(status) ?? undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "stock", warehouse.id, filters), queryFn: () => getWarehouseStock(warehouse.id, filters), placeholderData: (previous) => previous });
  const showValue = query.data?.showsValue ?? false;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <SearchField aria-label="Search items" placeholder="Search SKU or name" className="w-full sm:w-64" value={search} onChange={setSearch} />
        <Select aria-label="Location" size="compact" selectedKey={locationId} onSelectionChange={(key) => setLocationId(String(key))}
          options={withNone(warehouse.locations.map((location) => ({ value: location.id, label: location.code })), "Any location")} />
        <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
          options={withNone([{ value: "available", label: "Available" }, { value: "reserved", label: "Reserved" }, { value: "quality_hold", label: "Quality hold" }], "Any status")} />
      </div>
      {query.isLoading ? <LoadingState label="Loading stock" rows={4} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["SKU", "Item", "Category", "On hand", "Reserved", "Quality hold", "Available", ...(showValue ? ["Value"] : [])]} empty={!query.data?.items.length}>
          {query.data?.items.map((row) => (
            <tr key={row.itemId}>
              <Cell>{row.sku}</Cell><Cell>{row.name}</Cell><Cell>{row.category}</Cell><Cell numeric>{quantity(row.onHand, row.uom)}</Cell><Cell numeric>{quantity(row.reserved)}</Cell>
              <Cell numeric>{quantity(row.qualityHold)}</Cell><Cell numeric>{quantity(row.available)}</Cell>{showValue && <Cell numeric>{money(row.value ?? 0)}</Cell>}
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}

type LocationTarget = { mode: "new" } | { mode: "edit"; location: WarehouseLocation };

function LocationsPanel({ warehouse, options, onChanged }: { warehouse: WarehouseDetail; options?: WarehouseOptions; onChanged: (message?: string) => void }) {
  const [target, setTarget] = useState<LocationTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const can = warehouse.capabilities.manageLocations;
  const status = useMutation({
    mutationFn: (location: WarehouseLocation) => setLocationStatus(warehouse.id, location.id, location.isActive ? "inactive" : "active"),
    onSuccess: (location) => { setError(null); onChanged(`${location.code} is now ${location.status}.`); }, onError: (failure) => setError(errorMessage(failure)),
  });
  const defaults = useMutation({
    mutationFn: ({ kind, locationId }: { kind: "receiving" | "returns" | "shipping"; locationId: string | null }) => setDefaultLocation(warehouse.id, kind, locationId),
    onSuccess: () => { setError(null); onChanged("Default location saved."); }, onError: (failure) => setError(errorMessage(failure)),
  });
  const choices = warehouse.locations.filter((location) => location.isActive && location.allowStock && !location.isMain);
  const current = (flag: "isDefaultReceiving" | "isDefaultReturns" | "isDefaultShipping") => warehouse.locations.find((location) => location[flag])?.id ?? NONE;
  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      <p className="text-sm text-text-muted">MAIN is the warehouse&apos;s default storage location: stock received without a location is in MAIN.</p>
      {can && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([["receiving", "isDefaultReceiving", "Default receiving location"], ["returns", "isDefaultReturns", "Default returns location"], ["shipping", "isDefaultShipping", "Default shipping location"]] as const)
            .map(([kind, flag, label]) => (
              <Select key={kind} label={label} selectedKey={current(flag)} isDisabled={defaults.isPending}
                onSelectionChange={(key) => defaults.mutate({ kind, locationId: orNull(String(key)) })}
                options={withNone(choices.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` })), "MAIN")} />
            ))}
        </div>
      )}
      <div className="flex justify-end">{can && <Button variant="secondary" onPress={() => setTarget({ mode: "new" })}><Plus className="size-4" aria-hidden="true" />Add location</Button>}</div>
      <LinesTable columns={["Code", "Name", "Purpose", "Holds", "Allocatable", "Inside", "Defaults", "On hand", "Status", ...(can ? [""] : [])]}>
        {warehouse.locations.map((location) => (
          <tr key={location.id}>
            <Cell>{location.code}</Cell><Cell>{location.name}</Cell><Cell>{location.purposeLabel}</Cell><Cell>{location.allowStock ? location.dispositionLabel : "No stock"}</Cell>
            <Cell>{location.allocatable ? "Yes" : "No"}</Cell><Cell>{location.parentCode}</Cell>
            <Cell>{[location.isDefaultStorage && "Storage", location.isDefaultReceiving && "Receiving", location.isDefaultReturns && "Returns", location.isDefaultShipping && "Shipping"].filter(Boolean).join(", ") || null}</Cell>
            <Cell numeric>{location.onHand === null ? null : quantity(location.onHand)}</Cell>
            <Cell>{location.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</Cell>
            {can && <td className="px-3 py-2 whitespace-nowrap">
              <Button size="compact" variant="ghost" onPress={() => setTarget({ mode: "edit", location })}>Edit</Button>
              {!location.isMain && <Button size="compact" variant="ghost" isDisabled={status.isPending} onPress={() => status.mutate(location)}>{location.isActive ? "Deactivate" : "Reactivate"}</Button>}
            </td>}
          </tr>
        ))}
      </LinesTable>
      <Dialog isOpen={target !== null} onOpenChange={(open) => !open && setTarget(null)} title={target?.mode === "edit" ? `Edit ${target.location.code}` : "Add location"}>
        {target && <LocationForm key={target.mode === "edit" ? target.location.id : "new"} warehouse={warehouse} target={target} options={options}
          onClose={() => setTarget(null)} onSaved={(location) => { setTarget(null); onChanged(`${location.code} saved.`); }} />}
      </Dialog>
    </div>
  );
}

function LocationForm({ warehouse, target, options, onClose, onSaved }: {
  warehouse: WarehouseDetail; target: LocationTarget; options?: WarehouseOptions; onClose: () => void; onSaved: (location: WarehouseLocation) => void;
}) {
  const editing = target.mode === "edit" ? target.location : null;
  const [code, setCode] = useState(editing?.code ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [purpose, setPurpose] = useState(editing?.purpose ?? "storage");
  const [structure, setStructure] = useState(editing?.structure === "quality" ? "zone" : editing?.structure ?? "bin");
  const [parentId, setParentId] = useState(editing?.parentLocationId ?? NONE);
  const [allowStock, setAllowStock] = useState(editing?.allowStock ?? true);
  const [disposition, setDisposition] = useState<string>(editing?.disposition ?? "available");
  const [allowAllocation, setAllowAllocation] = useState(editing?.allowAllocation ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const input = { name, purpose, structure, parentLocationId: orNull(parentId), allowStock, disposition: purpose === "quality_hold" && disposition === "available" ? "quality_hold" : disposition,
        allowAllocation: disposition === "available" && allowAllocation };
      return editing ? updateLocation(warehouse.id, editing.id, { ...input, expectedVersion: editing.version }) : createLocation(warehouse.id, { ...input, code });
    },
    onSuccess: onSaved, onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });
  const parents = warehouse.locations.filter((location) => location.isActive && location.id !== editing?.id);
  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Code" isRequired isDisabled={Boolean(editing)} value={code} onChange={(value) => setCode(value.toUpperCase().replace(/\s/g, ""))} errorMessage={errors.code}
          description={editing ? "A location's code does not change." : "Unique in this warehouse, such as RACK-A01."} />
        <TextField label="Name" isRequired value={name} onChange={setName} errorMessage={errors.name} />
        <Select label="Purpose" selectedKey={purpose} isDisabled={editing?.isMain} onSelectionChange={(key) => setPurpose(String(key))} errorMessage={errors.purpose}
          options={(options?.purposes ?? [{ code: "storage", label: "Storage" }]).map((entry) => ({ value: entry.code, label: entry.label }))}
          description={purpose === "quality_hold" ? "Stock here is never available to sell or issue." : undefined} />
        <Select label="Kind" selectedKey={structure} onSelectionChange={(key) => setStructure(String(key))} errorMessage={errors.structure}
          options={(options?.structures ?? ["zone", "aisle", "rack", "bin", "staging", "other"]).map((entry) => ({ value: entry, label: entry[0].toUpperCase() + entry.slice(1) }))} />
        <ComboBox className="sm:col-span-2" label="Inside location" selectedKey={parentId} placeholder="Search locations" errorMessage={errors.parentLocationId}
          options={withNone(parents.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` })), "Directly in the warehouse")}
          onSelectionChange={(key) => key !== null && setParentId(String(key))} />
        <Select label="Stock here is" selectedKey={purpose === "quality_hold" && disposition === "available" ? "quality_hold" : disposition} isDisabled={editing?.isMain}
          onSelectionChange={(key) => setDisposition(String(key))} errorMessage={errors.disposition}
          options={(options?.dispositions ?? [{ code: "available", label: "Available" }]).filter((entry) => purpose !== "quality_hold" || entry.code !== "available").map((entry) => ({ value: entry.code, label: entry.label }))}
          description={disposition === "available" ? "Counts toward available stock." : "On hand, never allocated, reserved or sold."} />
        <Checkbox isSelected={disposition === "available" && allowAllocation} isDisabled={editing?.isMain || disposition !== "available"} onChange={setAllowAllocation}>
          Stock here may be allocated (reserved, sold, issued)
        </Checkbox>
        <Checkbox isSelected={allowStock} isDisabled={editing?.isMain} onChange={setAllowStock}>Holds stock (untick for a zone or rack that only groups bins)</Checkbox>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>{editing ? "Save" : "Add location"}</Button>
      </div>
    </div>
  );
}

function MovementsPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const [reference, setReference] = useState("");
  const [type, setType] = useState(NONE);
  const filters = { reference: reference.trim() || undefined, movementType: orNull(type) ?? undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "movements", warehouse.id, filters), queryFn: () => getWarehouseMovements(warehouse.id, filters), placeholderData: (previous) => previous });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <SearchField aria-label="Search movements" placeholder="Movement number or reference" className="w-full sm:w-64" value={reference} onChange={setReference} />
        <Link className="self-center text-sm text-brand hover:underline" href={`/inventory/transactions?tab=movements&warehouseId=${warehouse.id}`}>Full movement history</Link>
        <Select aria-label="Type" size="compact" selectedKey={type} onSelectionChange={(key) => setType(String(key))}
          options={withNone(["receipt", "issue", "adjustment", "return"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })), "Any type")} />
      </div>
      {query.isLoading ? <LoadingState label="Loading movements" rows={4} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["When", "Movement", "Type", "Item", "Location", "Batch / Serial", "In", "Out", "Reference"]} empty={!query.data?.length}>
          {query.data?.map((row) => (
            <tr key={row.id}>
              <Cell>{formatDateTime(row.occurredAt)}</Cell><Cell>{row.number}</Cell><Cell>{row.type}</Cell><Cell>{row.sku} · {row.item}</Cell><Cell>{row.location}</Cell><Cell>{row.batch ?? row.serial}</Cell>
              <Cell numeric>{row.in === null ? null : quantity(row.in)}</Cell><Cell numeric>{row.out === null ? null : quantity(row.out)}</Cell><Cell>{row.reference}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}

function FlowTable({ rows }: { rows: FlowRow[] }) {
  return (
    <LinesTable columns={["Kind", "Reference", "Item", "Quantity", "Expected / Other"]} empty={!rows.length}>
      {rows.map((row, index) => (
        <tr key={`${row.kind}-${row.id}-${index}`}>
          <Cell>{FLOW_LABEL[row.kind] ?? row.kind}</Cell><Cell>{row.reference}</Cell><Cell>{row.sku} · {row.item}</Cell><Cell numeric>{quantity(row.quantity)}</Cell><Cell>{row.expected ?? row.other}</Cell>
        </tr>
      ))}
    </LinesTable>
  );
}

function FlowsPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const incoming = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "incoming", warehouse.id), queryFn: () => getWarehouseIncoming(warehouse.id) });
  const outgoing = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "outgoing", warehouse.id), queryFn: () => getWarehouseOutgoing(warehouse.id) });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">Expected and committed quantities. They are not on hand until received, and stay on hand until shipped.</p>
      <section className="flex flex-col gap-2"><h2 className="text-sm font-semibold">Incoming</h2>
        {incoming.isLoading ? <LoadingState label="Loading incoming" rows={3} /> : incoming.isError ? <ErrorBanner message={errorMessage(incoming.error)} /> : <FlowTable rows={incoming.data ?? []} />}</section>
      <section className="flex flex-col gap-2"><h2 className="text-sm font-semibold">Outgoing</h2>
        {outgoing.isLoading ? <LoadingState label="Loading outgoing" rows={3} /> : outgoing.isError ? <ErrorBanner message={errorMessage(outgoing.error)} /> : <FlowTable rows={outgoing.data ?? []} />}</section>
    </div>
  );
}

function TransfersPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "transfers", warehouse.id), queryFn: () => getWarehouseTransfers(warehouse.id) });
  if (query.isLoading) return <LoadingState label="Loading transfers" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  return (
    <LinesTable columns={["Transfer", "Direction", "Item", "From", "To", "Quantity", "Status", "Created"]} empty={!query.data?.length}>
      {query.data?.map((row) => (
        <tr key={row.id}>
          <Cell>{row.number}</Cell><Cell>{row.direction === "inbound" ? "In" : "Out"}</Cell><Cell>{row.sku} · {row.item}</Cell><Cell>{row.source}</Cell><Cell>{row.destination}</Cell>
          <Cell numeric>{quantity(row.quantity)}</Cell><Cell>{row.status.replace("_", " ")}</Cell><Cell>{formatDateTime(row.createdAt)}</Cell>
        </tr>
      ))}
    </LinesTable>
  );
}

function TrackingPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const batches = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "batches", warehouse.id), queryFn: () => getWarehouseBatches(warehouse.id) });
  const serials = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "serials", warehouse.id), queryFn: () => getWarehouseSerials(warehouse.id) });
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2"><h2 className="text-sm font-semibold">Batches</h2>
        {batches.isLoading ? <LoadingState label="Loading batches" rows={3} /> : batches.isError ? <ErrorBanner message={errorMessage(batches.error)} /> : (
          <LinesTable columns={["Batch", "Item", "Location", "Expiry", "Quantity", "Status"]} empty={!batches.data?.length}>
            {batches.data?.map((row) => (
              <tr key={`${row.batchId}-${row.location}`}>
                <Cell>{row.batch}</Cell><Cell>{row.sku} · {row.item}</Cell><Cell>{row.location}</Cell><Cell>{row.expiry?.slice(0, 10)}</Cell><Cell numeric>{quantity(row.quantity)}</Cell>
                <Cell>{row.disposition === "quality_hold" ? "Quality hold" : row.status}</Cell>
              </tr>
            ))}
          </LinesTable>
        )}</section>
      <section className="flex flex-col gap-2"><h2 className="text-sm font-semibold">Serial numbers</h2>
        {serials.isLoading ? <LoadingState label="Loading serial numbers" rows={3} /> : serials.isError ? <ErrorBanner message={errorMessage(serials.error)} /> : (
          <LinesTable columns={["Serial", "Item", "Location", "Status"]} empty={!serials.data?.length}>
            {serials.data?.map((row) => <tr key={row.serialId}><Cell>{row.serial}</Cell><Cell>{row.sku} · {row.item}</Cell><Cell>{row.location}</Cell><Cell>{row.status}</Cell></tr>)}
          </LinesTable>
        )}</section>
    </div>
  );
}

function AccessPanel({ warehouse, options, onChanged }: { warehouse: WarehouseDetail; options?: WarehouseOptions; onChanged: (message?: string) => void }) {
  const [entries, setEntries] = useState(() => warehouse.access.map((entry) => ({ userId: entry.userId, operations: entry.operations })));
  const [adding, setAdding] = useState<string>(NONE);
  const [error, setError] = useState<string | null>(null);
  const can = warehouse.capabilities.manageAccess;
  const save = useMutation({ mutationFn: () => setWarehouseAccess(warehouse.id, entries), onSuccess: () => { setError(null); onChanged("Access saved."); }, onError: (failure) => setError(errorMessage(failure)) });
  const operations = options?.operations ?? [];
  const nameOf = (userId: string) => options?.members.find((member) => member.id === userId)?.name ?? warehouse.access.find((entry) => entry.userId === userId)?.name ?? "…";
  const candidates = (options?.members ?? []).filter((member) => !entries.some((entry) => entry.userId === member.id));
  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      <p className="text-sm text-text-muted">
        {entries.length ? "Only the people listed (and owners and administrators) may work in this warehouse, each in the operations ticked. Someone listed on any warehouse works only in the warehouses they are listed on."
          : "Nobody is listed: everyone with the inventory permissions may work here, unless they are listed on other warehouses only."}
      </p>
      {entries.map((entry, index) => (
        <div key={entry.userId} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{nameOf(entry.userId)}</span>
            {can && <Button size="compact" variant="ghost" onPress={() => setEntries((current) => current.filter((_, position) => position !== index))}>Remove</Button>}
          </div>
          <CheckboxGroup aria-label={`Operations for ${nameOf(entry.userId)}`} orientation="horizontal" isDisabled={!can} value={entry.operations}
            onChange={(value) => setEntries((current) => current.map((row, position) => (position === index ? { ...row, operations: value as WarehouseOperation[] } : row)))}>
            {operations.map((operation) => <Checkbox key={operation.code} value={operation.code}>{operation.label}</Checkbox>)}
          </CheckboxGroup>
        </div>
      ))}
      {can && (
        <div className="flex flex-wrap items-end gap-2">
          <ComboBox className="w-full sm:w-72" label="Add a person" selectedKey={adding} placeholder="Search people" onSelectionChange={(key) => key !== null && setAdding(String(key))}
            options={withNone(candidates.map((member) => ({ value: member.id, label: member.name })), "Choose")} />
          <Button variant="secondary" isDisabled={adding === NONE} onPress={() => { setEntries((current) => [...current, { userId: adding, operations: operations.map((operation) => operation.code) }]); setAdding(NONE); }}>Add</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save access</Button>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "history", warehouse.id), queryFn: () => getWarehouseHistory(warehouse.id) });
  if (query.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  if (!query.data?.length) return <p className="py-4 text-sm text-text-muted">No changes recorded yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-border text-sm">
      {query.data.map((row) => (
        <li key={row.id} className="flex flex-col gap-0.5 py-2">
          <span>{row.summary}{row.reason ? <span className="text-text-muted"> · {row.reason}</span> : null}</span>
          <span className="text-xs text-text-muted">{formatDateTime(row.createdAt)}{row.actorName ? ` · ${row.actorName}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

// Deactivation lists what stands in the way (stock, reservations, open documents, defaults elsewhere); the company default needs a replacement.
function DeactivateDialog({ warehouse, onClose, onDone }: { warehouse: WarehouseDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState(NONE);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "blockers", warehouse.id), queryFn: () => getDeactivationBlockers(warehouse.id) });
  const others = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "list", { view: "active" }), queryFn: () => listWarehouses({ view: "active" }), enabled: warehouse.isDefault });
  const run = useMutation({
    mutationFn: () => setWarehouseStatus(warehouse.id, { status: "inactive", reason: reason.trim() || undefined, replacementDefaultId: orNull(replacement) ?? undefined }),
    onSuccess: onDone, onError: (failure) => { setBlockers(blockersOf(failure)); setError(errorMessage(failure)); },
  });
  const shown = blockers ?? check.data ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Deactivate ${warehouse.name}?`}>
      <div className="flex flex-col gap-3">
        {check.isLoading ? <LoadingState label="Checking" rows={2} /> : shown.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">It cannot be deactivated yet:</p>
            <ul className="list-disc pl-5">{shown.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
          </div>
        ) : <p className="text-sm">Nothing new can be received, shipped or moved here once it is inactive. Its history and documents stay, and it can be reactivated.</p>}
        {!shown.length && <ErrorBanner message={error} />}
        {warehouse.isDefault && !shown.length && (
          <Select label="New company default" isRequired selectedKey={replacement} onSelectionChange={(key) => setReplacement(String(key))}
            options={withNone((others.data?.warehouses ?? []).filter((entry) => entry.id !== warehouse.id).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` })), "Choose")} />
        )}
        {!shown.length && <TextArea label="Reason" rows={2} value={reason} onChange={setReason} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>{shown.length ? "Close" : "Cancel"}</Button>
          {!shown.length && <Button variant="danger" isLoading={run.isPending} isDisabled={warehouse.isDefault && replacement === NONE} onPress={() => run.mutate()}>Deactivate</Button>}
        </div>
      </div>
    </Dialog>
  );
}

// What starts from this warehouse: receiving, issuing, transferring, counting, adjusting — and its alerts, reservations and movements. Each
// page checks its own permission; an action the person may not take is not offered.
function WarehouseActions({ warehouseId }: { warehouseId: string }) {
  const { permissions, roleSlugs } = useWorkspaceContext();
  const has = (permission: string) => roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator") || permissions.includes(permission);
  const entries: Array<[string, string, string, "secondary" | "outline"]> = [
    ["Receive goods", "/procurement/goods-receipts", "procurement.receipts.manage", "secondary"],
    ["Create goods issue", `/inventory/goods-issues/new?warehouseId=${warehouseId}`, "stock.goods_issue.create", "secondary"],
    ["Create transfer", `/inventory/transfers/new?warehouseId=${warehouseId}`, "stock.transfers.create", "secondary"],
    ["Start stock count", `/inventory/stock-counts/new?warehouseId=${warehouseId}`, "stock.counts.create", "secondary"],
    ["Create adjustment", `/inventory/adjustments/new?warehouseId=${warehouseId}`, "stock.adjustments.create", "secondary"],
    ["Low-stock alerts", `/inventory/replenishment?tab=alerts&warehouseId=${warehouseId}`, "stock.alerts.view", "outline"],
    ["Reservations", `/inventory/reservations?warehouseId=${warehouseId}`, "stock.reservations.view", "outline"],
    ["Movement history", `/inventory/transactions?tab=movements&warehouseId=${warehouseId}`, "stock.ledger.view", "outline"],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {entries.filter(([, , permission]) => has(permission)).map(([label, href, , variant]) => (
        <Link key={label} href={href} className={`inline-flex h-8 items-center rounded-[var(--radius-control)] border px-3 text-sm hover:bg-surface-muted ${variant === "secondary" ? "border-border bg-surface" : "border-transparent text-brand"}`}>{label}</Link>))}
    </div>
  );
}

function ReservationsPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "reservations", warehouse.id), queryFn: () => listReservations({ warehouseId: warehouse.id, status: "active", limit: "50" }), retry: false });
  if (query.isLoading) return <LoadingState label="Loading reservations" rows={3} />;
  if (query.isError) return <p className="text-sm text-text-muted">You cannot see reservations.</p>;
  const rows = query.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-2">
      <Link className="text-sm text-brand hover:underline" href={`/inventory/reservations?warehouseId=${warehouse.id}`}>All reservations at {warehouse.code}</Link>
      <LinesTable columns={["Reservation", "Item", "Source", "Reserved", "Status"]} empty={!rows.length}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-3 py-2"><Link className="text-brand hover:underline" href={`/inventory/reservations/${row.id}`}>{row.document ?? row.id.slice(0, 8)}</Link></td>
            <td className="px-3 py-2">{row.sku} · {row.itemName}</td>
            <td className="px-3 py-2">{row.sourceLabel}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.active)}</td>
            <td className="px-3 py-2">{row.statusLabel}</td>
          </tr>))}
      </LinesTable>
    </div>
  );
}

function AdjustmentsPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "adjustments", warehouse.id), queryFn: () => listAdjustments({ warehouseId: warehouse.id, limit: "50" }), retry: false });
  if (query.isLoading) return <LoadingState label="Loading adjustments" rows={3} />;
  if (query.isError) return <p className="text-sm text-text-muted">You cannot see stock adjustments.</p>;
  const rows = query.data?.rows ?? [];
  return (
    <LinesTable columns={["Adjustment", "Date", "Reason", "Lines", "Status"]} empty={!rows.length}>
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="px-3 py-2"><Link className="text-brand hover:underline" href={`/inventory/adjustments/${row.id}`}>{row.number}</Link></td>
          <td className="px-3 py-2">{row.adjustmentDate}</td>
          <td className="px-3 py-2">{row.reason}</td>
          <td className="px-3 py-2 tabular-nums">{row.lineCount}</td>
          <td className="px-3 py-2">{row.status}</td>
        </tr>))}
    </LinesTable>
  );
}

function ReplenishmentPanel({ warehouse }: { warehouse: WarehouseDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "warehouses", "replenishment", warehouse.id), queryFn: () => listRules({ view: "all", warehouseId: warehouse.id }), retry: false });
  if (query.isLoading) return <LoadingState label="Loading replenishment" rows={3} />;
  if (query.isError) return <p className="text-sm text-text-muted">You cannot see reorder levels.</p>;
  const rows = query.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-2">
      <Link className="text-sm text-brand hover:underline" href={`/inventory/replenishment?tab=rules&warehouseId=${warehouse.id}`}>Open Replenishment for {warehouse.code}</Link>
      <LinesTable columns={["Item", "Eligible", "Demand", "Incoming", "Projected", "Reorder", "Target", "Suggested", "Status"]} empty={!rows.length}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-3 py-2"><Link className="text-brand hover:underline" href={`/inventory/replenishment/${row.id}`}>{row.sku}</Link> · {row.itemName}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.eligibleOnHand)}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.firmDemand)}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.firmIncoming)}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.projectedPosition)}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.reorderLevel)}</td>
            <td className="px-3 py-2 tabular-nums">{quantity(row.targetLevel)}</td>
            <td className="px-3 py-2 tabular-nums">{row.suggested > 0 ? quantity(row.suggested) : "—"}</td>
            <td className="px-3 py-2"><Badge tone={REORDER_TONE[row.status]}>{row.statusLabel}</Badge></td>
          </tr>))}
      </LinesTable>
    </div>
  );
}
