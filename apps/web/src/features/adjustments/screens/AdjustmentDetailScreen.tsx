"use client";

// One Stock Adjustment: Overview, Lines (System / Counted / Difference), Tracking, Impact (what posting does now), Inventory (its Stock Ledger
// movements), Valuation and Accounting (for those who may see them), Attachments and History. A draft is edited, rechecked after a recount,
// posted (resolving any reservations a shortage breaks, in the same posting) or cancelled; a posted one is reversed only for a posting mistake.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, EmptyState, ErrorState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ADJUSTMENTS_BASE, DISPOSITION_LABEL, STATUS_LABEL, STATUS_TONE, adjustmentFileUrl, cancelAdjustment, errorCode, errorMessage, errorsOf, getAdjustment, getImpact, getStock, postAdjustment,
  recheckAdjustment, removeAdjustmentFile, reverseAdjustment, signed, uploadAdjustmentFile, type AdjustmentDetail, type Impact, type ImpactReservation, type Resolution,
} from "../api/adjustments-api";

const by = (at: string | null, name: string | null) => (at ? `${formatDateTime(at)}${name ? ` by ${name}` : ""}` : null);
const SOURCE_LABEL: Record<string, string> = { current_valuation_cost: "Current valuation cost", manual_authorized_cost: "Authorized cost entered", zero_cost_authorized: "Zero cost (authorized)" };

