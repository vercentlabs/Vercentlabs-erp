"use client";

// Create or edit a draft quality hold: the warehouse, quality hold or quarantine, the reason, reviewer and review date, and the stock to hold —
// per line the item, the position it is taken from (location and batch), the quantity or the serial numbers, and optionally the quality location
// it goes to (else the warehouse's own). Saving keeps a draft: no stock moves until the hold is placed.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, ComboBox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { getAvailability } from "@/features/goods-issues/api/goods-issues-api";
import { useInvOptions } from "@/features/inventory/shared/client";
import { quantity } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { QUALITY_HOLDS_BASE, createHold, errorMessage, errorsOf, getHold, getHoldOptions, updateHold, type HoldDetail, type HoldOptions, type HoldType } from "../api/quality-holds-api";

type Line = { key: string; itemId: string; position: string; quantity: string; serialIds: string[]; targetLocationId: string; notes: string };
const positionKey = (locationId: string | null, batchId: string | null) => `${locationId ?? "main"}|${batchId ?? "-"}`;
const readPosition = (key: string) => { const [location, batch] = key.split("|"); return { sourceLocationId: location === "main" ? null : location, batchId: batch === "-" ? null : batch }; };

export type HoldPrefill = { itemId?: string; warehouseId?: string; locationId?: string; batchId?: string; serialId?: string };
export function QualityHoldFormScreen({ holdId, prefill }: { holdId?: string; prefill?: HoldPrefill }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "options"), queryFn: getHoldOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "detail", holdId), queryFn: () => getHold(holdId!), enabled: Boolean(holdId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading quality hold" rows={4} />;
  if (!options.data || (holdId && !existing.data)) return <ErrorState title="Could not load the quality hold" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.hold.status !== "draft") return <ErrorState title="This hold has been placed" description="A placed hold is released, escalated or resolved — never edited." />;
  return <Form options={options.data} existing={existing.data ?? null} prefill={prefill} />;
}

