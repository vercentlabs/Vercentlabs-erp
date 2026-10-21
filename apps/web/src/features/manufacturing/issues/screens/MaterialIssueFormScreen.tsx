"use client";

// New (or draft) material issue note for one manufacturing order. It starts from what the order may still issue — each material with its
// requirement, what is issued, reserved for the order and free — so the storekeeper enters quantities and stock, never rebuilds the recipe.
// A material can be left out (a partial issue keeps the other lines). Batches are taken earliest expiry first unless one is named; serial
// units are chosen one by one. "Save draft" moves nothing; the note's own page checks and posts it.
import { useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSubmitKey } from "@/shared/http/submit-once";

import { itemUnits } from "@/features/manufacturing/boms/api/bom-api";
import { MO_BASE, errorMessage, errorStatus, newKey, qty } from "@/features/manufacturing/orders/api/mo-api";
import { MI_BASE, createIssue, getIssue, issuable, updateIssue, type Issuable, type MaterialIssue } from "../api/mi-api";

type Row = { materialId: string; include: boolean; quantity: string; uomId: string; batchId: string | null; serialIds: string[] };
type Material = Issuable["materials"][number];

export function MaterialIssueFormScreen({ orderId, issueId }: { orderId?: string; issueId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-issue", issueId ?? ""), queryFn: () => getIssue(issueId!), enabled: Boolean(issueId) });
  const order = orderId ?? existing.data?.order.id;
  const materials = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "issuable", order ?? ""), queryFn: () => issuable(order!), enabled: Boolean(order) });
  if (!orderId && !issueId) return <ErrorState title="Choose a manufacturing order" description="Start a material issue from the order's Materials tab." />;
  if ((issueId && existing.isLoading) || materials.isLoading) return <LoadingState label="Loading what the order may issue" rows={6} />;
  const failure = existing.error ?? materials.error;
  if (failure || !materials.data) {
    if (errorStatus(failure) === 403) return <PermissionState title="You don't have access to material issues" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order's materials" description={errorMessage(failure)} />;
  }
  return <IssueForm data={materials.data} existing={existing.data ?? null} />;
}

function initialRows(data: Issuable, existing: MaterialIssue | null): Row[] {
  return data.materials.map((material) => {
    const line = existing?.lines.find((row) => row.materialId === material.materialId);
    if (line) return { materialId: material.materialId, include: true, quantity: line.quantity, uomId: line.uomId, batchId: line.batch?.id ?? null, serialIds: line.serials.map((serial) => serial.id) };
    const remaining = Number(material.remainingToIssue);
    return { materialId: material.materialId, include: !existing && remaining > 0, quantity: remaining > 0 ? material.remainingToIssue : "", uomId: material.uomId, batchId: null, serialIds: [] };
  });
}