export function AdjustmentDetailScreen({ adjustmentId }: { adjustmentId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "adjustments", "detail", adjustmentId);
  const detail = useQuery({ queryKey: key, queryFn: () => getAdjustment(adjustmentId) });
  const refresh = (data?: AdjustmentDetail) => { if (data) queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "adjustments") }); };
  const [dialog, setDialog] = useState<"cancel" | "post" | "reverse" | null>(null);
  const draft = detail.data?.adjustment.status === "draft";
  const impact = useQuery({ queryKey: [...key, "impact", detail.data?.adjustment.version], queryFn: () => getImpact(adjustmentId), enabled: draft });
  const recheck = useMutation({ mutationFn: () => recheckAdjustment(adjustmentId), onSuccess: refresh });

  if (detail.isLoading) return <LoadingState label="Loading stock adjustment" rows={5} />;
  if (detail.isError) return errorCode(detail.error) === "ADJUSTMENT_NOT_FOUND"
    ? <EmptyState title="Stock adjustment not found" description="It does not exist, or it is in a warehouse you cannot see." />
    : <ErrorState title="Could not load the stock adjustment" description={errorMessage(detail.error)} action={{ label: "Try again", onPress: () => void detail.refetch() }} />;
  const data = detail.data!;
  const head = data.adjustment;
  const can = data.capabilities;
  const stale = impact.data?.lines.some((line) => line.stale);

  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{head.number} <span className="text-base font-normal whitespace-nowrap text-text-muted">{head.reason}</span></>,
        status: <StatusBadge tone={STATUS_TONE[head.status]}>{STATUS_LABEL[head.status]}</StatusBadge>,
        fields: [
          { label: "Warehouse", value: head.warehouse },
          { label: "Date", value: formatDate(head.adjustmentDate) },
          { label: "Lines", value: `${head.lineCount} (${head.increaseLines} up, ${head.decreaseLines} down)` },
          ...(head.countReference ? [{ label: "Count", value: head.countReference }] : []),
          ...(can.seesCost && head.valueNet !== undefined ? [{ label: "Value impact", value: money(head.valueNet) }] : []),
        ],
        primaryAction: can.post ? <Button variant="primary" onPress={() => setDialog("post")}>Post adjustment</Button> : undefined,
        secondaryActions: (
          <>
            {can.edit && <Button variant="secondary" onPress={() => router.push(`${ADJUSTMENTS_BASE}/${head.id}/edit`)}>Edit</Button>}
            {can.count && data.lines.some((line) => line.entryMode === "counted") && <Button variant="secondary" isLoading={recheck.isPending} onPress={() => recheck.mutate()}>Recheck stock</Button>}
            <MoreActions actions={[
              { id: "cancel", label: "Cancel draft", show: can.cancel, run: () => setDialog("cancel") },
              { id: "reverse", label: "Reverse adjustment", show: can.reverse, run: () => setDialog("reverse") },
            ]} />
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={recheck.isError ? errorMessage(recheck.error) : null} />
          {draft && stale && <Notice tone="warning"><p className="font-medium">Stock changed after a count was captured.</p>
            <p>Recount and edit the line, or — if the counted quantities still hold — use Recheck stock to compare them with the stock recorded now.</p></Notice>}
          {draft && impact.data && !impact.data.ready && !stale && (
            <Notice tone="warning"><p className="font-medium">Not ready to post against current stock:</p>
              <ul className="list-disc pl-5">{impact.data.errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul></Notice>
          )}
        </div>
      }
    >
      <Tabs defaultSelectedKey={draft ? "impact" : "overview"}>
        <TabList aria-label="Stock adjustment sections">
          <Tab id="overview">Overview</Tab><Tab id="lines">Lines</Tab><Tab id="tracking">Tracking</Tab>{draft && <Tab id="impact">Impact</Tab>}<Tab id="inventory">Inventory</Tab>
          {can.seesCost && <Tab id="valuation">Valuation</Tab>}{can.seesAccounting && <Tab id="accounting">Accounting</Tab>}<Tab id="files">Attachments</Tab><Tab id="history">History</Tab>
        </TabList>
        <TabPanel id="overview"><div className="pt-4"><FactList title="Stock adjustment" items={[
          ["Warehouse", `${head.warehouse} · ${head.warehouseName}`], ["Adjustment date", head.adjustmentDate], ["Reason", head.reason], ["Reference", head.reference],
          ["Count / migration reference", head.physicalCountId ? <Link className="text-brand hover:underline" href={`/inventory/stock-counts/${head.physicalCountId}`}>{head.countReference}</Link> : head.countReference],
          ["Notes", head.notes], ["Lines", `${head.lineCount} (${head.increaseLines} up, ${head.decreaseLines} down)`], ["Created", by(head.createdAt, head.createdByName)],
          ["Posted", head.postedAt ? `${by(head.postedAt, head.postedByName)}${head.postingDate ? ` (posting date ${head.postingDate})` : ""}` : "Not posted"],
          ...(head.cancelledAt ? [["Cancelled", `${formatDateTime(head.cancelledAt)}${head.cancelReason ? ` · ${head.cancelReason}` : ""}`] as [string, ReactNode]] : []),
          ...(head.reversedAt ? [["Reversed", `${by(head.reversedAt, head.reversedByName)}${head.reversalReason ? ` · ${head.reversalReason}` : ""}`] as [string, ReactNode]] : []),
          ...(can.seesCost && head.valueNet !== undefined ? [["Inventory value impact", `${money(head.valueNet)} (found ${money(head.valueIncrease ?? 0)}, lost ${money(head.valueDecrease ?? 0)})`] as [string, ReactNode]] : []),
        ]} /></div></TabPanel>
        <TabPanel id="lines"><div className="pt-4"><LinesTable columns={["#", "SKU", "Item", "Location", "Stock", "Entry", "System", "Counted", "Difference", ...(can.seesCost && !draft ? ["Value"] : [])]}>
          {data.lines.map((line) => (
            <tr key={line.id}><Cell>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.itemName}</Cell><Cell>{line.location}</Cell><Cell>{DISPOSITION_LABEL[line.disposition]}</Cell>
              <Cell>{line.entryMode === "counted" ? `Counted${line.countedAt ? ` ${formatDateTime(line.countedAt)}` : ""}` : "Difference"}</Cell>
              <Cell>{quantity(line.systemQuantity, line.baseUom)}</Cell>
              <Cell>{line.countedQuantity === null ? "—" : `${quantity(line.countedQuantity, line.uom)}${line.conversion !== 1 ? ` = ${quantity(line.countedBaseQuantity ?? 0, line.baseUom)}` : ""}`}</Cell>
              <Cell><span className={line.difference < 0 ? "text-danger" : line.difference > 0 ? "text-success" : ""}>{signed(line.difference)} {line.baseUom ?? ""}</span></Cell>
              {can.seesCost && !draft && <Cell>{line.value === undefined ? "—" : money(line.value)}</Cell>}</tr>
          ))}
        </LinesTable></div></TabPanel>
        <TabPanel id="tracking"><div className="flex flex-col gap-3 pt-4">
          {data.lines.every((line) => !line.batches.length && !line.serials.length) ? <p className="text-sm text-text-muted">No batch or serial-numbered items.</p> : data.lines.map((line) => (
            line.batches.length || line.serials.length ? <div key={line.id} className="text-sm"><p className="font-medium">Line {line.lineNumber} · {line.sku}</p>
              {line.batches.map((batch) => <p key={batch.batch}>Batch {batch.batch}{batch.isNew ? " (new lot)" : ""}{batch.expiresOn ? ` · expires ${batch.expiresOn}` : ""}: system {quantity(batch.systemQuantity)}
                {batch.countedQuantity !== null ? ` · counted ${quantity(batch.countedQuantity)}` : ""} · {signed(batch.difference)}</p>)}
              {line.serials.filter((serial) => serial.direction === "out").length > 0 && <p>Missing: {line.serials.filter((serial) => serial.direction === "out").map((serial) => serial.serialNumber).join(", ")}</p>}
              {line.serials.filter((serial) => serial.direction === "in").length > 0 && <p>Found: {line.serials.filter((serial) => serial.direction === "in").map((serial) => serial.serialNumber).join(", ")}</p>}</div> : null))}
        </div></TabPanel>
        {draft && <TabPanel id="impact"><div className="pt-4">{impact.isLoading ? <LoadingState label="Checking current stock" rows={3} /> : impact.data ? <ImpactTable impact={impact.data} seesCost={can.seesCost} /> : null}</div></TabPanel>}
        <TabPanel id="inventory"><div className="flex flex-col gap-3 pt-4">
          {data.movements.length === 0 ? <p className="text-sm text-text-muted">{draft ? "A draft moves no stock." : "No stock movements (every line had no difference)."}</p> : <>
            <div className="flex flex-wrap gap-3 text-sm"><Link className="text-brand hover:underline" href={`/inventory/transactions?tab=ledger&sourceId=${head.id}`}>View in Stock Ledger</Link>
              <Link className="text-brand hover:underline" href={`/inventory/warehouses/${head.warehouseId}`}>View warehouse</Link></div>
            <LinesTable columns={["Movement", "Type", "Effective", "Posted", "Item", "Location", "Batch / Serial", "Quantity"]}>
              {data.movements.map((movement) => (
                <tr key={movement.id}><Cell><Link className="text-brand hover:underline" href={`/inventory/stock-ledger/${movement.id}`}>{movement.number}</Link></Cell><Cell>{movement.typeLabel}</Cell>
                  <Cell>{formatDateTime(movement.effectiveAt)}</Cell><Cell>{formatDateTime(movement.postedAt)}</Cell><Cell>{movement.sku}</Cell><Cell>{movement.location}</Cell><Cell>{movement.serial ?? movement.batch}</Cell>
                  <Cell>{quantity(movement.quantity, movement.baseUom)}</Cell></tr>
              ))}
            </LinesTable></>}
        </div></TabPanel>
        {can.seesCost && <TabPanel id="valuation"><div className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-text-muted">Stock found is valued at its authorized cost basis; stock lost leaves at the cost Inventory Valuation gives it (the item&apos;s valuation method). Nobody types a cost for stock lost.</p>
          <LinesTable columns={["Line", "Item", "Difference", "Cost basis", "Value"]}>{data.lines.map((line) => (
            <tr key={line.id}><Cell>{line.lineNumber}</Cell><Cell>{line.sku} · {line.itemName}</Cell><Cell>{signed(line.difference)} {line.baseUom ?? ""}</Cell>
              <Cell>{line.difference > 0 ? `${SOURCE_LABEL[line.valuationSource ?? "current_valuation_cost"]}${line.unitCost ? ` · ${money(line.unitCost)}` : ""}${line.costNote ? ` · ${line.costNote}` : ""}` : line.difference < 0 ? "Inventory valuation" : "—"}</Cell>
              <Cell>{line.value === undefined ? (draft ? "On posting" : "—") : money(line.value)}</Cell></tr>))}</LinesTable>
          {head.valueNet !== undefined && <p className="text-sm">Total inventory value impact: <span className="font-medium">{money(head.valueNet)}</span> (found {money(head.valueIncrease ?? 0)}, lost {money(head.valueDecrease ?? 0)})</p>}
        </div></TabPanel>}
        {can.seesAccounting && <TabPanel id="accounting"><div className="flex flex-col gap-3 pt-4 text-sm">
          <p className="text-text-muted">Stock lost: Dr Inventory adjustment loss, Cr Inventory. Stock found: Dr Inventory, Cr Inventory adjustment gain. The accounts come from the reason, else the item or its category, else the company default. No tax document is created. Finance owns the journals.</p>
          {!data.journals?.length ? <p className="text-text-muted">No journal yet.</p> : data.journals.map((entry) => (
            <div key={entry.id}><p><Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link> · {entry.date} · {entry.status}{entry.reversal ? " · reversal" : ""}</p>
              <ul className="pl-4 text-xs">{entry.lines.map((line, index) => <li key={index}>{line.account}: {line.debit ? `Dr ${money(line.debit)}` : `Cr ${money(line.credit)}`}</li>)}</ul></div>))}
        </div></TabPanel>}
        <TabPanel id="files"><div className="pt-4"><Files detail={data} onChange={() => void detail.refetch()} /></div></TabPanel>
        <TabPanel id="history"><HistoryList entries={data.history.map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor }))} /></TabPanel>
      </Tabs>
    </RecordDetailsPage>
      {dialog === "cancel" && <CancelDialog id={head.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "post" && <PostDialog detail={data} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "reverse" && <ReverseDialog detail={data} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function ImpactTable({ impact, seesCost }: { impact: Impact; seesCost: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <LinesTable columns={["Line", "Item", "Location", "Batch / Serial", "On hand", "Reserved", "Available", "Difference", "Projected on hand", "Projected reserved", ...(seesCost ? ["Value"] : [])]}>
        {impact.lines.flatMap((line) => (line.parts.length ? line.parts : [null]).map((part, index) => (
          <tr key={`${line.lineId}:${part?.key ?? "none"}`} className={line.stale ? "bg-warning-soft" : ""}>
            <Cell>{index === 0 ? line.lineNumber : ""}</Cell><Cell>{index === 0 ? line.sku : ""}</Cell><Cell>{index === 0 ? `${line.location}${line.disposition !== "available" ? ` · ${DISPOSITION_LABEL[line.disposition]}` : ""}` : ""}</Cell>
            {part ? <><Cell>{part.serial ?? part.batch ?? "—"}</Cell><Cell>{quantity(part.onHand)}</Cell><Cell>{quantity(part.reserved)}</Cell><Cell>{quantity(part.available)}</Cell>
              <Cell>{signed(part.difference)}</Cell><Cell>{quantity(part.projectedOnHand)}</Cell><Cell>{quantity(part.projectedReserved)}{part.shortfall ? <span className="text-warning"> · {quantity(part.shortfall)} short</span> : ""}</Cell>
              {seesCost && <Cell>{part.value === undefined ? "—" : money(part.value)}</Cell>}</> : <><Cell>No difference: nothing posts</Cell><Cell>{""}</Cell><Cell>{""}</Cell><Cell>{""}</Cell><Cell>{""}</Cell><Cell>{""}</Cell><Cell>{""}</Cell>{seesCost && <Cell>{""}</Cell>}</>}
          </tr>
        )))}
      </LinesTable>
      {seesCost && impact.value && <p className="text-sm">Estimated inventory value impact: <span className="font-medium">{money(impact.value.net)}</span> (found {money(impact.value.increase)}, lost {money(impact.value.decrease)}){impact.large ? " · above the large-adjustment threshold" : ""}</p>}
    </div>
  );
}

// Post: the impact again, and for each reservation a shortage would break, how it is resolved — released (all or part) or reallocated to other
// stock (another serial number, location or batch) — all in the same posting.
function PostDialog({ detail, onClose, onDone }: { detail: AdjustmentDetail; onClose: () => void; onDone: (data: AdjustmentDetail) => void }) {
  const workspace = useWorkspaceContext();
  const impact = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "detail", detail.adjustment.id, "post-impact"), queryFn: () => getImpact(detail.adjustment.id) });
  const [plan, setPlan] = useState<Record<string, Resolution>>({});
  const conflicts = (impact.data?.lines ?? []).flatMap((line) => line.parts.filter((part) => part.shortfall > 0).map((part) => ({ line, part })));
  const post = useMutation({ mutationFn: () => postAdjustment(detail.adjustment.id, Object.values(plan)), onSuccess: (data) => { onDone(data); onClose(); } });
  const blocking = (impact.data?.errors ?? []).filter((entry) => entry.code !== "ADJUSTMENT_RESERVATION_CONFLICT");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Post ${detail.adjustment.number}`}>
      <div className="flex flex-col gap-3 text-sm">
        {impact.isLoading ? <LoadingState label="Checking current stock" rows={3} /> : impact.data ? <>
          <ImpactTable impact={impact.data} seesCost={detail.capabilities.seesCost} />
          {blocking.length > 0 && <div className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-danger"><ul className="list-disc pl-5">{blocking.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul></div>}
          {conflicts.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft p-3">
              <p className="font-medium">Reservation conflict</p>
              {conflicts.map(({ line, part }) => (
                <div key={`${line.lineId}:${part.key}`} className="flex flex-col gap-2">
                  <p>Line {line.lineNumber} ({line.sku}{part.serial ? ` · ${part.serial}` : part.batch ? ` · ${part.batch}` : ""}): {quantity(part.shortfall)} reserved can no longer be fulfilled. Resolve:</p>
                  {part.reservations.map((reservation) => (
                    <ResolutionRow key={reservation.id} reservation={reservation} itemId={detail.lines.find((entry) => entry.id === line.lineId)?.itemId ?? ""} warehouseId={detail.adjustment.warehouseId}
                      shortfall={part.shortfall} value={plan[reservation.id]} allowed={detail.capabilities.resolveReservations}
                      onChange={(value) => setPlan((current) => { const next = { ...current }; if (value) next[reservation.id] = value; else delete next[reservation.id]; return next; })} />
                  ))}
                </div>
              ))}
              {!detail.capabilities.resolveReservations && <p className="text-warning">You do not have permission to resolve reservation conflicts; ask an inventory manager.</p>}
            </div>
          )}
        </> : <ErrorBanner message={errorMessage(impact.error)} />}
        {post.error && <div role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-danger">{errorMessage(post.error)}
          {errorsOf(post.error).length > 1 && <ul className="mt-1 list-disc pl-5">{errorsOf(post.error).map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}</div>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isDisabled={!impact.data || blocking.length > 0} isLoading={post.isPending} onPress={() => post.mutate()}>Post adjustment</Button></div>
      </div>
    </Dialog>
  );
}

function ResolutionRow({ reservation, itemId, warehouseId, shortfall, value, allowed, onChange }: {
  reservation: ImpactReservation; itemId: string; warehouseId: string; shortfall: number; value: Resolution | undefined; allowed: boolean; onChange: (value: Resolution | null) => void;
}) {
  const workspace = useWorkspaceContext();
  const stock = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "stock", warehouseId, itemId), queryFn: () => getStock(warehouseId, itemId), enabled: Boolean(itemId) });
  const action = value?.action ?? "none";
  const serials = (stock.data?.serials ?? []).filter((serial) => !serial.reserved && serial.id !== reservation.serialId);
  const positions = (stock.data?.positions ?? []).filter((position) => position.available > 0 && position.disposition === "available");
  return (
    <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
      <span>{reservation.number}{reservation.document ? ` · ${reservation.document}` : ""} · {quantity(reservation.quantity)} reserved</span>
      <Select aria-label={`Resolve ${reservation.number}`} isDisabled={!allowed} selectedKey={action}
        onSelectionChange={(key) => onChange(key === "release" ? { reservationId: reservation.id, action: "release", quantity: reservation.serialId ? undefined : String(Math.min(shortfall, reservation.quantity)) }
          : key === "reallocate" ? { reservationId: reservation.id, action: "reallocate" } : null)}
        options={[{ value: "none", label: "Not resolved" }, { value: "release", label: "Release" }, ...(reservation.source !== "stock_transfer" ? [{ value: "reallocate", label: "Reallocate to other stock" }] : [])]} />
      {action === "release" && !reservation.serialId && <TextField aria-label="Quantity released" inputMode="decimal" value={value?.quantity ?? ""} onChange={(next) => onChange({ ...value!, quantity: next })} />}
      {action === "reallocate" && (reservation.serialId
        ? <Select aria-label="Reallocate to serial number" selectedKey={value?.serialId ?? null} onSelectionChange={(key) => onChange({ ...value!, serialId: String(key) })}
            options={serials.map((serial) => ({ value: serial.id, label: serial.serialNumber }))} />
        : <Select aria-label="Reallocate to stock" selectedKey={value?.locationId || value?.batchId ? `${value?.locationId ?? ""}|${value?.batchId ?? ""}` : null}
            onSelectionChange={(key) => { const [locationId, batchId] = String(key).split("|"); onChange({ ...value!, locationId: locationId || undefined, batchId: batchId || undefined }); }}
            options={positions.map((position) => ({ value: `${position.locationId ?? ""}|${position.batchId ?? ""}`, label: `${position.location}${position.batch ? ` · ${position.batch}` : ""} · ${quantity(position.available)} available` }))} />)}
    </div>
  );
}

function CancelDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (data: AdjustmentDetail) => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({ mutationFn: () => cancelAdjustment(id, reason), onSuccess: (data) => { onDone(data); onClose(); } });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Cancel this draft">
      <div className="flex flex-col gap-3">
        <TextArea label="Reason (optional)" value={reason} onChange={setReason} />
        <ErrorBanner message={cancel.isError ? errorMessage(cancel.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Keep it</Button><Button variant="danger" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel draft</Button></div>
      </div>
    </Dialog>
  );
}

function ReverseDialog({ detail, onClose, onDone }: { detail: AdjustmentDetail; onClose: () => void; onDone: (data: AdjustmentDetail) => void }) {
  const [reason, setReason] = useState("");
  const reverse = useMutation({ mutationFn: () => reverseAdjustment(detail.adjustment.id, reason), onSuccess: (data) => { onDone(data); onClose(); } });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Reverse ${detail.adjustment.number}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Only for a posting mistake. Every movement is compensated and the journal reversed; the original stays visible. If the adjustment was right and a later
          count finds another difference, create a new adjustment instead. Stock found and since used, or a serial number since sold, cannot be taken back.</p>
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <ErrorBanner message={reverse.isError ? errorMessage(reverse.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="danger" isDisabled={reason.trim().length < 3} isLoading={reverse.isPending} onPress={() => reverse.mutate()}>Reverse adjustment</Button></div>
      </div>
    </Dialog>
  );
}

function Files({ detail, onChange }: { detail: AdjustmentDetail; onChange: () => void }) {
  const upload = useMutation({ mutationFn: (file: File) => uploadAdjustmentFile(detail.adjustment.id, file), onSuccess: onChange });
  const remove = useMutation({ mutationFn: (fileId: string) => removeAdjustmentFile(detail.adjustment.id, fileId), onSuccess: onChange });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-text-muted">Count sheets, reconciliation reports, photos, supervisor confirmations, migration evidence, investigation reports.</p>
      {detail.files.map((file) => (
        <div key={file.id} className="flex items-center justify-between gap-2"><a className="text-brand hover:underline" href={adjustmentFileUrl(detail.adjustment.id, file.id)}>{file.fileName}</a>
          <span className="text-xs text-text-muted">{formatDateTime(file.uploadedAt)}</span>
          {detail.adjustment.status === "draft" && detail.capabilities.edit && <Button size="compact" variant="ghost" onPress={() => remove.mutate(file.id)}>Remove</Button>}</div>
      ))}
      {detail.adjustment.status !== "cancelled" && <label className="text-sm"><input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /></label>}
      <ErrorBanner message={upload.isError ? errorMessage(upload.error) : remove.isError ? errorMessage(remove.error) : null} />
    </div>
  );
}
