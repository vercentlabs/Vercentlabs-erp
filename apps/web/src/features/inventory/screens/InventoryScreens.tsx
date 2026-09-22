"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton, MetricStrip, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, createMaster, InvApiError, readStock, useInvOptions } from "@/features/inventory/shared/client";
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

type AttributeDraft = { key: number; name: string; valuesText: string };
let attrKey = 0;
const nextAttrKey = () => ++attrKey;

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((combos, list) => combos.flatMap((combo) => list.map((value) => [...combo, value])), [[]]);
}
const skuSlug = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// F033: top ERPs (SAP's variant configuration, NetSuite's matrix items, Dynamics'
// product dimensions, Odoo's attribute lines) all generate the full variant
// matrix from a set of attributes instead of hand-creating every SKU -- this
// is that generator for our item_variants table (which already had an
// `attributes` jsonb column with nothing writing to it).
export function GenerateVariantsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useInvOptions();
  const [itemId, setItemId] = useState("");
  const [attributes, setAttributes] = useState<AttributeDraft[]>([{ key: nextAttrKey(), name: "", valuesText: "" }]);
  const [result, setResult] = useState<{ created: number; skipped: Array<{ sku: string; message: string }> } | null>(null);

  const item = options.data?.items.find((candidate) => candidate.id === itemId);
  const parsedAttributes = attributes
    .map((a) => ({ name: a.name.trim(), values: Array.from(new Set(a.valuesText.split(",").map((v) => v.trim()).filter(Boolean))) }))
    .filter((a) => a.name && a.values.length);
  const combinations = parsedAttributes.length ? cartesian(parsedAttributes.map((a) => a.values)) : [];

  const generate = useMutation({
    mutationFn: async () => {
      if (!item) throw new InvApiError("Choose an item first.", 400);
      let created = 0;
      const skipped: Array<{ sku: string; message: string }> = [];
      for (const combo of combinations) {
        const attributeMap = Object.fromEntries(parsedAttributes.map((a, i) => [a.name, combo[i]]));
        const sku = `${item.code}-${combo.map(skuSlug).join("-")}`;
        const name = `${item.name} - ${combo.join(" / ")}`;
        try {
          await createMaster("item-variants", { itemId, sku, name, attributes: JSON.stringify(attributeMap), status: "active" });
          created += 1;
        } catch (err) {
          skipped.push({ sku, message: err instanceof InvApiError ? err.message : "Could not create this variant." });
        }
      }
      return { created, skipped };
    },
    onSuccess: (summary) => {
      setResult(summary);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") });
    },
  });

  if (!can("items.manage")) return null;

  return (
    <InvPanel title="Generate variants" description="Define attributes (e.g. Size, Color) and every combination is created as its own SKU at once, instead of one at a time.">
      <div className="flex flex-col gap-3">
        <Select label="Item" options={(options.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(key) => setItemId(String(key ?? ""))} placeholder="Select an item" className="max-w-md" />
        {attributes.map((attr, index) => (
          <div key={attr.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <TextField aria-label={`Attribute ${index + 1} name`} label={index === 0 ? "Attribute" : undefined} placeholder="e.g. Size" value={attr.name} onChange={(value) => setAttributes((current) => current.map((a) => (a.key === attr.key ? { ...a, name: value } : a)))} />
            <TextField aria-label={`Attribute ${index + 1} values`} label={index === 0 ? "Values (comma-separated)" : undefined} placeholder="e.g. S, M, L" value={attr.valuesText} onChange={(value) => setAttributes((current) => current.map((a) => (a.key === attr.key ? { ...a, valuesText: value } : a)))} />
            <IconButton aria-label={`Remove attribute ${index + 1}`} variant="ghost" isDisabled={attributes.length === 1} onPress={() => setAttributes((current) => current.filter((a) => a.key !== attr.key))}>
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ))}
        <Button variant="secondary" size="compact" className="self-start" onPress={() => setAttributes((current) => [...current, { key: nextAttrKey(), name: "", valuesText: "" }])}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add attribute
        </Button>

        {combinations.length > 0 && (
          <p className="text-sm text-text-secondary">
            {combinations.length} combination{combinations.length === 1 ? "" : "s"} will be created{item ? `, e.g. ${item.code}-${combinations[0].map(skuSlug).join("-")}` : ""}.
          </p>
        )}
        {generate.error && <InvAlert>{generate.error instanceof InvApiError ? generate.error.message : "Could not generate variants."}</InvAlert>}
        {result && (
          <InvAlert tone={result.skipped.length ? "warning" : "success"}>
            Created {result.created} variant{result.created === 1 ? "" : "s"}.
            {result.skipped.length > 0 && ` ${result.skipped.length} skipped: ${result.skipped.map((s) => `${s.sku} (${s.message})`).join("; ")}`}
          </InvAlert>
        )}
        <Button
          variant="primary"
          className="self-start"
          onPress={() => { setResult(null); generate.mutate(); }}
          isLoading={generate.isPending}
          isDisabled={!item || combinations.length === 0}
        >
          Generate {combinations.length || ""} variant{combinations.length === 1 ? "" : "s"}
        </Button>
      </div>
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
