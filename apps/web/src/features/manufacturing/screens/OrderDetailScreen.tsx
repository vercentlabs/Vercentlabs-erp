"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, MfgApiError, readView, useMfgOptions } from "@/features/manufacturing/shared/client";
import { amount, calendarDate, dateTime, label, quantity, tone } from "@/features/manufacturing/shared/format";
import { MfgAlert, MfgPanel, useCan } from "@/features/manufacturing/shared/MfgUi";

type Material = { id: string; item_id: string; item_code: string; item_name: string; warehouse_name: string; issue_method: string; required_quantity: string; issued_quantity: string; returned_quantity: string; reserved_quantity: string; available_quantity: string; issued_cost: string | null };
type Operation = { id: string; sequence: number; name: string; status: string; planned_minutes: string; actual_minutes: string | null; work_center_name: string | null; inspection_required: boolean };
type Order = {
  id: string; work_order_number: string; status: string; priority: string; source_type: string; source_label: string | null; rework_of_id: string | null; quantity_planned: string; quantity_completed: string; quantity_scrapped: string;
  planned_start_at: string | null; planned_end_at: string | null; item_code: string; item_name: string; tracking_type: string; bom_code: string | null; bom_version: number | null; close_reason: string | null; cancel_reason: string | null; notes: string | null;
  materials: Material[]; operations: Operation[]; postings: Array<{ posting_type: string; quantity: string; unit_cost: string | null; posted_at: string; item_code: string }>;
  scrap: Array<{ id: string; category: string; scope: string; quantity: string; reason_code: string; note: string | null; item_code: string }>; outputs: Array<{ output_type: string; quantity: string; item_code: string; item_name: string }>;
  rework: Array<{ id: string; work_order_number: string; status: string; quantity_planned: string }>; costs: { material: string; labor: string; overhead: string; scrap: string; absorbed: string; wip: string } | null;
};

const errorText = (error: unknown) => (error instanceof MfgApiError ? error.message : "That could not be completed.");
const REASONS = ["defect", "damage", "setup", "operator_error", "material_fault", "machine_fault", "expired", "other"].map((value) => ({ value, label: label(value) }));