function IssueForm({ data, existing }: { data: Issuable; existing: MaterialIssue | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => initialRows(data, existing));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [receivedBy, setReceivedBy] = useState(existing?.receivedBy ?? "");
  const [reason, setReason] = useState(existing?.issueReason ?? "NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const set = (materialId: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.materialId === materialId ? { ...row, ...patch } : row)));
  const chosen = rows.filter((row) => row.include && Number(row.quantity) > 0);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const lines = chosen.map((row) => ({ materialId: row.materialId, quantity: row.quantity, uomId: row.uomId, batchId: row.batchId, serialIds: row.serialIds.length ? row.serialIds : undefined }));
      const input = { lines, notes: notes.trim() || undefined, receivedBy: receivedBy.trim() || undefined, issueReason: reason };
      const saved = await submitKey.run(async () => existing ? await updateIssue(existing.id, { ...input, expectedVersion: existing.rowVersion })
        : await createIssue({ ...input, manufacturingOrderId: data.orderId, idempotencyKey: key }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${MI_BASE}/${saved.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing ? `Edit ${existing.number}` : "New material issue"}
        description={`${data.orderNumber} · ${data.orderStatusLabel}. Saving keeps a draft: no stock moves until the note is posted.`} />
      {!data.eligible && <Notice tone="warning">{data.reason}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Materials" description={`Remaining is what the order may still issue; more needs an approval${Number(data.tolerancePct) ? ` beyond the company's ${qty(data.tolerancePct)}% tolerance` : ""}. Reserved stock for this order is taken first${data.unreservedAllowed ? ", then free usable stock" : "; the company issues only reserved stock"}.`}>
        <LinesTable columns={["", "Material", { label: "Required", numeric: true }, { label: "Issued", numeric: true }, { label: "Remaining", numeric: true }, { label: "Reserved", numeric: true },
          { label: "Free", numeric: true }, "Issue now", "Stock"]}>
          {data.materials.map((material) => {
            const row = rows.find((entry) => entry.materialId === material.materialId)!;
            return <MaterialRow key={material.materialId} material={material} row={row} onChange={(patch) => set(material.materialId, patch)} />;
          })}
        </LinesTable>
      </Panel>
      <Panel title="Note">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Reason" selectedKey={reason} onSelectionChange={(value) => setReason(String(value))}
            options={[{ value: "NORMAL", label: "Normal production" }, { value: "EXTRA_MATERIAL", label: "Extra material" }, { value: "REPLACEMENT", label: "Replacement" }, { value: "CORRECTION", label: "Correction" }]} />
          <TextField label="Received by (production)" value={receivedBy} onChange={setReceivedBy} maxLength={200} />
        </div>
        <TextArea label="Notes" value={notes} onChange={setNotes} maxLength={1000} />
      </Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={() => router.replace(existing ? `${MI_BASE}/${existing.id}` : `${MO_BASE}/${data.orderId}?tab=materials`)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!chosen.length || !data.eligible} onPress={save}>Save draft</Button>
      </div>
    </div>
  );
}

function MaterialRow({ material, row, onChange }: { material: Material; row: Row; onChange: (patch: Partial<Row>) => void }) {
  const workspace = useWorkspaceContext();
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", material.itemId), queryFn: () => itemUnits(material.itemId), enabled: row.include, staleTime: 60_000 });
  const batches = material.stock.filter((part) => part.batchId);
  const over = row.include && Number(row.quantity) > Number(material.remainingToIssue) && row.uomId === material.uomId;
  return (
    <tr>
      <Cell><Checkbox aria-label={`Issue ${material.code}`} isSelected={row.include} onChange={(value) => onChange({ include: value })} /></Cell>
      <Cell><span className="flex flex-col"><span>{material.code} · {material.name}</span>
        <span className="text-xs text-text-muted">{material.uom}{material.trackingType !== "none" ? ` · ${material.trackingType}-tracked` : ""}{material.kind === "SUBASSEMBLY" ? " · subassembly" : ""}{material.origin === "EXTRA" ? " · extra" : ""}</span></span></Cell>
      <Cell numeric>{qty(material.required)}</Cell><Cell numeric>{qty(material.netIssued)}</Cell><Cell numeric>{qty(material.remainingToIssue)}</Cell>
      <Cell numeric>{qty(material.reservedForOrder)}</Cell><Cell numeric>{qty(material.freeEligible)}</Cell>
      <Cell>{row.include && (
        <span className="flex flex-col gap-1">
          <span className="flex gap-1">
            <TextField aria-label={`${material.code} quantity`} size="compact" inputMode="decimal" className="w-24" value={row.quantity} onChange={(value) => onChange({ quantity: value })} />
            <Select aria-label={`${material.code} unit`} size="compact" selectedKey={row.uomId} onSelectionChange={(value) => onChange({ uomId: String(value) })}
              options={(units.data?.units ?? [{ uomId: material.uomId, code: material.uom }]).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
          </span>
          {over && <StatusBadge tone="warning">Beyond remaining: needs approval</StatusBadge>}
        </span>
      )}</Cell>
      <Cell>{row.include && material.trackingType === "batch" && (
        <Select aria-label={`${material.code} batch`} size="compact" selectedKey={row.batchId ?? "fefo"} onSelectionChange={(value) => onChange({ batchId: value === "fefo" ? null : String(value) })}
          options={[{ value: "fefo", label: "Earliest expiry first" }, ...batches.map((part) => ({ value: part.batchId!, label: `${part.batch} · ${qty(part.free)} free${Number(part.reservedForOrder) ? ` · ${qty(part.reservedForOrder)} held` : ""}${part.expiresOn ? ` · exp ${formatDate(part.expiresOn)}` : ""}` }))]} />
      )}
      {row.include && material.trackingType === "serial" && (
        <span className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {(material.serials ?? []).length === 0 && <span className="text-xs text-text-muted">No serial units on hand here.</span>}
          {(material.serials ?? []).map((serial) => (
            <Checkbox key={serial.id} isSelected={row.serialIds.includes(serial.id)}
              onChange={(value) => { const serialIds = value ? [...row.serialIds, serial.id] : row.serialIds.filter((id) => id !== serial.id); onChange({ serialIds, quantity: String(serialIds.length) }); }}>
              {serial.number}{serial.location ? ` · ${serial.location}` : ""}{serial.reservedForOrder ? " · reserved for this order" : ""}
            </Checkbox>
          ))}
        </span>
      )}
      {row.include && material.trackingType === "none" && <span className="text-xs text-text-muted">{material.stock.map((part) => `${part.location ?? "—"} ${qty(part.free)}`).join(", ") || "No usable stock"}</span>}
      </Cell>
    </tr>
  );
}
