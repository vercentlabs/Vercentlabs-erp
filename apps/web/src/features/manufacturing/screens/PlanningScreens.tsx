"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, MfgApiError, readView, useMfgOptions } from "@/features/manufacturing/shared/client";
import { calendarDate, label, quantity } from "@/features/manufacturing/shared/format";
import { MfgAlert, MfgPanel, useCan } from "@/features/manufacturing/shared/MfgUi";

const errorText = (error: unknown) => (error instanceof MfgApiError ? error.message : "That could not be completed.");

type Requirement = { id: string; item_code: string; item_name: string; level: number; required_date: string; gross: string; usable_stock: string; incoming: string; supply: string; net: string; safety_shortfall: string; recommended_action: string; converted_order_id: string | null; converted_order_number: string | null; pegging: Array<{ type: string; quantity: number; date: string }> };
type Run = { id: string; run_number: string; horizon_start: string; horizon_end: string; summary: { items: number; manufacture: number; purchase: number; none: number }; note: string | null; requirements: Requirement[] };
const ACTION_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = { manufacture: "info", purchase: "warning", none: "neutral" };

export function MrpRunScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "mrp-run", id), queryFn: () => readView<{ run: Run }>("mrp-run", { id }).then((r) => r.run) });
  const [notice, setNotice] = useState<string | null>(null);
  const convert = useMutation({
    mutationFn: () => act<{ record: { created: Array<{ orderNumber: string }> } }>("mrp-convert", { id }),
    onSuccess: (r) => { setNotice(`Created ${r.record.created.length} production order(s): ${r.record.created.map((o) => o.orderNumber).join(", ")}.`); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); },
  });
  const run = query.data;
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  if (!run) return <p className="px-4 py-8 text-sm text-text-secondary">{query.isError ? "This run could not be loaded." : "Loading…"}</p>;
  const open = run.requirements.filter((r) => r.recommended_action === "manufacture" && Number(r.net) > 0 && !r.converted_order_id).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={run.run_number}
        description={`Horizon ${calendarDate(run.horizon_start)} to ${calendarDate(run.horizon_end)}${run.note ? ` · ${run.note}` : ""}`}
        secondaryActions={<Link href="/manufacturing/mrp" className="text-sm text-brand hover:underline">Back to MRP runs</Link>}
      />
      {notice && <MfgAlert tone="success">{notice}</MfgAlert>}
      {convert.error && <MfgAlert>{errorText(convert.error)}</MfgAlert>}
      <MetricStrip metrics={[{ label: "Items planned", value: String(run.summary.items) }, { label: "To make", value: String(run.summary.manufacture) }, { label: "To buy", value: String(run.summary.purchase) }, { label: "Covered", value: String(run.summary.none) }]} />
      <MfgPanel
        title="Requirements"
        description="Gross demand less usable stock and supply on the way. Manufactured items are exploded into dependent demand on their components; components are planned after everything that uses them. Purchases are raised in Procurement."
        actions={can("manufacturing.work_order.manage") && <Button variant="primary" isDisabled={open === 0} isLoading={convert.isPending} onPress={() => convert.mutate()}>Create production orders ({open})</Button>}
      >
        <div className="overflow-x-auto">
          <Table className="w-full text-left text-sm" aria-label="Requirements">
            <TableHead>
              <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                <TableHeaderCell className="px-2 py-2">Item</TableHeaderCell><TableHeaderCell className="px-2 py-2">Level</TableHeaderCell><TableHeaderCell className="px-2 py-2">Needed by</TableHeaderCell><TableHeaderCell className="px-2 py-2">Gross</TableHeaderCell><TableHeaderCell className="px-2 py-2">Usable stock</TableHeaderCell><TableHeaderCell className="px-2 py-2">On order</TableHeaderCell><TableHeaderCell className="px-2 py-2">Net</TableHeaderCell><TableHeaderCell className="px-2 py-2">Action</TableHeaderCell><TableHeaderCell className="px-2 py-2">Driven by</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {run.requirements.map((r) => (
                <TableRow key={r.id} className="border-b border-border/60 align-top">
                  <TableCell className="px-2 py-2 font-medium text-text">{r.item_name} ({r.item_code})</TableCell>
                  <TableCell className="px-2 py-2">{r.level}</TableCell>
                  <TableCell className="px-2 py-2">{calendarDate(r.required_date)}</TableCell>
                  <TableCell className="px-2 py-2">{quantity(r.gross)}</TableCell>
                  <TableCell className="px-2 py-2">{quantity(r.usable_stock)}</TableCell>
                  <TableCell className="px-2 py-2">{quantity(r.incoming)}</TableCell>
                  <TableCell className="px-2 py-2 font-medium">{quantity(r.net)}{Number(r.safety_shortfall) > 0 ? ` (${quantity(r.safety_shortfall)} safety)` : ""}</TableCell>
                  <TableCell className="px-2 py-2">
                    <StatusBadge tone={ACTION_TONE[r.recommended_action] ?? "neutral"}>{label(r.recommended_action)}</StatusBadge>
                    {r.converted_order_number && <span className="ml-2 text-xs text-text-muted">→ {r.converted_order_number}</span>}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-xs text-text-secondary">{r.pegging.length ? [...new Set(r.pegging.map((p) => label(p.type)))].join(", ") : "Safety stock"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </MfgPanel>
    </div>
  );
}

type Availability = { bomCode: string; quantity: string; canMakeNow: boolean; makeableFromStock: number | null; lines: Array<{ itemId: string; itemCode: string; itemName: string; requiredQuantity: string; onHand: string; freeQuantity: string; incomingQuantity: string; shortageNow: string; shortageAfterIncoming: string; status: string }> };

export function MaterialPlanningScreen() {
  const options = useMfgOptions();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const check = useMutation({ mutationFn: () => readView<{ availability: Availability }>("material-availability", { itemId, quantity: String(qty) }).then((r) => r.availability) });
  const a = check.data;
  const tone = (s: string) => (s === "available" ? "success" : s === "on_order" ? "warning" : "danger") as "success" | "warning" | "danger";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Material planning" description="Can this be made? Every bought material at every level of the BOM against free stock and what is on order." />
      <MfgPanel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px]">
            <Select label="Product" options={(options.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} placeholder="Select product" />
          </div>
          <NumberField label="Quantity" value={qty} minValue={0} step={1} onChange={(n) => setQty(Number.isNaN(n) ? 0 : n)} />
          <Button variant="primary" onPress={() => check.mutate()} isLoading={check.isPending} isDisabled={!itemId || qty <= 0}>Check availability</Button>
        </div>
        {check.error && <MfgAlert>{errorText(check.error)}</MfgAlert>}
      </MfgPanel>
      {a && (
        <>
          <MfgAlert tone={a.canMakeNow ? "success" : "warning"}>
            {a.canMakeNow ? `All materials are free: ${quantity(a.quantity)} can be made now.` : `Not everything is free for ${quantity(a.quantity)}.`} From stock alone, {a.makeableFromStock ?? 0} could be made (BOM {a.bomCode}).
          </MfgAlert>
          <MfgPanel title="Materials">
            <div className="overflow-x-auto">
              <Table className="w-full text-left text-sm" aria-label="Material availability">
                <TableHead>
                  <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                    <TableHeaderCell className="px-2 py-2">Material</TableHeaderCell><TableHeaderCell className="px-2 py-2">Required</TableHeaderCell><TableHeaderCell className="px-2 py-2">On hand</TableHeaderCell><TableHeaderCell className="px-2 py-2">Free</TableHeaderCell><TableHeaderCell className="px-2 py-2">On order</TableHeaderCell><TableHeaderCell className="px-2 py-2">Short now</TableHeaderCell><TableHeaderCell className="px-2 py-2">Short after orders</TableHeaderCell><TableHeaderCell className="px-2 py-2">Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {a.lines.map((l) => (
                    <TableRow key={l.itemId} className="border-b border-border/60">
                      <TableCell className="px-2 py-2 font-medium text-text">{l.itemName} ({l.itemCode})</TableCell>
                      <TableCell className="px-2 py-2">{quantity(l.requiredQuantity)}</TableCell>
                      <TableCell className="px-2 py-2">{quantity(l.onHand)}</TableCell>
                      <TableCell className="px-2 py-2">{quantity(l.freeQuantity)}</TableCell>
                      <TableCell className="px-2 py-2">{quantity(l.incomingQuantity)}</TableCell>
                      <TableCell className="px-2 py-2">{quantity(l.shortageNow)}</TableCell>
                      <TableCell className="px-2 py-2">{quantity(l.shortageAfterIncoming)}</TableCell>
                      <TableCell className="px-2 py-2"><StatusBadge tone={tone(l.status)}>{label(l.status)}</StatusBadge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </MfgPanel>
        </>
      )}
    </div>
  );
}

type Schedule = { from: string; applied: boolean; lateOrders: number; blockedOrders: number; orders: Array<{ orderId: string; orderNumber: string; itemCode: string; priority: string; start: string; end: string; dueDate: string | null; late: boolean; blocked: string | null; operations: Array<{ sequence: number; name: string; start: string; end: string }> }> };

export function SchedulingScreen() {
  const can = useCan();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [result, setResult] = useState<Schedule | null>(null);
  const run = useMutation({
    mutationFn: (apply: boolean) => act<{ record: Schedule }>("schedule-run", { from: from || undefined, apply }).then((r) => r.record),
    onSuccess: (r) => { setResult(r); if (r.applied) queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); },
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Scheduling" description="Finite-capacity, forward scheduling of planned and released orders: most urgent first, operations in sequence, each poured into its work center's remaining daily minutes. Preview first; applying writes the dates onto the orders and keeps the original date as the due date." />
      <MfgPanel>
        <div className="flex flex-wrap items-end gap-3">
          <TextField label="Schedule from" type="date" value={from} onChange={setFrom} />
          <Button variant="secondary" onPress={() => run.mutate(false)} isLoading={run.isPending} isDisabled={!can("manufacturing.planning.run")}>Preview schedule</Button>
          <Button variant="primary" onPress={() => run.mutate(true)} isLoading={run.isPending} isDisabled={!can("manufacturing.planning.run")}>Apply schedule</Button>
        </div>
        {run.error && <MfgAlert>{errorText(run.error)}</MfgAlert>}
      </MfgPanel>
      {result && (
        <>
          <MfgAlert tone={result.applied ? "success" : "info"}>{result.applied ? "Schedule applied." : "Preview only — nothing has been saved."} {result.orders.length} order(s), {result.lateOrders} late, {result.blockedOrders} could not be scheduled.</MfgAlert>
          <MfgPanel title="Schedule">
            <div className="overflow-x-auto">
              <Table className="w-full text-left text-sm" aria-label="Schedule">
                <TableHead>
                  <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                    <TableHeaderCell className="px-2 py-2">Order</TableHeaderCell><TableHeaderCell className="px-2 py-2">Priority</TableHeaderCell><TableHeaderCell className="px-2 py-2">Start</TableHeaderCell><TableHeaderCell className="px-2 py-2">Finish</TableHeaderCell><TableHeaderCell className="px-2 py-2">Due</TableHeaderCell><TableHeaderCell className="px-2 py-2">Operations</TableHeaderCell><TableHeaderCell className="px-2 py-2">Result</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.orders.map((o) => (
                    <TableRow key={o.orderId} className="border-b border-border/60 align-top">
                      <TableCell className="px-2 py-2 font-medium text-text"><Link className="text-brand hover:underline" href={`/manufacturing/order/${o.orderId}`}>{o.orderNumber}</Link> · {o.itemCode}</TableCell>
                      <TableCell className="px-2 py-2">{label(o.priority)}</TableCell>
                      <TableCell className="px-2 py-2">{o.blocked ? "—" : calendarDate(o.start)}</TableCell>
                      <TableCell className="px-2 py-2">{o.blocked ? "—" : calendarDate(o.end)}</TableCell>
                      <TableCell className="px-2 py-2">{calendarDate(o.dueDate)}</TableCell>
                      <TableCell className="px-2 py-2 text-xs">{o.operations.map((op) => `${op.sequence} ${op.name}: ${calendarDate(op.start)}${op.end !== op.start ? ` → ${calendarDate(op.end)}` : ""}`).join(" · ")}</TableCell>
                      <TableCell className="px-2 py-2">{o.blocked ? <StatusBadge tone="danger">Blocked</StatusBadge> : o.late ? <StatusBadge tone="warning">Late</StatusBadge> : <StatusBadge tone="success">On time</StatusBadge>}{o.blocked && <div className="text-xs text-text-muted">{o.blocked}</div>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </MfgPanel>
        </>
      )}
    </div>
  );
}
