"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { MfgApiError, readView, useMfgOptions } from "@/features/manufacturing/shared/client";
import { amount, calendarDate, dateTime, label, quantity, tone } from "@/features/manufacturing/shared/format";
import { MfgAlert, MfgPanel } from "@/features/manufacturing/shared/MfgUi";

type Dashboard = {
  orders: { planned: number; released: number; inProgress: number; onHold: number; late: number; completedLast30Days: number };
  ordersWithShortages: number; wipValue: string | null; shopFloor: { ready: number; running: number }; openDowntime: number; yieldLast30Days: number | null;
  lastMrp: { run_number: string; started_at: string; summary: { manufacture: number; purchase: number } } | null;
  attention: Array<{ id: string; work_order_number: string; status: string; item_code: string; due: string | null; hold_reason: string | null }>;
};

const LINKS: Array<[string, string, string]> = [
  ["Production orders", "/manufacturing/production-orders", "Create, release and follow orders"],
  ["Shop floor", "/manufacturing/shop-floor", "Job cards ready to work"],
  ["MRP", "/manufacturing/mrp", "What to make and what to buy"],
  ["Scheduling", "/manufacturing/scheduling", "Finite-capacity plan"],
  ["Bills of materials", "/manufacturing/boms", "Structures and versions"],
  ["Capacity", "/manufacturing/capacity", "Load against available minutes"],
  ["Downtime", "/manufacturing/downtime", "What stopped and why"],
  ["Reports", "/manufacturing/reports", "Cost, variance, yield, efficiency"],
];

export function ManufacturingHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "dashboard"), queryFn: () => readView<{ dashboard: Dashboard }>("dashboard").then((r) => r.dashboard) });
  const d = query.data;
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Manufacturing" description="Where production stands right now, and what needs attention." />
      <MetricStrip
        metrics={[
          { label: "Planned", value: d ? String(d.orders.planned) : "…" },
          { label: "Released", value: d ? String(d.orders.released) : "…" },
          { label: "In progress", value: d ? String(d.orders.inProgress) : "…" },
          { label: "On hold", value: d ? String(d.orders.onHold) : "…" },
          { label: "Late", value: d ? String(d.orders.late) : "…" },
          { label: "With shortages", value: d ? String(d.ordersWithShortages) : "…" },
          { label: "Job cards ready", value: d ? String(d.shopFloor.ready) : "…" },
          { label: "Running now", value: d ? String(d.shopFloor.running) : "…" },
          { label: "Open downtime", value: d ? String(d.openDowntime) : "…" },
          { label: "Yield (30 days)", value: d ? (d.yieldLast30Days === null ? "—" : `${d.yieldLast30Days}%`) : "…" },
          ...(d && d.wipValue !== null ? [{ label: "WIP value", value: amount(d.wipValue) }] : []),
        ]}
      />
      {d && d.attention.length > 0 && (
        <MfgPanel title="Needs attention" description="Orders on hold or past their due date.">
          <ul className="text-sm" aria-label="Needs attention">
            {d.attention.map((a) => (
              <li key={a.id}>
                <Link className="text-brand hover:underline" href={`/manufacturing/order/${a.id}`}>{a.work_order_number}</Link> · {a.item_code} · <StatusBadge tone={tone(a.status)}>{label(a.status)}</StatusBadge>
                {a.status === "on_hold" ? ` — ${a.hold_reason ?? ""}` : ` — due ${calendarDate(a.due)}`}
              </li>
            ))}
          </ul>
        </MfgPanel>
      )}
      {d?.lastMrp && <MfgAlert tone="info">Last MRP run {d.lastMrp.run_number} ({dateTime(d.lastMrp.started_at)}): {d.lastMrp.summary.manufacture} to make, {d.lastMrp.summary.purchase} to buy.</MfgAlert>}
      <MfgPanel title="Go to">
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
      </MfgPanel>
    </div>
  );
}

