"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MetricStrip, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, InvApiError, readStock } from "@/features/inventory/shared/client";
import { amount, label, quantity } from "@/features/inventory/shared/format";
import { InvAlert, InvPanel, useCan } from "@/features/inventory/shared/InvUi";

type LookupResult = { kind: string; item: { id: string; code: string; name: string; tracking_type?: string }; variant?: { sku: string; name: string }; batch?: { batch_number: string; status: string; expires_on: string | null }; serial?: { serial_number: string; status: string }; stock: { on_hand: string; reserved: string; available: string } };

// Scan or type a code: an item code or barcode, a variant SKU, a batch number or a serial number.
export function ScanLookup() {
  const [code, setCode] = useState("");
  const find = useMutation({ mutationFn: () => readStock<{ result: LookupResult }>("lookup", { code: code.trim() }).then((r) => r.result) });
  const result = find.data;
  return (
    <InvPanel title="Scan or look up" description="Item code, barcode, SKU, batch number or serial number.">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) find.mutate();
        }}
      >
        <TextField label="Code" value={code} onChange={setCode} className="min-w-[260px]" />
        <Button type="submit" variant="secondary" isLoading={find.isPending} isDisabled={!code.trim()}>
          Look up
        </Button>
      </form>
      {find.error && <InvAlert>{find.error instanceof InvApiError ? find.error.message : "Lookup failed."}</InvAlert>}
      {result && (
        <div role="status" aria-label="Lookup result" className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-text">
            {result.item.name} ({result.item.code}) <span className="font-normal text-text-muted">— matched {label(result.kind)}</span>
          </p>
          {result.variant && <p className="text-text-secondary">Variant {result.variant.name} · SKU {result.variant.sku}</p>}
          {result.batch && <p className="text-text-secondary">Batch {result.batch.batch_number} · {label(result.batch.status)}{result.batch.expires_on ? ` · expires ${result.batch.expires_on.slice(0, 10)}` : ""}</p>}
          {result.serial && <p className="text-text-secondary">Serial {result.serial.serial_number} · {result.serial.status === "sold" ? "Issued" : "Available"}</p>}
          <p className="text-text-secondary">
            On hand {quantity(result.stock.on_hand)} · Reserved {quantity(result.stock.reserved)} · Available {quantity(result.stock.available)}
          </p>
        </div>
      )}
    </InvPanel>
  );
}

const LINKS: Array<[string, string, string]> = [
  ["Items", "/inventory/items", "The item master"],
  ["Availability", "/inventory/availability", "On hand, reserved and available"],
  ["Receipts", "/inventory/receipts", "Bring stock in"],
  ["Issues", "/inventory/issues", "Take stock out"],
  ["Transfers", "/inventory/transfers", "Move between warehouses"],
  ["Adjustments", "/inventory/adjustments", "Correct a quantity"],
  ["Lots and batches", "/inventory/lots", "Batch register and expiry"],
  ["Reorder rules", "/inventory/reorder-rules", "Minimum, safety and maximum"],
];

