"use client";

// One reorder rule, recalculated now and explained: eligible on hand − firm demand = current position; + firm incoming = projected position;
// against the reorder level and target, with the order multiple. Then the documents behind demand and incoming, what other warehouses could
// send, and the actions — a draft purchase order or a draft transfer (each a draft of its own workflow), edit, enable / disable, dismiss.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, ErrorState, RecordDetailsPage, Select, TextField } from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createPurchaseDraft, createTransferDraft, dismissRecommendation, errorMessage, getRule, updateRule, type RuleDetail,
} from "../api/replenishment-api";
import { ReorderStatusBadge } from "./ReplenishmentScreen";

const Th = ({ children }: { children: React.ReactNode }) => <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>;

export function ReorderRuleScreen({ ruleId }: { ruleId: string }) {
  const workspace = useWorkspaceContext();
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "rule", ruleId), queryFn: () => getRule(ruleId) });
  const [dialog, setDialog] = useState<null | "purchase" | "transfer" | "edit" | "dismiss">(null);
  if (detail.isLoading) return <LoadingState label="Loading the reorder rule" rows={4} />;
  if (!detail.data) return <ErrorState title="Could not load the reorder rule" description={errorMessage(detail.error)} />;
  const { rule, demand, incoming, otherWarehouses, history, capabilities: can } = detail.data;
  const uom = rule.baseUom ?? undefined;
  const short = rule.suggested > 0;
  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{rule.sku} <span className="text-base font-normal whitespace-nowrap text-text-muted">{rule.warehouse}</span></>,
        status: <span className="flex flex-wrap items-center gap-2"><ReorderStatusBadge rule={rule} />{!rule.enabled && <Badge tone="neutral">Disabled</Badge>}</span>,
        fields: [
          { label: "Item", value: rule.itemName },
          { label: "Warehouse", value: rule.warehouseName },
          { label: "Reorder level", value: quantity(rule.reorderLevel, uom) },
          { label: "Target", value: quantity(rule.targetLevel, uom) },
          { label: "Suggested", value: short ? quantity(rule.suggested, uom) : "Nothing" },
        ],
        primaryAction: can.purchaseDraft && rule.enabled ? <Button variant={short ? "primary" : "secondary"} onPress={() => setDialog("purchase")}>Create purchase order</Button> : undefined,
        secondaryActions: (
          <>
            {can.transferDraft && rule.enabled && <Button variant="secondary" onPress={() => setDialog("transfer")}>Create transfer</Button>}
            {can.edit && <Button variant="secondary" onPress={() => setDialog("edit")}>Edit rule</Button>}
            {can.disable && <EnableToggle detail={detail.data} />}
            <MoreActions actions={[{ id: "dismiss", label: "Dismiss recommendation", show: Boolean(can.dismiss && rule.recommendation && rule.recommendation.status !== "dismissed"), run: () => setDialog("dismiss") }]} />
          </>
        ),
      }}
    >
    <div className="flex flex-col gap-4">
      {rule.notes && <Notice tone="neutral">{rule.notes}</Notice>}

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3"><ReorderStatusBadge rule={rule} />{rule.outOfStock && rule.status !== "out_of_stock" && <Badge tone="danger">No eligible stock</Badge>}
          {rule.recommendation?.status === "actioned" && rule.recommendation.actionHref && <span className="text-sm">Draft <Link className="text-brand hover:underline" href={rule.recommendation.actionHref}>{rule.recommendation.actionNumber}</Link> opened — it counts as incoming once confirmed.</span>}
          {rule.recommendation?.status === "dismissed" && <span className="text-sm text-text-muted">Recommendation dismissed: {rule.recommendation.dismissReason}</span>}</div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Figure label="Eligible on hand" value={quantity(rule.eligibleOnHand, uom)} hint="Excludes quality hold, quarantine, damaged, expired and blocked stock" />
          <Figure label="− Firm demand" value={quantity(rule.firmDemand, uom)} hint={`Sales orders ${quantity(rule.salesDemand)} · transfers out ${quantity(rule.transferDemand)}`} />
          <Figure label="= Current position" value={quantity(rule.currentPosition, uom)} strong />
          <Figure label="+ Firm incoming" value={quantity(rule.firmIncoming, uom)} hint={`Purchase orders ${quantity(rule.purchaseIncoming)} · transfers in ${quantity(rule.transferIncoming)}`} />
          <Figure label="= Projected position" value={quantity(rule.projectedPosition, uom)} strong />
          <Figure label="Reorder level" value={quantity(rule.reorderLevel, uom)} />
          <Figure label="Target stock level" value={quantity(rule.targetLevel, uom)} />
          <Figure label="Order multiple" value={rule.orderMultiple ? quantity(rule.orderMultiple, uom) : "—"} />
        </dl>
        <p className="mt-3 text-sm">{!rule.enabled ? "The rule is disabled: it recommends nothing."
          : short ? <>Projected {quantity(rule.projectedPosition)} ≤ reorder level {quantity(rule.reorderLevel)}: replenish <strong>{quantity(rule.suggested, uom)}</strong>
            {" "}(target {quantity(rule.targetLevel)} − projected {quantity(rule.projectedPosition)} = {quantity(rule.rawSuggested)}{rule.orderMultiple ? `, rounded up to a multiple of ${quantity(rule.orderMultiple)}` : ""}).</>
          : rule.status === "below_reorder_covered" ? <>Current position {quantity(rule.currentPosition)} is at or below the reorder level, but confirmed incoming lifts it to {quantity(rule.projectedPosition)}: no additional replenishment.</>
          : <>Above the reorder level: no replenishment needed.</>}</p>
        {rule.calculatedAt && <p className="mt-1 text-xs text-text-muted">Recalculated {formatDateTime(rule.calculatedAt)}. Base units; reservations are part of their orders&apos; demand, never counted twice.</p>}
      </Panel>

      {demand && <Panel title={<>Firm demand</>}>
        {demand.length === 0 ? <p className="text-sm text-text-muted">No confirmed sales orders or transfers out are waiting on this warehouse.</p> : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr><Th>Document</Th><Th>Kind</Th><Th>Date</Th><Th>Open quantity</Th><Th>Of which reserved</Th></tr></thead>
            <tbody className="divide-y divide-border">{demand.map((row) => (
              <tr key={`${row.kind}-${row.id}`}><Cell><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link></Cell>
                <Cell>{row.kind === "sales_order" ? `Sales order${row.status === "on_hold" ? " (on hold)" : ""}` : `Transfer to ${row.destination}`}</Cell>
                <Cell>{row.date ? formatDate(row.date) : "—"}</Cell><Cell className="tabular-nums">{quantity(row.quantity, uom)}</Cell><Cell className="tabular-nums">{row.reserved !== undefined ? quantity(row.reserved) : "—"}</Cell></tr>))}</tbody>
          </table></div>)}
      </Panel>}

      {incoming && <Panel title={<>Firm incoming</>}>
        {incoming.length === 0 ? <p className="text-sm text-text-muted">No confirmed purchase orders or transfers are on their way. Draft purchase orders and transfers never count.</p> : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr><Th>Document</Th><Th>From</Th><Th>Quantity</Th><Th>Expected</Th></tr></thead>
            <tbody className="divide-y divide-border">{incoming.map((row) => (
              <tr key={`${row.kind}-${row.id}`}><Cell><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link></Cell>
                <Cell>{row.kind === "purchase_order" ? row.supplier ?? "Supplier" : `${row.source}${row.kind === "in_transit" ? " (in transit)" : ""}`}</Cell>
                <Cell className="tabular-nums">{quantity(row.quantity, uom)}</Cell>
                <Cell>{row.expected ? formatDate(row.expected) : "—"}{row.overdue && <> <Badge tone="warning">Overdue</Badge></>}</Cell></tr>))}</tbody>
          </table></div>)}
      </Panel>}

      {otherWarehouses && <Panel title={<>Other warehouses</>}>
        <p className="text-xs text-text-muted">Advisory: stock moves only through a transfer.</p>
        {otherWarehouses.length === 0 ? <p className="text-sm text-text-muted">No other warehouse has this item available.</p> : (
          <ul className="flex flex-col gap-1 text-sm">{otherWarehouses.map((row) => <li key={row.warehouseId}>{row.warehouse} · {row.warehouseName}: {quantity(row.available, uom)} available</li>)}</ul>)}
      </Panel>}

      <Panel title={<>History</>}>
        <ul className="flex flex-col gap-1 text-sm">{history.map((entry, index) => (
          <li key={`${entry.at}-${index}`}><span className="text-text-muted">{formatDateTime(entry.at)}</span> · {entry.summary}{entry.by ? ` · ${entry.by}` : ""}
            {entry.oldValues && entry.newValues && <span className="block text-xs text-text-muted">{Object.keys(entry.newValues).map((key) => `${key}: ${String(entry.oldValues?.[key] ?? "—")} → ${String(entry.newValues?.[key] ?? "—")}`).join(" · ")}</span>}</li>))}</ul>
      </Panel>

    </div>
    </RecordDetailsPage>
      {dialog === "purchase" && <PurchaseDialog detail={detail.data} onClose={() => setDialog(null)} />}
      {dialog === "transfer" && <TransferDialog detail={detail.data} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditDialog detail={detail.data} onClose={() => setDialog(null)} />}
      {dialog === "dismiss" && <DismissDialog ruleId={rule.id} onClose={() => setDialog(null)} />}
    </>
  );
}