function Form({ options, existing, prefill }: { options: HoldOptions; existing: HoldDetail | null; prefill?: HoldPrefill }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const inv = useInvOptions();
  const saved = existing?.hold;
  const [warehouseId, setWarehouseId] = useState(saved?.originWarehouseId ?? (prefill?.warehouseId && options.warehouses.some((entry) => entry.id === prefill.warehouseId) ? prefill.warehouseId : undefined)
    ?? options.warehouses.find((entry) => entry.isDefault)?.id ?? options.warehouses[0]?.id ?? "");
  const [holdType, setHoldType] = useState<HoldType>(saved?.holdType ?? "quality_hold");
  const [reasonId, setReasonId] = useState<string | null>(saved?.reasonId ?? null);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(saved?.assignedUserId ?? null);
  const [reviewDueOn, setReviewDueOn] = useState(saved?.reviewDueOn ?? "");
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.map((line) => ({ key: line.id, itemId: line.itemId, position: positionKey(line.sourceLocationId, line.batchId),
    quantity: String(line.quantity), serialIds: line.serialIds, targetLocationId: line.targetLocationId ?? "", notes: line.notes ?? "" }))
    ?? [{ ...blank(), itemId: prefill?.itemId ?? "", position: prefill?.itemId && (prefill.locationId || prefill.batchId) ? positionKey(prefill.locationId ?? null, prefill.batchId ?? null) : "",
      serialIds: prefill?.serialId ? [prefill.serialId] : [] }]);
  const warehouse = options.warehouses.find((entry) => entry.id === warehouseId);
  const items = inv.data?.items ?? [];
  const availability = useQueries({ queries: lines.map((line) => ({ queryKey: scopedQueryKey(workspace, "quality-holds", "availability", warehouseId, line.itemId),
    queryFn: () => getAvailability(warehouseId, line.itemId), enabled: Boolean(warehouseId && line.itemId) })) });
  const disposition = holdType === "quarantine" ? "quarantined" : "quality_hold";
  const targets = (warehouse?.locations ?? []).filter((location) => location.disposition === disposition);
  const change = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const reason = options.reasons.find((entry) => entry.id === reasonId);
  const save = useMutation({
    mutationFn: () => {
      const input = { holdType, reasonId: reasonId ?? "", warehouseId, assignedUserId, reviewDueOn: reviewDueOn || null, notes: notes || null,
        lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, quantity: line.quantity, ...readPosition(line.position), serialIds: line.serialIds.length ? line.serialIds : undefined,
          targetLocationId: line.targetLocationId || null, notes: line.notes || undefined })) };
      return existing ? updateHold(existing.hold.id, { ...input, expectedVersion: existing.hold.version }) : createHold(input);
    },
    onSuccess: (detail) => router.push(`${QUALITY_HOLDS_BASE}/${detail.hold.id}`),
  });
  return (
    <RecordFormPage
      header={{
        title: saved ? `Edit ${saved.number}` : "New quality hold",
        description: "Saving keeps a draft: no stock moves. Open the draft to check it against current stock and place the stock on hold.",
      }}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `${QUALITY_HOLDS_BASE}/${saved.id}` : QUALITY_HOLDS_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save draft</Button>
        </>
      }
      banner={save.isError ? <Notice>{errorMessage(save.error)}
        {errorsOf(save.error).length > 1 && <ul className="mt-1 list-disc pl-5">{errorsOf(save.error).map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}</Notice> : undefined}
    >
      <FormSection title="Quality hold" columns={1}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Warehouse" isRequired selectedKey={warehouseId || null} onSelectionChange={(key) => { setWarehouseId(String(key)); setLines((current) => current.map((line) => ({ ...line, position: "", serialIds: [], targetLocationId: "" }))); }}
          options={options.warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
        <Select label="Hold type" isRequired selectedKey={holdType} onSelectionChange={(key) => { setHoldType(String(key) as HoldType); setLines((current) => current.map((line) => ({ ...line, targetLocationId: "" }))); }}
          options={options.holdTypes.filter((entry) => (entry.id === "quarantine" ? options.capabilities.placeQuarantine || options.capabilities.create : true)).map((entry) => ({ value: entry.id, label: entry.label }))}
          description={holdType === "quarantine" ? "Suspected defective, unsafe or recalled: strongly isolated; releasing it needs a stronger permission." : "Awaiting inspection, documents or a decision."} />
        <Select label="Reason" isRequired selectedKey={reasonId} onSelectionChange={(key) => { setReasonId(key ? String(key) : null); const chosen = options.reasons.find((entry) => entry.id === key); if (chosen && !saved) setHoldType(chosen.defaultHoldType); }}
          options={options.reasons.map((entry) => ({ value: entry.id, label: entry.name }))} />
        <Select label="Reviewer" selectedKey={assignedUserId} onSelectionChange={(key) => setAssignedUserId(key ? String(key) : null)} options={options.reviewers.map((entry) => ({ value: entry.id, label: entry.name }))} />
        <TextField label="Review due" type="date" value={reviewDueOn} onChange={setReviewDueOn} description={reason?.defaultReviewDays != null && !reviewDueOn ? `Default: ${reason.defaultReviewDays} days` : undefined} />
        <TextArea label={reason?.requiresNotes ? "Notes (required)" : "Notes"} value={notes} onChange={setNotes} />
      </div>
      </FormSection>
      <FormSection title="Stock to hold" description="The items, quantities and locations put on hold." columns={1}>
        {lines.map((line, index) => {
          const item = items.find((entry) => entry.id === line.itemId);
          const data = availability[index]?.data;
          const positions = (data?.positions ?? []).filter((position) => position.onHand > 0 && ["available", "quality_hold"].includes(position.disposition) && position.disposition !== disposition);
          const chosen = readPosition(line.position || "main|-");
          const serials = (data?.serials ?? []).filter((serial) => (serial.locationId ?? null) === chosen.sourceLocationId);
          return (
            <div key={line.key} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <ComboBox label={`Line ${index + 1} item`} selectedKey={line.itemId || null} placeholder="Search SKU or name"
                  options={items.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} onSelectionChange={(key) => change(line.key, { itemId: key ? String(key) : "", position: "", serialIds: [] })} />
                <Select label="From" selectedKey={line.position || null} onSelectionChange={(key) => change(line.key, { position: String(key), serialIds: [] })}
                  options={positions.map((position) => ({ value: positionKey(position.locationId, position.batchId), label: `${position.location}${position.batch ? ` · ${position.batch}` : ""} · ${position.disposition === "available" ? `${quantity(position.available)} available, ${quantity(position.reserved)} reserved` : `${quantity(position.onHand)} on quality hold`}` }))} />
                {item?.tracking_type === "serial" ? <span className="text-sm text-text-muted self-end">{line.serialIds.length} serial number{line.serialIds.length === 1 ? "" : "s"} chosen</span>
                  : <TextField label={`Quantity (${item?.base_uom ?? "base unit"})`} inputMode="decimal" value={line.quantity} onChange={(value) => change(line.key, { quantity: value })} />}
                <Select label="Into (optional)" selectedKey={line.targetLocationId || null} onSelectionChange={(key) => change(line.key, { targetLocationId: key ? String(key) : "" })}
                  options={targets.map((location) => ({ value: location.id, label: `${location.code} · ${location.name}` }))} description={targets.length ? undefined : "The warehouse's own location is created on placing."} />
              </div>
              {item?.tracking_type === "serial" && (
                <div className="flex flex-wrap gap-3">{serials.map((serial) => (
                  <Checkbox key={serial.id} isSelected={line.serialIds.includes(serial.id)} onChange={(selected) => change(line.key, { serialIds: selected ? [...line.serialIds, serial.id] : line.serialIds.filter((id) => id !== serial.id) })}>
                    {serial.serialNumber}{serial.reserved ? " (reserved)" : ""}</Checkbox>))}
                  {!serials.length && <span className="text-sm text-text-muted">No serial numbers in stock there.</span>}</div>
              )}
              <div className="flex items-end gap-2">
                <TextField label="Line notes" value={line.notes} onChange={(value) => change(line.key, { notes: value })} className="flex-1" />
                {lines.length > 1 && <Button variant="secondary" aria-label="Remove line" onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}><Trash2 className="size-4" aria-hidden="true" /></Button>}
              </div>
            </div>
          );
        })}
        <div><Button variant="secondary" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add line</Button></div>
      </FormSection>
    </RecordFormPage>
  );
}

const blank = (): Line => ({ key: crypto.randomUUID(), itemId: "", position: "", quantity: "", serialIds: [], targetLocationId: "", notes: "" });