const REPORTS: Array<[string, string, string]> = [
  ["Production summary", "/manufacturing/production-summary", "Output by product and on-time delivery"],
  ["Production cost", "/manufacturing/production-cost", "Actual cost of each completed order"],
  ["Cost variance", "/manufacturing/variance", "Actual against standard, split by cause"],
  ["Standard cost", "/manufacturing/standard-cost", "What a product should cost"],
  ["Yield", "/manufacturing/yield", "Good against scrapped, by product"],
  ["Production efficiency", "/manufacturing/performance", "OEE per work center"],
  ["Downtime", "/manufacturing/downtime", "What stops the plant"],
  ["Work in progress", "/manufacturing/wip", "Cost accrued to open orders"],
  ["Scrap and rework", "/manufacturing/scrap-rework", "Losses with reasons"],
  ["Material consumption", "/manufacturing/consumption", "Issues, returns and scrap"],
  ["Finished output", "/manufacturing/finished-output", "Goods received from production"],
  ["Capacity", "/manufacturing/capacity", "Load against available minutes"],
];

export function ReportsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Manufacturing reports" description="Live views of what production recorded, scoped to the active company. Use Export CSV on any of them. Cost figures need the costing permission." />
      <MfgPanel>
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
      </MfgPanel>
    </div>
  );
}

type Standard = { bomCode: string; quantity: string; material: string; labor: string; overhead: string; total: string; perUnit: string; note: string; materialLines: Array<{ itemCode: string; itemName: string; quantityPerUnit: number; unitPrice: number; basis: string; cost: number }>; operationLines: Array<{ sequence: number; name: string; minutes: number; labor: number; overhead: number }> };

export function StandardCostScreen() {
  const options = useMfgOptions();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(1);
  const find = useMutation({ mutationFn: () => readView<{ standard: Standard }>("standard-cost", { itemId, quantity: String(qty) }).then((r) => r.standard) });
  const s = find.data;
  const denied = find.error instanceof MfgApiError && find.error.status === 403;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Standard cost" description="What a product should cost: components at their standard cost (or the stock's average) and routing time at the work center rates." />
      <MfgPanel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px]">
            <Select label="Product" options={(options.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} placeholder="Select product" />
          </div>
          <NumberField label="Quantity" value={qty} minValue={0} step={1} onChange={(n) => setQty(Number.isNaN(n) ? 0 : n)} />
          <Button variant="primary" onPress={() => find.mutate()} isLoading={find.isPending} isDisabled={!itemId || qty <= 0}>Calculate</Button>
        </div>
        {find.error && <MfgAlert>{denied ? "You need the manufacturing costing permission to see standard cost." : find.error instanceof MfgApiError ? find.error.message : "Could not calculate."}</MfgAlert>}
      </MfgPanel>
      {s && (
        <>
          <MetricStrip metrics={[{ label: "Material", value: amount(s.material) }, { label: "Labour", value: amount(s.labor) }, { label: "Overhead", value: amount(s.overhead) }, { label: "Total", value: amount(s.total) }, { label: "Per unit", value: amount(s.perUnit) }]} />
          <MfgPanel title={`Materials (BOM ${s.bomCode})`}>
            <ul className="text-sm" aria-label="Standard materials">
              {s.materialLines.map((l) => <li key={l.itemCode}>{l.itemName} ({l.itemCode}) — {quantity(l.quantityPerUnit)} per unit × {amount(l.unitPrice)} ({l.basis}) = {amount(l.cost)}</li>)}
            </ul>
          </MfgPanel>
          <MfgPanel title="Operations">
            {s.operationLines.length === 0 ? <p className="text-sm text-text-muted">No default routing, so no labour or machine cost.</p> : (
              <ul className="text-sm" aria-label="Standard operations">
                {s.operationLines.map((l) => <li key={l.sequence}>{l.sequence} · {l.name} — {quantity(l.minutes)} min · labour {amount(l.labor)} · overhead {amount(l.overhead)}</li>)}
              </ul>
            )}
          </MfgPanel>
          <p className="text-xs text-text-muted">{s.note}</p>
        </>
      )}
    </div>
  );
}