function Figure({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return <div><dt className="text-xs text-text-muted">{label}</dt><dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>{hint && <dd className="text-xs text-text-muted">{hint}</dd>}</div>;
}

function useRefresh(ruleId: string) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => { void client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "replenishment") }); void client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "replenishment", "rule", ruleId) }); };
}

function EnableToggle({ detail }: { detail: RuleDetail }) {
  const refresh = useRefresh(detail.rule.id);
  const toggle = useMutation({ mutationFn: () => updateRule(detail.rule.id, { enabled: !detail.rule.enabled, expectedVersion: detail.rule.version }), onSuccess: refresh });
  return <Button variant="ghost" isLoading={toggle.isPending} onPress={() => toggle.mutate()}>{detail.rule.enabled ? "Disable" : "Enable"}</Button>;
}

// A draft purchase order: the server recalculates the suggestion first, so a stale screen never orders too much. One request key per dialog:
// a double click opens one draft.
export function PurchaseDialog({ detail, onClose }: { detail: RuleDetail; onClose: () => void }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [quantityText, setQuantity] = useState(detail.rule.suggested > 0 ? String(detail.rule.suggested) : "");
  const [price, setPrice] = useState(detail.supplier?.unitPrice ?? "");
  const make = useMutation({
    mutationFn: () => createPurchaseDraft(detail.rule.id, { idempotencyKey: key, supplierId: detail.supplier?.supplierId, unitPrice: price || undefined,
      quantity: detail.rule.suggested > 0 && Number(quantityText) === detail.rule.suggested ? undefined : quantityText || undefined }),
    onSuccess: (draft) => router.push(draft.href),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Create purchase order">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Opens a <strong>draft</strong> purchase order into {detail.rule.warehouse} for review — supplier terms, price and approval stay in Procurement. It counts as incoming only once confirmed.</p>
        <p>Supplier: {detail.supplier ? <>{detail.supplier.name ?? detail.supplier.number} <span className="text-text-muted">({detail.supplier.source === "supplier_price" ? "supplier price" : "last purchase"}{detail.supplier.leadTimeDays !== null ? `, lead time ${detail.supplier.leadTimeDays} days` : ""})</span></> : <span className="text-danger">Procurement has no supplier price or earlier order for this item — create the purchase order in Procurement.</span>}</p>
        <TextField label={`Quantity (${detail.rule.baseUom ?? "base unit"})`} inputMode="decimal" value={quantityText} onChange={setQuantity} description="Placed in the purchase unit when it converts exactly; leave the suggestion to have it recalculated now." />
        <TextField label={`Unit price${detail.supplier?.priceUom ? ` per ${detail.supplier.priceUom}` : ""}${detail.supplier?.currencyCode ? ` (${detail.supplier.currencyCode})` : ""}`} inputMode="decimal" value={price} onChange={setPrice} />
        {make.isError && <p role="alert" className="text-danger">{errorMessage(make.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!detail.supplier} isLoading={make.isPending} onPress={() => make.mutate()}>Open draft purchase order</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function TransferDialog({ detail, onClose }: { detail: RuleDetail; onClose: () => void }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const sources = detail.otherWarehouses ?? [];
  const [sourceId, setSourceId] = useState(sources[0]?.warehouseId ?? "");
  const [quantityText, setQuantity] = useState(detail.rule.suggested > 0 ? String(detail.rule.suggested) : "");
  const make = useMutation({
    mutationFn: () => createTransferDraft(detail.rule.id, { idempotencyKey: key, sourceWarehouseId: sourceId,
      quantity: detail.rule.suggested > 0 && Number(quantityText) === detail.rule.suggested ? undefined : quantityText || undefined }),
    onSuccess: (draft) => router.push(draft.href),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Create transfer">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Opens a <strong>draft</strong> internal transfer into {detail.rule.warehouse}. Confirming it there reserves the source stock; dispatch and receipt move it.</p>
        {sources.length === 0 ? <p className="text-danger">No other warehouse has this item available.</p> : (
          <Select label="From warehouse" selectedKey={sourceId || null} onSelectionChange={(key) => setSourceId(String(key))}
            options={sources.map((row) => ({ value: row.warehouseId, label: `${row.warehouse} · ${quantity(row.available)} available` }))} />)}
        <TextField label={`Quantity (${detail.rule.baseUom ?? "base unit"})`} inputMode="decimal" value={quantityText} onChange={setQuantity} />
        {make.isError && <p role="alert" className="text-danger">{errorMessage(make.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!sourceId} isLoading={make.isPending} onPress={() => make.mutate()}>Open draft transfer</Button>
        </div>
      </div>
    </Dialog>
  );
}

function EditDialog({ detail, onClose }: { detail: RuleDetail; onClose: () => void }) {
  const refresh = useRefresh(detail.rule.id);
  const [reorderLevel, setReorderLevel] = useState(String(detail.rule.reorderLevel));
  const [targetLevel, setTargetLevel] = useState(String(detail.rule.targetLevel));
  const [orderMultiple, setOrderMultiple] = useState(detail.rule.orderMultiple === null ? "" : String(detail.rule.orderMultiple));
  const [notes, setNotes] = useState(detail.rule.notes ?? "");
  const save = useMutation({
    mutationFn: () => updateRule(detail.rule.id, { reorderLevel, targetLevel, orderMultiple: orderMultiple || null, notes: notes || null, expectedVersion: detail.rule.version }),
    onSuccess: () => { refresh(); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Edit reorder rule">
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <TextField label={`Reorder level (${detail.rule.baseUom ?? ""})`} inputMode="decimal" value={reorderLevel} onChange={setReorderLevel} />
          <TextField label="Target stock level" inputMode="decimal" value={targetLevel} onChange={setTargetLevel} />
          <TextField label="Order multiple" inputMode="decimal" value={orderMultiple} onChange={setOrderMultiple} description="Optional" />
        </div>
        <TextField label="Notes" value={notes} onChange={setNotes} />
        {save.isError && <p role="alert" className="text-danger">{errorMessage(save.error)}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </div>
    </Dialog>
  );
}

function DismissDialog({ ruleId, onClose }: { ruleId: string; onClose: () => void }) {
  const refresh = useRefresh(ruleId);
  const [reason, setReason] = useState("");
  const dismiss = useMutation({ mutationFn: () => dismissRecommendation(ruleId, reason), onSuccess: () => { refresh(); onClose(); } });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Dismiss recommendation">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">The item keeps showing below reorder while it is; stock and the rule are unchanged. A new recommendation opens if the need returns after it is met.</p>
        <TextField label="Reason" value={reason} onChange={setReason} />
        {dismiss.isError && <p role="alert" className="text-danger">{errorMessage(dismiss.error)}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isDisabled={!reason.trim()} isLoading={dismiss.isPending} onPress={() => dismiss.mutate()}>Dismiss</Button></div>
      </div>
    </Dialog>
  );
}