export function InventoryHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "dashboard"), queryFn: () => readStock<{ dashboard: Record<string, string | number | null> }>("dashboard").then((r) => r.dashboard) });
  const d = query.data;
  if (query.isError && query.error instanceof InvApiError && query.error.status === 403) return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant stock.view." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inventory" description="Stock on hand across your warehouses, and what needs attention." />
      <MetricStrip
        metrics={[
          { label: "Stocked items", value: d ? String(d.stocked_items) : "…" },
          { label: "Units on hand", value: d ? quantity(d.total_quantity) : "…" },
          { label: "Units reserved", value: d ? quantity(d.reserved_quantity) : "…" },
          { label: "Warehouses in use", value: d ? String(d.warehouses) : "…" },
          { label: "Below reorder point", value: d ? String(d.low_stock_items) : "…" },
          ...(d && d.inventory_value !== null && d.inventory_value !== undefined ? [{ label: "Inventory value", value: amount(d.inventory_value) }] : []),
        ]}
      />
      <ScanLookup />
      <InvPanel title="Go to">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map(([title, href, description]) => (
            <li key={href}>
              <Link href={href} className="flex flex-col rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-hover">
                <span className="font-medium text-text">{title}</span>
                <span className="text-xs text-text-muted">{description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </InvPanel>
    </div>
  );
}

type Settings = { costing_method: string; allow_negative_stock: boolean; configured: boolean };

export function InventorySettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "settings"), queryFn: () => readStock<{ settings: Settings }>("settings").then((r) => r.settings) });
  const [method, setMethod] = useState<string | null>(null);
  const [negative, setNegative] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = query.data;
  const save = useMutation({
    mutationFn: () => act("settings", { costingMethod: method ?? current?.costing_method, allowNegativeStock: (negative ?? String(current?.allow_negative_stock)) === "true" }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") });
    },
  });
  const editable = can("stock.settings.manage");
  if (query.isError && query.error instanceof InvApiError && query.error.status === 403) return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant stock.view." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Costing and settings" description="How stock is valued and whether it may go negative, for the active company." />
      <InvPanel title="Costing method" description="Items can override the method on the item master.">
        {save.error && <InvAlert>{save.error instanceof InvApiError ? save.error.message : "Could not save."}</InvAlert>}
        {saved && <InvAlert tone="success">Settings saved.</InvAlert>}
        <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Costing method"
            isDisabled={!editable || !current}
            options={[{ value: "moving_average", label: "Moving average" }, { value: "fifo", label: "FIFO" }, { value: "standard", label: "Standard cost" }]}
            selectedKey={method ?? current?.costing_method ?? null}
            onSelectionChange={(key) => { setSaved(false); setMethod(String(key)); }}
          />
          <Select
            label="Allow negative stock"
            isDisabled={!editable || !current}
            options={[{ value: "false", label: "No — block issues beyond available stock" }, { value: "true", label: "Yes — allow stock to go negative" }]}
            selectedKey={negative ?? (current ? String(current.allow_negative_stock) : null)}
            onSelectionChange={(key) => { setSaved(false); setNegative(String(key)); }}
          />
        </div>
        {editable ? (
          <div>
            <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={!current}>
              Save settings
            </Button>
          </div>
        ) : (
          <p className="text-sm text-text-muted">You can view these settings but not change them.</p>
        )}
      </InvPanel>
    </div>
  );
}

const REPORTS: Array<[string, string, string]> = [
  ["Stock availability", "/inventory/availability", "On hand, reserved and available by item, warehouse, location and batch."],
  ["Stock ledger", "/inventory/ledger", "Every movement, filterable by type. The audit trail of stock."],
  ["Inventory valuation", "/inventory/valuation", "Stock value by item and warehouse, by costing method."],
  ["Stock aging", "/inventory/aging", "Age buckets, slow-moving and dead stock."],
  ["Stock movement", "/inventory/movement", "Received, issued and adjusted per item over a period, with cost variance."],
  ["Expiry", "/inventory/expiry", "Batches by how soon they expire."],
  ["Replenishment", "/inventory/replenishment", "Items at or below their reorder point."],
  ["Cycle counts", "/inventory/cycle-counts", "Count history and variances."],
  ["Landed cost", "/inventory/landed-cost", "Landed costs and how they were allocated to stock."],
];

// A hub: each report is a screen of its own, and every one exports what it shows as CSV.
export function InventoryReportsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inventory reports" description="Every report is a live view of the ledger, scoped to the active company. Use Export CSV on any of them." />
      <InvPanel>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {REPORTS.map(([title, href, description]) => (
            <li key={href}>
              <Link href={href} className="flex flex-col rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-hover">
                <span className="font-medium text-text">{title}</span>
                <span className="text-xs text-text-muted">{description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </InvPanel>
    </div>
  );
}