export function OrderDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useMfgOptions();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order", id), queryFn: () => readView<{ order: Order }>("order", { id }).then((r) => r.order) });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shortage, setShortage] = useState(false);
  const [issueQty, setIssueQty] = useState<Record<string, number>>({});
  const [reportQty, setReportQty] = useState(1);
  const [batchNumber, setBatchNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [serials, setSerials] = useState("");
  const [dialog, setDialog] = useState<{ kind: "close" | "cancel" | "return" | "complete" | "skip" | "rework"; id?: string; title: string } | null>(null);
  const [scrapScope, setScrapScope] = useState("product");
  const [scrapItem, setScrapItem] = useState("");
  const [scrapQty, setScrapQty] = useState(1);
  const [scrapCategory, setScrapCategory] = useState("scrap");
  const [scrapReason, setScrapReason] = useState("defect");
  const [scrapNote, setScrapNote] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });

  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown>; success: string }) => act(action, body),
    onSuccess: (_r, v) => {
      setNotice(v.success);
      setError(null);
      setShortage(false);
      setDialog(null);
      if (v.action === "material-issue") setIssueQty({});
      refresh();
    },
    onError: (e) => {
      setError(errorText(e));
      setNotice(null);
      if (e instanceof MfgApiError && e.code === "MFG_MATERIAL_SHORTAGE") setShortage(true);
    },
  });
  void options;

  const order = query.data;
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  if (!order) return <p className="px-4 py-8 text-sm text-text-secondary">{query.isError ? "This production order could not be loaded." : "Loading…"}</p>;

  const active = order.status === "released" || order.status === "in_progress";
  const canPost = can("manufacturing.production.post");
  const canManage = can("manufacturing.work_order.manage");
  const canRelease = can("manufacturing.work_order.release");
  const canScrap = can("manufacturing.scrap.post");
  const issueLines = Object.entries(issueQty).filter(([, n]) => n > 0).map(([materialId, q]) => ({ materialId, quantity: q }));
  const remainingOf = (m: Material) => Math.max(Number(m.required_quantity) - (Number(m.issued_quantity) - Number(m.returned_quantity)), 0);
  const reportable = Math.max(Number(order.quantity_planned) - Number(order.quantity_completed), 0);
  const serialCount = serials.split(/[\s,;]+/).filter(Boolean).length;
  const post = (action: string, body: Record<string, unknown>, success: string) => run.mutate({ action, body: { ...body, idempotencyKey: `${action}-${crypto.randomUUID()}` }, success });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={order.work_order_number}
        description={`${order.item_name} (${order.item_code}) · BOM ${order.bom_code ?? "—"} v${order.bom_version ?? "—"} · ${order.rework_of_id ? "rework" : order.source_type === "make_to_order" ? `for sales order ${order.source_label ?? ""}` : "make to stock"}`}
        secondaryActions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone(order.status)}>{label(order.status)}</StatusBadge>
            {order.status === "planned" && canRelease && <Button variant="primary" onPress={() => run.mutate({ action: "order-release", body: { id: order.id }, success: "Order released; components reserved." })} isLoading={run.isPending}>Release</Button>}
            {order.status === "planned" && canRelease && shortage && <Button variant="secondary" onPress={() => run.mutate({ action: "order-release", body: { id: order.id, allowShortage: true }, success: "Order released with the shortage accepted." })}>Release anyway</Button>}
            {active && canManage && <Button variant="secondary" onPress={() => setDialog({ kind: "close", title: "Close short" })}>Close short</Button>}
            {["planned", "released", "on_hold"].includes(order.status) && canManage && <Button variant="ghost" onPress={() => setDialog({ kind: "cancel", title: "Cancel order" })}>Cancel order</Button>}
            <Link href="/manufacturing/production-orders" className="text-sm text-brand hover:underline">Back to orders</Link>
          </div>
        }
      />
      {notice && <MfgAlert tone="success">{notice}</MfgAlert>}
      {error && <MfgAlert>{error}</MfgAlert>}
      {order.close_reason && <MfgAlert tone="info">Closed short: {order.close_reason}</MfgAlert>}
      {order.cancel_reason && <MfgAlert tone="warning">Cancelled: {order.cancel_reason}</MfgAlert>}
      <MetricStrip
        metrics={[
          { label: "Planned", value: quantity(order.quantity_planned) },
          { label: "Completed", value: quantity(order.quantity_completed) },
          { label: "Scrapped", value: quantity(order.quantity_scrapped) },
          { label: "Planned start", value: calendarDate(order.planned_start_at) },
          ...(order.costs ? [{ label: "WIP value", value: amount(order.costs.wip) }, { label: "Absorbed", value: amount(order.costs.absorbed) }] : []),
        ]}
      />

      <MfgPanel
        title="Materials"
        description="What the BOM requires for this quantity. Reserved is held for this order; issue moves stock into work in progress. Backflush materials are issued automatically when production is reported."
        actions={active && canPost && <Button variant="primary" isDisabled={!issueLines.length} isLoading={run.isPending} onPress={() => post("material-issue", { orderId: order.id, lines: issueLines }, "Material issued.")}>Issue selected</Button>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Materials">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-text-muted">
                <th className="px-2 py-2">Component</th><th className="px-2 py-2">Method</th><th className="px-2 py-2">Required</th><th className="px-2 py-2">Issued</th><th className="px-2 py-2">Returned</th><th className="px-2 py-2">Reserved</th><th className="px-2 py-2">Free</th>{order.costs && <th className="px-2 py-2">Cost</th>}{active && canPost && <th className="px-2 py-2">Issue now</th>}<th />
              </tr>
            </thead>
            <tbody>
              {order.materials.map((m) => (
                <tr key={m.id} className="border-b border-border/60 align-top">
                  <td className="px-2 py-2 font-medium text-text">{m.item_name} ({m.item_code})</td>
                  <td className="px-2 py-2">{label(m.issue_method)}</td>
                  <td className="px-2 py-2">{quantity(m.required_quantity)}</td>
                  <td className="px-2 py-2">{quantity(m.issued_quantity)}</td>
                  <td className="px-2 py-2">{quantity(m.returned_quantity)}</td>
                  <td className="px-2 py-2">{quantity(m.reserved_quantity)}</td>
                  <td className="px-2 py-2">{quantity(m.available_quantity)}</td>
                  {order.costs && <td className="px-2 py-2">{amount(m.issued_cost)}</td>}
                  {active && canPost && (
                    <td className="px-2 py-2">
                      <NumberField aria-label={`Issue ${m.item_code}`} value={issueQty[m.id] ?? 0} minValue={0} maxValue={remainingOf(m)} step={0.001} onChange={(n) => setIssueQty((c) => ({ ...c, [m.id]: Number.isNaN(n) ? 0 : n }))} />
                    </td>
                  )}
                  <td className="px-2 py-2">{(active || order.status === "on_hold") && canPost && Number(m.issued_quantity) - Number(m.returned_quantity) > 0 && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "return", id: m.id, title: `Return ${m.item_code}` })}>Return</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MfgPanel>

      {order.operations.length > 0 && (
        <MfgPanel title="Operations" description="Work runs in sequence: an operation opens when the one before it is done.">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Operations">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-muted">
                  <th className="px-2 py-2">Seq</th><th className="px-2 py-2">Operation</th><th className="px-2 py-2">Work center</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Planned min</th><th className="px-2 py-2">Actual min</th><th />
                </tr>
              </thead>
              <tbody>
                {order.operations.map((o) => (
                  <tr key={o.id} className="border-b border-border/60">
                    <td className="px-2 py-2">{o.sequence}</td>
                    <td className="px-2 py-2 font-medium text-text">{o.name}{o.inspection_required ? " · inspection" : ""}</td>
                    <td className="px-2 py-2">{o.work_center_name ?? "—"}</td>
                    <td className="px-2 py-2"><StatusBadge tone={tone(o.status)}>{label(o.status)}</StatusBadge></td>
                    <td className="px-2 py-2">{quantity(o.planned_minutes)}</td>
                    <td className="px-2 py-2">{quantity(o.actual_minutes)}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        {o.status === "ready" && active && canPost && <Button variant="ghost" size="compact" onPress={() => run.mutate({ action: "operation-start", body: { id: o.id }, success: "Operation started." })}>Start</Button>}
                        {o.status === "in_progress" && canPost && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "complete", id: o.id, title: `Complete operation ${o.sequence}` })}>Complete</Button>}
                        {["pending", "ready"].includes(o.status) && active && canManage && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "skip", id: o.id, title: `Skip operation ${o.sequence}` })}>Skip</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MfgPanel>
      )}

      {active && canPost && (
        <MfgPanel title="Report production" description="Receive finished goods into stock at the cost absorbed from work in progress. Operations must be complete and manual materials issued; backflush materials are consumed automatically.">
          <div className="flex flex-wrap items-end gap-3">
            <NumberField label="Quantity produced" value={reportQty} minValue={0} maxValue={reportable || undefined} step={order.tracking_type === "serial" ? 1 : 0.001} onChange={(n) => setReportQty(Number.isNaN(n) ? 0 : n)} />
            {order.tracking_type === "batch" && <TextField label="Batch number" value={batchNumber} onChange={setBatchNumber} />}
            {order.tracking_type === "batch" && <TextField label="Expires on" type="date" value={expiresOn} onChange={setExpiresOn} />}
            {order.tracking_type === "serial" && <div className="min-w-[280px]"><TextArea label={`Serial numbers (${serialCount} entered)`} value={serials} onChange={setSerials} /></div>}
            <Button variant="primary" isLoading={run.isPending} isDisabled={reportQty <= 0} onPress={() => post("production-report", { orderId: order.id, quantity: reportQty, batchNumber: batchNumber || undefined, expiresOn: expiresOn || undefined, serialNumbers: order.tracking_type === "serial" ? serials : undefined }, "Production reported; finished goods received.")}>Report production</Button>
          </div>
        </MfgPanel>
      )}

      {(active || order.status === "on_hold") && canScrap && (
        <MfgPanel title="Scrap and waste" description="Record finished units lost, or extra component consumed. Waste of a component is issued from stock and added to the order's cost.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="What was lost" options={[{ value: "product", label: "Finished units" }, { value: "component", label: "A component" }]} selectedKey={scrapScope} onSelectionChange={(k) => setScrapScope(String(k ?? "product"))} />
            {scrapScope === "component" && <Select label="Component" options={order.materials.map((m) => ({ value: m.item_id, label: `${m.item_name} (${m.item_code})` }))} selectedKey={scrapItem || null} onSelectionChange={(k) => setScrapItem(String(k ?? ""))} placeholder="Select component" />}
            <NumberField label="Quantity lost" value={scrapQty} minValue={0} step={0.001} onChange={(n) => setScrapQty(Number.isNaN(n) ? 0 : n)} />
            <Select label="Kind" options={[{ value: "scrap", label: "Scrap" }, { value: "waste", label: "Waste" }]} selectedKey={scrapCategory} onSelectionChange={(k) => setScrapCategory(String(k ?? "scrap"))} />
            <Select label="Reason" options={REASONS} selectedKey={scrapReason} onSelectionChange={(k) => setScrapReason(String(k ?? "defect"))} />
            <TextField label="Note" value={scrapNote} onChange={setScrapNote} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" isLoading={run.isPending} isDisabled={scrapQty <= 0 || (scrapScope === "component" && !scrapItem)} onPress={() => run.mutate({ action: "scrap-record", body: { orderId: order.id, scope: scrapScope, itemId: scrapScope === "component" ? scrapItem : undefined, quantity: scrapQty, category: scrapCategory, reasonCode: scrapReason, note: scrapNote || undefined }, success: "Scrap recorded." })}>Record</Button>
            {canManage && Number(order.quantity_scrapped) > 0 && <Button variant="ghost" onPress={() => setDialog({ kind: "rework", title: "Send to rework" })}>Send scrapped units to rework</Button>}
          </div>
        </MfgPanel>
      )}

      {order.outputs.length > 0 && (
        <MfgPanel title="By-products planned">
          <ul className="text-sm" aria-label="By-products planned">
            {order.outputs.map((o) => <li key={o.item_code}>{o.item_name} ({o.item_code}) — {quantity(o.quantity)} per unit · {label(o.output_type)}</li>)}
          </ul>
        </MfgPanel>
      )}
      {order.rework.length > 0 && (
        <MfgPanel title="Rework orders">
          <ul className="text-sm" aria-label="Rework orders">
            {order.rework.map((r) => <li key={r.id}><Link className="text-brand hover:underline" href={`/manufacturing/order/${r.id}`}>{r.work_order_number}</Link> · {quantity(r.quantity_planned)} · {label(r.status)}</li>)}
          </ul>
        </MfgPanel>
      )}
      <MfgPanel title="Activity">
        {order.postings.length === 0 && order.scrap.length === 0 ? <p className="text-sm text-text-muted">Nothing has been posted yet.</p> : (
          <ul className="text-sm" aria-label="Activity">
            {order.postings.map((p, i) => <li key={i}>{dateTime(p.posted_at)} · {label(p.posting_type)} · {p.item_code} × {quantity(p.quantity)}{p.unit_cost !== null ? ` @ ${amount(p.unit_cost)}` : ""}</li>)}
            {order.scrap.map((s) => <li key={s.id}>{label(s.category)} · {s.item_code} × {quantity(s.quantity)} · {label(s.reason_code)}{s.note ? ` — ${s.note}` : ""}</li>)}
          </ul>
        )}
      </MfgPanel>

      {dialog?.kind === "close" && <ReasonDialog title={dialog.title} error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(reason) => run.mutate({ action: "order-close", body: { id: order.id, reason }, success: "Order closed short." })} />}
      {dialog?.kind === "cancel" && <ReasonDialog title={dialog.title} error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(reason) => run.mutate({ action: "order-cancel", body: { id: order.id, reason }, success: "Order cancelled." })} />}
      {dialog?.kind === "skip" && <ReasonDialog title={dialog.title} error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(reason) => run.mutate({ action: "operation-skip", body: { id: dialog.id, reason }, success: "Operation skipped." })} />}
      {dialog?.kind === "complete" && <MinutesDialog title={dialog.title} error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(minutes) => run.mutate({ action: "operation-complete", body: { id: dialog.id, actualMinutes: minutes }, success: "Operation completed." })} />}
      {dialog?.kind === "return" && <ReturnDialog title={dialog.title} error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(q, reason) => post("material-return", { orderId: order.id, lines: [{ materialId: dialog.id, quantity: q, reason }] }, "Material returned to stock.")} />}
      {dialog?.kind === "rework" && <ReworkDialog max={Number(order.quantity_scrapped)} error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(q, reason) => run.mutate({ action: "rework-create", body: { orderId: order.id, quantity: q, reason }, success: "Rework order created." })} />}
    </div>
  );
}

