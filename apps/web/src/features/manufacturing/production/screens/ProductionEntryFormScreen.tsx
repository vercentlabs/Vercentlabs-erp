"use client";

// New (or draft) production entry for one order: the batch it belongs to, the quantity produced in a unit of the finished item, when, and
// notes. With inspection required everything waits for a quality decision; otherwise the operator may split it. The BOM, components and
// stock are never re-entered. "Save draft" counts nowhere; the entry's page posts it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSubmitKey } from "@/shared/http/submit-once";

import { itemUnits } from "@/features/manufacturing/boms/api/bom-api";
import { MO_BASE, errorMessage, errorStatus, getOrder, newKey, qty, type MoOrder } from "@/features/manufacturing/orders/api/mo-api";
import { PE_BASE, createEntryDraft, getEntry, openBatch, productionProgress, updateEntry, type Entry, type Progress } from "../api/pp-api";

const local = (iso: string | Date) => { const date = new Date(iso); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
type Form = { batch: string; newBatch: string; quantity: string; uomId: string; producedAt: string; notes: string; accepted: string; rejected: string; pending: string; rejectionReason: string };

export function ProductionEntryFormScreen({ orderId, entryId }: { orderId?: string; entryId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-entry", entryId ?? ""), queryFn: () => getEntry(entryId!), enabled: Boolean(entryId) });
  const id = orderId ?? existing.data?.order.id;
  const order = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order", id ?? ""), queryFn: () => getOrder(id!), enabled: Boolean(id) });
  const progress = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production", id ?? ""), queryFn: () => productionProgress(id!), enabled: Boolean(id) });
  if (!orderId && !entryId) return <ErrorState title="Choose a manufacturing order" description="Record production from the order's Production tab." />;
  if ((entryId && existing.isLoading) || order.isLoading || progress.isLoading) return <LoadingState label="Loading the order" rows={5} />;
  const failure = existing.error ?? order.error ?? progress.error;
  if (failure || !order.data || !progress.data) {
    if (errorStatus(failure) === 403) return <PermissionState title="You don't have access to production" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order" description={errorMessage(failure)} />;
  }
  return <EntryForm order={order.data} progress={progress.data} existing={existing.data ?? null} />;
}

function EntryForm({ order, progress, existing }: { order: MoOrder; progress: Progress; existing: Entry | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = progress.batches.filter((row) => row.status === "OPEN");
  const [form, setForm] = useState<Form>(() => ({ batch: existing?.batchId ?? open[open.length - 1]?.id ?? "new", newBatch: `${order.number}-B${String(progress.batches.length + 1).padStart(2, "0")}`,
    quantity: existing?.entered ?? (existing ? existing.reported : ""), uomId: order.outputUomId, producedAt: local(existing?.producedAt ?? new Date()), notes: existing?.notes ?? "",
    accepted: existing && !order.settings.requireInspection ? existing.split.accepted : "", rejected: existing && Number(existing.split.rejected) ? existing.split.rejected : "",
    pending: existing && Number(existing.split.pending) && !order.settings.requireInspection ? existing.split.pending : "", rejectionReason: existing?.rejectionReason ?? "" }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", order.finishedItem.id), queryFn: () => itemUnits(order.finishedItem.id), staleTime: 60_000 });
  const set = <K extends keyof Form>(field: K, value: Form[K]) => setForm((current) => ({ ...current, [field]: value }));
  const batch = progress.batches.find((row) => row.id === form.batch);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const split = order.settings.requireInspection ? {} : Object.fromEntries([["acceptedQuantity", form.accepted], ["rejectedQuantity", form.rejected], ["pendingQuantity", form.pending]].filter(([, value]) => String(value).trim()));
      const input = { quantity: form.quantity, uomId: form.uomId, producedAt: form.producedAt ? new Date(form.producedAt).toISOString() : undefined, notes: form.notes.trim() || undefined,
        rejectionReason: form.rejectionReason.trim() || undefined, ...split, ...(form.batch === "new" ? { batchReference: form.newBatch.trim() } : { productionBatchId: form.batch }) };
      // The batch and the entry are one save: a retry after the entry failed replays the batch it already opened.
      const targetId = await submitKey.run(async () => {
        if (existing) {
          await updateEntry(existing.id, { ...input, expectedVersion: existing.rowVersion });
          return existing.id;
        }
        if (form.batch === "new") {
          const opened = await openBatch(order.id, { batchReference: form.newBatch.trim() });
          return (await createEntryDraft(order.id, { ...input, batchReference: undefined, productionBatchId: opened.batch.id, idempotencyKey: key })).entry.id;
        }
        return (await createEntryDraft(order.id, { ...input, idempotencyKey: key })).entry.id;
      });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${PE_BASE}/${targetId}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  const q = progress.quantities;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing ? `Edit ${existing.number}` : "Record production"}
        description={`${order.number} · ${order.finishedItem.name}. Target ${qty(q.planned)} · accepted ${qty(q.accepted)} · remaining ${qty(q.remaining)}. Reporting output receives nothing and consumes no material.`} />
      {!["RELEASED", "IN_PROGRESS"].includes(order.status) && <Notice tone="warning">{order.number} is {order.statusLabel.toLowerCase()}: production entries are prepared while it is released or in progress.</Notice>}
      {order.status === "RELEASED" && <Notice tone="neutral">The order is released but not started: a draft can be prepared; start production before posting it.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Output">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Production batch" selectedKey={form.batch} onSelectionChange={(value) => set("batch", String(value))}
            options={[...open.map((row) => ({ value: row.id, label: `${row.reference}${row.planned ? ` · ${qty(row.reported)} of ${qty(row.planned)}` : ` · ${qty(row.reported)} reported`}` })), ...(existing ? [] : [{ value: "new", label: "New batch…" }])]} />
          {form.batch === "new" ? <TextField label="New batch reference" value={form.newBatch} onChange={(value) => set("newBatch", value)} maxLength={120} />
            : <TextField label="Batch" isDisabled value={batch ? `${batch.reference}${batch.location ? ` · ${batch.location}` : ""}` : ""} />}
          <div className="flex gap-2">
            <TextField label="Quantity produced" inputMode="decimal" className="w-40" value={form.quantity} onChange={(value) => set("quantity", value)} />
            <Select label="Unit" selectedKey={form.uomId} onSelectionChange={(value) => set("uomId", String(value))}
              options={(units.data?.units ?? [{ uomId: order.outputUomId, code: order.outputUom }]).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
          </div>
          <TextField label="Produced at" type="datetime-local" value={form.producedAt} onChange={(value) => set("producedAt", value)} />
        </div>
        {order.settings.requireInspection ? <p className="text-xs text-text-muted">Every unit waits for a quality decision before it is accepted.</p> : (
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField label="Accepted (optional)" inputMode="decimal" value={form.accepted} onChange={(value) => set("accepted", value)} />
            <TextField label="Rejected" inputMode="decimal" value={form.rejected} onChange={(value) => set("rejected", value)} />
            <TextField label="Awaiting inspection" inputMode="decimal" value={form.pending} onChange={(value) => set("pending", value)} />
            <TextField label="Rejection reason" value={form.rejectionReason} onChange={(value) => set("rejectionReason", value)} />
          </div>
        )}
        <TextArea label="Notes" value={form.notes} onChange={(value) => set("notes", value)} maxLength={1000} />
      </Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={() => router.replace(existing ? `${PE_BASE}/${existing.id}` : `${MO_BASE}/${order.id}?tab=production`)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!(Number(form.quantity) > 0) || !["RELEASED", "IN_PROGRESS"].includes(order.status)} onPress={save}>Save draft</Button>
      </div>
    </div>
  );
}
