"use client";

// One quality hold: what it holds and where (each position, batch and serial number), the reservations it moved aside, the review (reviewer,
// due date, inspection notes, decision), every outcome (released, escalated, damaged, returned, disposed of, transferred) with its document, the
// evidence and the history. A draft is checked against current stock and placed; a placed hold is released, escalated or moved to damaged —
// never edited. Returning to the supplier and disposing of stock are their own documents.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, EmptyState, ErrorState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { PropertyList } from "@/shared/ui/PropertyList";
import { Cell, HistoryList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  QUALITY_HOLDS_BASE, STATUS_TONE, cancelHold, errorCode, errorMessage, errorsOf, getHold, getHoldOptions, holdFileUrl, listHoldFiles, placeHold, resolveHold, reviewHold, uploadHoldFile,
  validateHold, type HoldAllocation, type HoldDetail,
} from "../api/quality-holds-api";


export function QualityHoldDetailScreen({ holdId }: { holdId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "quality-holds", "detail", holdId);
  const detail = useQuery({ queryKey: key, queryFn: () => getHold(holdId) });
  const refresh = (data?: HoldDetail) => { if (data) queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality-holds") }); };
  const [dialog, setDialog] = useState<null | "cancel" | "release" | "escalate" | "damage">(null);
  const isDraft = detail.data?.hold.status === "draft";
  const validation = useQuery({ queryKey: [...key, "validation"], queryFn: () => validateHold(holdId), enabled: isDraft });
  const place = useMutation({ mutationFn: () => placeHold(holdId), onSuccess: (data) => refresh(data) });
  if (detail.isLoading) return <LoadingState label="Loading quality hold" rows={5} />;
  if (detail.isError) return errorCode(detail.error) === "HOLD_NOT_FOUND" ? <EmptyState title="Quality hold not found" description="It does not exist, or it is in a warehouse you cannot see." />
    : <ErrorState title="Could not load the quality hold" description={errorMessage(detail.error)} action={{ label: "Try again", onPress: () => void detail.refetch() }} />;
  const data = detail.data!;
  const head = data.hold;
  const can = data.capabilities;
  const held = data.allocations.filter((allocation) => allocation.status === "active");
  const conflicts = validation.data?.reservationConflicts ?? [];
  const primaryAction = can.place
    ? <Button variant="primary" isDisabled={validation.data ? !validation.data.ready : false} isLoading={place.isPending} onPress={() => place.mutate()}>
      {head.holdType === "quarantine" ? "Place in quarantine" : "Place on hold"}</Button>
    : can.release ? <Button variant="primary" onPress={() => setDialog("release")}>Release…</Button> : undefined;
  const open = head.status === "active" || head.status === "partially_resolved";
  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{head.number} <span className="text-base font-normal whitespace-nowrap text-text-muted">{head.reason}</span></>,
        status: (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONE[head.status]}>{head.statusLabel}</StatusBadge>
            <Badge tone={head.holdType === "quarantine" ? "danger" : "warning"}>{head.holdTypeLabel}</Badge>
            {head.overdue && <Badge tone="danger">Review overdue</Badge>}
          </span>
        ),
        fields: [
          { label: "Warehouse", value: head.originWarehouse },
          { label: "Held", value: `${quantity(head.heldQuantity)} of ${quantity(head.originalQuantity)}` },
          { label: "Source", value: head.source.number ?? (head.source.type === "manual" ? "Manual" : "Existing stock") },
          { label: "Reviewer", value: head.assignedUserName ?? "Not assigned" },
          { label: "Review due", value: head.reviewDueOn ? formatDate(head.reviewDueOn) : "Not set" },
        ],
        primaryAction,
        secondaryActions: (
          <>
            {can.edit && <Button variant="secondary" onPress={() => router.push(`${QUALITY_HOLDS_BASE}/${head.id}/edit`)}>Edit</Button>}
            <MoreActions actions={[
              { id: "escalate", label: "Escalate to quarantine…", show: can.escalate, run: () => setDialog("escalate") },
              { id: "damage", label: "Move to damaged…", show: can.damage, run: () => setDialog("damage") },
              { id: "return", label: "Create purchase return", show: open && can.purchaseReturn && Boolean(head.source.id), run: () => router.push(`/procurement/purchase-returns/new?receiptId=${head.source.id}`) },
              { id: "dispose", label: "Dispose of stock (goods issue)", show: open && can.dispose, run: () => router.push(`/inventory/goods-issues/new?warehouseId=${head.originWarehouseId}`) },
              { id: "transfer", label: "Transfer held stock", show: open, run: () => router.push("/inventory/transfers/new") },
              { id: "cancel", label: "Cancel draft", show: can.cancel, run: () => setDialog("cancel") },
            ]} />
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          {place.isError && <Notice>{errorMessage(place.error)}
            {errorsOf(place.error).length > 1 && <ul className="mt-1 list-disc pl-5">{errorsOf(place.error).map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}</Notice>}
          {isDraft && validation.data && (validation.data.errors.length > 0 || conflicts.length > 0) && (
            <Notice tone="warning">
              {validation.data.errors.length > 0 && <><p className="font-medium">Not ready to place against current stock:</p><ul className="list-disc pl-5">{validation.data.errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul></>}
              {conflicts.length > 0 && <><p className="mt-1 font-medium">Placing this hold takes stock reservations rely on. They are reallocated to other eligible stock where there is some, otherwise released (their orders show the shortage):</p>
                <ul className="list-disc pl-5">{conflicts.map((conflict) => <li key={conflict.lineId}>Line {conflict.lineNumber} · {conflict.sku}: {quantity(conflict.shortfall)} from {conflict.reservations.map((entry) => entry.number).join(", ")}</li>)}</ul></>}
            </Notice>
          )}
        </div>
      }
    >
      <Tabs defaultSelectedKey="overview">
        <TabList aria-label="Quality hold sections">
          <Tab id="overview">Overview</Tab><Tab id="stock">Stock</Tab><Tab id="tracking">Tracking</Tab><Tab id="reservations">Reservations</Tab><Tab id="review">Review</Tab>
          <Tab id="resolution">Resolution</Tab><Tab id="files">Attachments</Tab><Tab id="history">History</Tab>
        </TabList>
        <TabPanel id="overview">
          <PropertyList title="Quality hold" columns={3} items={[
            { label: "Hold type", value: head.holdTypeLabel },
            { label: "Reason", value: head.reason },
            { label: "Origin warehouse", value: `${head.originWarehouse} · ${head.originWarehouseName}` },
            { label: "Held now in", value: head.currentWarehouses },
            { label: "Source", value: head.source.href ? <Link className="text-brand hover:underline" href={head.source.href}>{head.source.number}</Link> : head.source.number ?? (head.source.type === "manual" ? "Manual" : "Existing stock") },
            { label: "Held", value: `${quantity(head.heldQuantity)} of ${quantity(head.originalQuantity)}` },
            { label: "Held value", value: head.heldValue !== undefined ? money(head.heldValue) : null },
            { label: "Reviewer", value: head.assignedUserName },
            { label: "Review due", value: head.reviewDueOn ? formatDate(head.reviewDueOn) : null },
            { label: "Placed", value: head.activatedAt ? `${formatDateTime(head.activatedAt)}${head.activatedByName ? ` by ${head.activatedByName}` : ""}` : "Not placed" },
            { label: "Created", value: `${formatDateTime(head.createdAt)}${head.createdByName ? ` by ${head.createdByName}` : ""}` },
            { label: "Notes", value: head.notes ? <span className="whitespace-pre-wrap">{head.notes}</span> : null, wide: true },
          ]} />
        </TabPanel>
        <TabPanel id="stock"><div className="flex flex-col gap-3 pt-4">
          <LinesTable columns={["Line", "SKU", "Item", "From", "Quantity", "Base", "Still held", "Hold disposition"]}>
            {data.lines.map((line) => <tr key={line.id}><Cell>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.itemName}</Cell><Cell>{line.sourceLocation}{line.batch ? ` · ${line.batch}` : ""}</Cell>
              <Cell>{quantity(line.quantity, line.uom)}</Cell><Cell>{quantity(line.baseQuantity, line.baseUom)}</Cell><Cell>{quantity(line.unresolved)}</Cell><Cell>{line.holdDisposition.replace("_", " ")}</Cell></tr>)}
          </LinesTable>
          {data.allocations.length > 0 && <LinesTable columns={["Warehouse", "Location", "Batch", "Serial", "Disposition", "Held", "Resolved", "Still held", "Status"]}>
            {data.allocations.map((allocation) => <tr key={allocation.id} className={allocation.status === "active" ? "" : "text-text-muted"}><Cell>{allocation.warehouse}</Cell><Cell>{allocation.location}</Cell>
              <Cell>{allocation.batch}{allocation.expiresOn ? <span className="block text-xs">expires {formatDate(allocation.expiresOn)}</span> : null}</Cell><Cell>{allocation.serial}</Cell><Cell>{allocation.dispositionLabel}</Cell>
              <Cell>{quantity(allocation.held)}</Cell><Cell>{quantity(allocation.resolved)}</Cell><Cell>{quantity(allocation.remaining)}</Cell><Cell>{allocation.status}</Cell></tr>)}
          </LinesTable>}
        </div></TabPanel>
        <TabPanel id="tracking"><div className="flex flex-col gap-2 pt-4 text-sm">
          {data.allocations.every((allocation) => !allocation.batch && !allocation.serial) ? <p className="text-text-muted">No batch or serial-numbered stock on this hold.</p>
            : data.allocations.filter((allocation) => allocation.batch || allocation.serial).map((allocation) => <p key={allocation.id}>{allocation.serial ? `Serial ${allocation.serial}` : `Batch ${allocation.batch}`} · {allocation.warehouse} / {allocation.location} · {allocation.dispositionLabel}{allocation.status !== "active" ? ` (${allocation.status})` : ""}</p>)}
        </div></TabPanel>
        <TabPanel id="reservations">
          <HistoryList title="Reservations affected" empty="No reservations were affected."
            entries={data.history.filter((entry) => entry.type.startsWith("reservation_")).map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor }))} />
        </TabPanel>
        <TabPanel id="review"><div className="pt-4"><Review detail={data} onDone={refresh} /></div></TabPanel>
        <TabPanel id="resolution"><div className="pt-4">
          {data.resolutions.length === 0 ? <p className="text-sm text-text-muted">Nothing held yet.</p> : <LinesTable columns={["When", "Outcome", "Quantity", "From", "To", "Document", "Reason", "By"]}>
            {data.resolutions.map((entry) => <tr key={entry.id}><Cell>{formatDateTime(entry.at)}</Cell><Cell>{entry.label}</Cell><Cell>{quantity(entry.quantity)}</Cell>
              <Cell>{entry.from ? `${entry.from.replace("_", " ")}${entry.fromLocation ? ` · ${entry.fromLocation}` : ""}` : null}</Cell><Cell>{entry.to ? `${entry.to.replace("_", " ")}${entry.toLocation ? ` · ${entry.toLocation}` : ""}` : null}</Cell>
              <Cell>{entry.movementId ? <Link className="text-brand hover:underline" href={`/inventory/stock-ledger/${entry.movementId}`}>{entry.document?.number ?? entry.movement}</Link> : entry.document?.number}</Cell>
              <Cell>{entry.reason}</Cell><Cell>{entry.by}</Cell></tr>)}
          </LinesTable>}
        </div></TabPanel>
        <TabPanel id="files"><div className="pt-4"><Files holdId={head.id} canAdd={can.files} /></div></TabPanel>
        <TabPanel id="history"><HistoryList entries={data.history.map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor }))} /></TabPanel>
      </Tabs>
    </RecordDetailsPage>
      {dialog === "cancel" && <CancelDialog id={head.id} onClose={() => setDialog(null)} onDone={(next) => { refresh(next); setDialog(null); }} />}
      {(dialog === "release" || dialog === "escalate" || dialog === "damage") && <ResolveDialog action={dialog} detail={data} held={dialog === "escalate" ? held.filter((allocation) => allocation.disposition === "quality_hold") : held}
        onClose={() => setDialog(null)} onDone={(next) => { refresh(next); setDialog(null); }} />}
    </>
  );
}

function CancelDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (data: HoldDetail) => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({ mutationFn: () => cancelHold(id, reason), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Cancel this draft">
      <div className="flex flex-col gap-3"><TextArea label="Reason (optional)" value={reason} onChange={setReason} />
        {cancel.isError && <p role="alert" className="text-sm text-danger">{errorMessage(cancel.error)}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Keep it</Button><Button variant="danger" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel draft</Button></div></div>
    </Dialog>
  );
}

const ACTION_COPY = {
  release: { title: "Release to available", button: "Release", help: "Moves the stock out of hold into available stock (sellable and reservable again). Quarantined stock needs the stronger release permission." },
  escalate: { title: "Escalate to quarantine", button: "Escalate", help: "Moves quality-held stock into quarantine: strongly restricted. On hand does not change." },
  damage: { title: "Move to damaged", button: "Move to damaged", help: "The stock stays on hand as damaged (never available) until it is disposed of or returned. No write-off." },
};

function ResolveDialog({ action, detail, held, onClose, onDone }: { action: "release" | "escalate" | "damage"; detail: HoldDetail; held: HoldAllocation[]; onClose: () => void; onDone: (data: HoldDetail) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "options"), queryFn: getHoldOptions, staleTime: 60_000 });
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(held.map((allocation) => [allocation.id, String(allocation.remaining)])));
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const copy = ACTION_COPY[action];
  const warehouses = [...new Set(held.map((allocation) => allocation.warehouseId))];
  const targets = warehouses.length === 1 ? (options.data?.warehouses.find((entry) => entry.id === warehouses[0])?.locations ?? [])
    .filter((location) => location.disposition === (action === "release" ? "available" : action === "escalate" ? "quarantined" : "damaged")) : [];
  const entries = held.map((allocation) => ({ allocationId: allocation.id, quantity: amounts[allocation.id] ?? "" })).filter((entry) => Number(entry.quantity) > 0);
  const resolve = useMutation({ mutationFn: () => resolveHold(detail.hold.id, { action, reason, decision: decision ?? undefined, targetLocationId: target, idempotencyKey: key, entries }), onSuccess: onDone });
  const total = entries.reduce((sum, entry) => sum + Number(entry.quantity), 0);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`${copy.title} · ${detail.hold.number}`} size="lg">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">{copy.help}</p>
        {held.map((allocation) => (
          <div key={allocation.id} className="flex flex-wrap items-end gap-2">
            <span className="flex-1">{allocation.warehouse} / {allocation.location}{allocation.batch ? ` · batch ${allocation.batch}` : ""}{allocation.serial ? ` · serial ${allocation.serial}` : ""} — {allocation.dispositionLabel}, {quantity(allocation.remaining)} held</span>
            {allocation.serial ? <Select aria-label="Include" selectedKey={amounts[allocation.id] === "1" ? "1" : "0"} onSelectionChange={(value) => setAmounts((current) => ({ ...current, [allocation.id]: String(value) }))}
              options={[{ value: "1", label: "Include" }, { value: "0", label: "Keep held" }]} />
              : <TextField aria-label="Quantity" inputMode="decimal" value={amounts[allocation.id] ?? ""} onChange={(value) => setAmounts((current) => ({ ...current, [allocation.id]: value }))} className="w-32" />}
          </div>
        ))}
        <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">Preview: {quantity(total)} out of {held[0]?.dispositionLabel.toLowerCase() ?? "hold"} → {action === "release" ? "available" : action === "escalate" ? "quarantined" : "damaged"}. On hand change: 0.</p>
        {targets.length > 0 && <Select label={action === "release" ? "Release into (optional)" : "Into (optional)"} selectedKey={target} onSelectionChange={(value) => setTarget(value ? String(value) : null)}
          options={targets.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} />}
        <Select label="Decision (optional)" selectedKey={decision} onSelectionChange={(value) => setDecision(value ? String(value) : null)} options={(options.data?.inspectionResults ?? []).map((entry) => ({ value: entry.id, label: entry.label }))} />
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        {resolve.isError && <p role="alert" className="text-danger">{errorMessage(resolve.error)}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant={action === "release" ? "primary" : "danger"} isDisabled={!reason.trim() || !entries.length} isLoading={resolve.isPending} onPress={() => resolve.mutate()}>{copy.button}</Button></div>
      </div>
    </Dialog>
  );
}