function Shell({ title, onClose, error, children }: { title: string; onClose: () => void; error: string | null; children: React.ReactNode }) {
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {error && <MfgAlert>{error}</MfgAlert>}
        {children}
      </div>
    </Dialog>
  );
}
function Buttons({ onClose, confirm, onConfirm, isPending, disabled }: { onClose: () => void; confirm: string; onConfirm: () => void; isPending: boolean; disabled: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onClose}>Close</Button>
      <Button variant="primary" onPress={onConfirm} isLoading={isPending} isDisabled={disabled}>{confirm}</Button>
    </div>
  );
}
function ReasonDialog({ title, onClose, onConfirm, isPending, error }: { title: string; onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  return (
    <Shell title={title} onClose={onClose} error={error}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
      <Buttons onClose={onClose} confirm={title} onConfirm={() => onConfirm(reason.trim())} isPending={isPending} disabled={!reason.trim()} />
    </Shell>
  );
}
function MinutesDialog({ title, onClose, onConfirm, isPending, error }: { title: string; onClose: () => void; onConfirm: (minutes: number | undefined) => void; isPending: boolean; error: string | null }) {
  const [minutes, setMinutes] = useState<number>(0);
  return (
    <Shell title={title} onClose={onClose} error={error}>
      <NumberField label="Actual minutes (0 = use the time since start)" value={minutes} minValue={0} step={1} onChange={(n) => setMinutes(Number.isNaN(n) ? 0 : n)} />
      <Buttons onClose={onClose} confirm="Complete" onConfirm={() => onConfirm(minutes > 0 ? minutes : undefined)} isPending={isPending} disabled={false} />
    </Shell>
  );
}
function ReturnDialog({ title, onClose, onConfirm, isPending, error }: { title: string; onClose: () => void; onConfirm: (quantity: number, reason: string) => void; isPending: boolean; error: string | null }) {
  const [q, setQ] = useState(1);
  const [reason, setReason] = useState("");
  return (
    <Shell title={title} onClose={onClose} error={error}>
      <NumberField label="Quantity to return" value={q} minValue={0} step={0.001} onChange={(n) => setQ(Number.isNaN(n) ? 0 : n)} />
      <TextField label="Reason" isRequired value={reason} onChange={setReason} />
      <Buttons onClose={onClose} confirm="Return material" onConfirm={() => onConfirm(q, reason.trim())} isPending={isPending} disabled={q <= 0 || !reason.trim()} />
    </Shell>
  );
}
function ReworkDialog({ max, onClose, onConfirm, isPending, error }: { max: number; onClose: () => void; onConfirm: (quantity: number, reason: string) => void; isPending: boolean; error: string | null }) {
  const [q, setQ] = useState(max);
  const [reason, setReason] = useState("");
  return (
    <Shell title="Send to rework" onClose={onClose} error={error}>
      <NumberField label={`Units to rework (up to ${quantity(max)})`} value={q} minValue={0} maxValue={max} step={1} onChange={(n) => setQ(Number.isNaN(n) ? 0 : n)} />
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
      <Buttons onClose={onClose} confirm="Create rework order" onConfirm={() => onConfirm(q, reason.trim())} isPending={isPending} disabled={q <= 0 || !reason.trim()} />
    </Shell>
  );
}

type Settings = { default_wip_warehouse_id: string | null; default_finished_goods_warehouse_id: string | null; backflush_materials: boolean; require_operation_completion: boolean; allow_overproduction: boolean; configured: boolean };

export function SettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useMfgOptions();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "settings"), queryFn: () => readView<{ settings: Settings }>("settings").then((r) => r.settings) });
  const [draft, setDraft] = useState<Partial<Record<string, string>>>({});
  const [saved, setSaved] = useState(false);
  const s = query.data;
  const save = useMutation({ mutationFn: () => act("settings-save", { defaultWipWarehouseId: draft.wip, defaultFinishedGoodsWarehouseId: draft.fg, backflushMaterials: draft.backflush === undefined ? undefined : draft.backflush === "true", requireOperationCompletion: draft.ops === undefined ? undefined : draft.ops === "true", allowOverproduction: draft.over === undefined ? undefined : draft.over === "true" }), onSuccess: () => { setSaved(true); setDraft({}); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); } });
  const editable = can("manufacturing.settings.manage");
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  const warehouses = (options.data?.warehouses ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
  const yes = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  const pick = (key: string, current: string | null | undefined) => draft[key] ?? current ?? null;
  const flag = (key: string, current: boolean | undefined) => draft[key] ?? String(current ?? false);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Manufacturing settings" description="Defaults for new production orders and the rules production reporting follows." />
      <MfgPanel title="Defaults and rules">
        {save.error && <MfgAlert>{errorText(save.error)}</MfgAlert>}
        {saved && <MfgAlert tone="success">Settings saved.</MfgAlert>}
        <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Default WIP warehouse" isDisabled={!editable || !s} options={warehouses} selectedKey={pick("wip", s?.default_wip_warehouse_id)} onSelectionChange={(k) => { setSaved(false); setDraft((d) => ({ ...d, wip: String(k ?? "") })); }} placeholder="Select warehouse" />
          <Select label="Default finished-goods warehouse" isDisabled={!editable || !s} options={warehouses} selectedKey={pick("fg", s?.default_finished_goods_warehouse_id)} onSelectionChange={(k) => { setSaved(false); setDraft((d) => ({ ...d, fg: String(k ?? "") })); }} placeholder="Select warehouse" />
          <Select label="Backflush all materials" isDisabled={!editable || !s} options={yes} selectedKey={flag("backflush", s?.backflush_materials)} onSelectionChange={(k) => { setSaved(false); setDraft((d) => ({ ...d, backflush: String(k) })); }} />
          <Select label="Require operations complete before output" isDisabled={!editable || !s} options={yes} selectedKey={flag("ops", s?.require_operation_completion)} onSelectionChange={(k) => { setSaved(false); setDraft((d) => ({ ...d, ops: String(k) })); }} />
          <Select label="Allow overproduction" isDisabled={!editable || !s} options={yes} selectedKey={flag("over", s?.allow_overproduction)} onSelectionChange={(k) => { setSaved(false); setDraft((d) => ({ ...d, over: String(k) })); }} />
        </div>
        {editable ? <div><Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={!s}>Save settings</Button></div> : <p className="text-sm text-text-muted">You can view these settings but not change them.</p>}
      </MfgPanel>
    </div>
  );
}