function Review({ detail, onDone }: { detail: HoldDetail; onDone: (data: HoldDetail) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "options"), queryFn: getHoldOptions, staleTime: 60_000 });
  const head = detail.hold;
  const [reviewer, setReviewer] = useState<string | null>(head.assignedUserId);
  const [due, setDue] = useState(head.reviewDueOn ?? "");
  const [notes, setNotes] = useState(head.inspectionNotes ?? "");
  const [result, setResult] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => reviewHold(head.id, { assignedUserId: reviewer, reviewDueOn: due || null, inspectionNotes: notes || null, inspectionResult: result ?? undefined }), onSuccess: onDone });
  return (
    <div className="flex max-w-2xl flex-col gap-3 text-sm">
      <p>{head.inspectionResult ? `Decision: ${head.inspectionResult.replace("_", " ")}${head.decisionAt ? ` (${formatDateTime(head.decisionAt)})` : ""}` : "No decision recorded yet."} A decision moves no stock: release, escalate or move to damaged does.</p>
      {head.overdue && <p className="font-medium text-danger">The review is overdue. The stock stays held until someone decides.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Reviewer" selectedKey={reviewer} onSelectionChange={(value) => setReviewer(value ? String(value) : null)} options={(options.data?.reviewers ?? []).map((entry) => ({ value: entry.id, label: entry.name }))} />
        <TextField label="Review due" type="date" value={due} onChange={setDue} />
        <Select label="Decision" selectedKey={result} onSelectionChange={(value) => setResult(value ? String(value) : null)} options={(options.data?.inspectionResults ?? []).map((entry) => ({ value: entry.id, label: entry.label }))} />
      </div>
      <TextArea label="Inspection notes" value={notes} onChange={setNotes} />
      {save.isError && <p role="alert" className="text-danger">{errorMessage(save.error)}</p>}
      {detail.capabilities.review && <div><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save review</Button></div>}
    </div>
  );
}

function Files({ holdId, canAdd }: { holdId: string; canAdd: boolean }) {
  const workspace = useWorkspaceContext();
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "files", holdId), queryFn: () => listHoldFiles(holdId) });
  const upload = useMutation({ mutationFn: (file: File) => uploadHoldFile(holdId, file), onSuccess: () => void files.refetch() });
  return (
    <div className="flex flex-col gap-2 text-sm">
      {(files.data ?? []).length === 0 ? <p className="text-text-muted">No files yet.</p> : <ul className="flex flex-col gap-1">{files.data!.map((file) => <li key={file.id}><a className="text-brand hover:underline" href={holdFileUrl(holdId, file.id)}>{file.fileName}</a></li>)}</ul>}
      {canAdd && <label className="text-sm">Add inspection report, photo or certificate: <input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /></label>}
      {upload.isError && <p role="alert" className="text-danger">{errorMessage(upload.error)}</p>}
    </div>
  );
}
