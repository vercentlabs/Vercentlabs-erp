"use client";

// Record (or edit) material consumption for one order in production. It loads what the order's production actually holds — material issued
// and not yet used, scrapped or returned — so the operator never rebuilds the BOM. Optionally name the production entry or the output made:
// the BOM's expected usage is then shown beside each line (a suggestion to copy, never posted on its own). Batches and serial units come only
// from what was issued. "Save draft" changes nothing; the note's page reviews it against the BOM and posts it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSubmitKey } from "@/shared/http/submit-once";

import { itemUnits } from "@/features/manufacturing/boms/api/bom-api";
import { MO_BASE, errorMessage, errorStatus, newKey, qty } from "@/features/manufacturing/orders/api/mo-api";
import { MC_BASE, consumable, createConsumption, getConsumption, updateConsumption, type Consumable, type Consumption } from "../api/mc-api";

type Row = { materialId: string; include: boolean; quantity: string; uomId: string; batchId: string | null; serialIds: string[] };
type Material = Consumable["materials"][number];
type Header = { productionEntryId: string | null; outputBasisQuantity: string; productionBatchReference: string; notes: string };

export function MaterialConsumptionFormScreen({ orderId, consumptionId }: { orderId?: string; consumptionId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-consumption", consumptionId ?? ""), queryFn: () => getConsumption(consumptionId!), enabled: Boolean(consumptionId) });
  const order = orderId ?? existing.data?.order.id;
  const materials = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "consumable", order ?? ""), queryFn: () => consumable(order!), enabled: Boolean(order) });
  if (!orderId && !consumptionId) return <ErrorState title="Choose a manufacturing order" description="Record consumption from the order's Materials tab." />;
  if ((consumptionId && existing.isLoading) || materials.isLoading) return <LoadingState label="Loading what production holds" rows={6} />;
  const failure = existing.error ?? materials.error;
  if (failure || !materials.data) {
    if (errorStatus(failure) === 403) return <PermissionState title="You don't have access to material consumption" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order's materials" description={errorMessage(failure)} />;
  }
  return <ConsumptionForm data={materials.data} existing={existing.data ?? null} />;
}

function initialRows(data: Consumable, existing: Consumption | null): Row[] {
  return data.materials.map((material) => {
    const line = existing?.lines.find((row) => row.materialId === material.materialId);
    if (line) return { materialId: material.materialId, include: true, quantity: line.quantity, uomId: line.uomId, batchId: line.batch?.id ?? null, serialIds: line.serials.map((serial) => serial.id) };
    return { materialId: material.materialId, include: false, quantity: "", uomId: material.uomId, batchId: null, serialIds: [] };
  });
}

function ConsumptionForm({ data, existing }: { data: Consumable; existing: Consumption | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => initialRows(data, existing));
  const [head, setHead] = useState<Header>(() => ({ productionEntryId: existing?.production.entry?.id ?? null, outputBasisQuantity: existing?.production.entry ? "" : existing?.production.outputBasis ?? "",
    productionBatchReference: existing?.production.batchReference ?? "", notes: existing?.notes ?? "" }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const entry = data.productionEntries.find((row) => row.id === head.productionEntryId);
  const basis = head.outputBasisQuantity.trim() || entry?.reported || "";
  const suggestion = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "consumable", data.orderId, basis), queryFn: () => consumable(data.orderId, basis),
    enabled: Number(basis) > 0, staleTime: 30_000 });
  const suggested = (materialId: string) => suggestion.data?.materials.find((row) => row.materialId === materialId)?.suggestion ?? null;
  const set = (materialId: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.materialId === materialId ? { ...row, ...patch } : row)));
  const chosen = rows.filter((row) => row.include && Number(row.quantity) > 0);
  const held = data.materials.filter((row) => Number(row.inCustody) > 0);
  const empty = data.materials.filter((row) => Number(row.inCustody) <= 0);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const lines = chosen.map((row) => ({ materialId: row.materialId, quantity: row.quantity, uomId: row.uomId, batchId: row.batchId, serialIds: row.serialIds.length ? row.serialIds : undefined }));
      const input = { lines, productionEntryId: head.productionEntryId, outputBasisQuantity: head.outputBasisQuantity.trim() || null, productionBatchReference: head.productionBatchReference.trim() || undefined,
        notes: head.notes.trim() || undefined };
      const saved = await submitKey.run(async () => existing ? await updateConsumption(existing.id, { ...input, expectedVersion: existing.rowVersion })
        : await createConsumption({ ...input, manufacturingOrderId: data.orderId, idempotencyKey: key }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${MC_BASE}/${saved.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  const row = (material: Material) => <MaterialRow key={material.materialId} material={material} row={rows.find((entry) => entry.materialId === material.materialId)!}
    suggestion={suggested(material.materialId)} onChange={(patch) => set(material.materialId, patch)} />;
  const columns = ["", "Material", { label: "Issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped / returned", numeric: true }, { label: "In production", numeric: true },
    { label: "BOM expects", numeric: true }, "Used now", "Stock"];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing ? `Edit ${existing.number}` : "Record material consumption"}
        description={`${data.orderNumber} · ${data.orderStatusLabel} · made so far ${qty(data.reportedOutput)} of ${qty(data.plannedOutput)}. Saving keeps a draft: nothing leaves production custody until it is posted.`} />
      {!data.eligible && <Notice tone="warning">{data.reason}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Recorded against" description="Name the output this usage made to compare it with the BOM. Leave both empty to record usage without a comparison.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Production entry" selectedKey={head.productionEntryId ?? "none"} onSelectionChange={(value) => setHead({ ...head, productionEntryId: value === "none" ? null : String(value) })}
            options={[{ value: "none", label: "None" }, ...data.productionEntries.map((row) => ({ value: row.id, label: `${row.number} · ${qty(row.reported)} reported${row.batchReference ? ` · ${row.batchReference}` : ""}` }))]} />
          <TextField label="Output made (units)" description={entry ? `Leave empty to use the entry's ${qty(entry.reported)}.` : undefined} inputMode="decimal" value={head.outputBasisQuantity}
            onChange={(value) => setHead({ ...head, outputBasisQuantity: value })} />
          <TextField label="Production batch" value={head.productionBatchReference} onChange={(value) => setHead({ ...head, productionBatchReference: value })} maxLength={120} />
        </div>
        {Number(basis) > 0 && (
          <div className="flex justify-end"><Button size="compact" variant="ghost" onPress={() => setRows((current) => current.map((entryRow) => {
            const value = suggested(entryRow.materialId);
            const material = data.materials.find((row) => row.materialId === entryRow.materialId)!;
            return value && Number(value) > 0 && Number(material.inCustody) > 0 && material.trackingType === "none" ? { ...entryRow, include: true, quantity: value, uomId: material.uomId } : entryRow;
          }))}>Copy the BOM&rsquo;s expectation into Used now</Button></div>
        )}
      </Panel>
      <Panel title="In production" description="Material issued to this order and not yet used, scrapped or returned. Enter what was actually used.">
        {held.length ? <LinesTable columns={columns}>{held.map(row)}</LinesTable> : <p className="text-sm text-text-muted">Nothing is in production custody: issue material first.</p>}
      </Panel>
      {empty.length > 0 && (
        <Panel title="Nothing left in production" description="Shown for the record; nothing more can be used from these lines.">
          <LinesTable columns={["Material", { label: "Issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped", numeric: true }, { label: "Returned", numeric: true }, "Why"]}>
            {empty.map((material) => <tr key={material.materialId}><Cell>{material.code} · {material.name}</Cell><Cell numeric>{qty(material.issued)}</Cell><Cell numeric>{qty(material.consumed)}</Cell>
              <Cell numeric>{qty(material.scrapped)}</Cell><Cell numeric>{qty(material.returned)}</Cell><Cell>{material.reason}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
      <Panel title="Notes"><TextArea label="Notes" value={head.notes} onChange={(value) => setHead({ ...head, notes: value })} maxLength={1000} /></Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={() => router.replace(existing ? `${MC_BASE}/${existing.id}` : `${MO_BASE}/${data.orderId}?tab=materials`)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!chosen.length || !data.eligible} onPress={save}>Save draft</Button>
      </div>
    </div>
  );
}

function MaterialRow({ material, row, suggestion, onChange }: { material: Material; row: Row; suggestion: string | null; onChange: (patch: Partial<Row>) => void }) {
  const workspace = useWorkspaceContext();
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", material.itemId), queryFn: () => itemUnits(material.itemId), enabled: row.include, staleTime: 60_000 });
  const over = row.include && row.uomId === material.uomId && Number(row.quantity) > Number(material.inCustody);
  const batches = material.identities.filter((identity) => identity.batchId);
  const serials = material.identities.filter((identity) => identity.serialId);
  return (
    <tr>
      <Cell><Checkbox aria-label={`Record ${material.code}`} isSelected={row.include} onChange={(value) => onChange({ include: value })} /></Cell>
      <Cell><span className="flex flex-col"><span>{material.code} · {material.name}</span>
        <span className="text-xs text-text-muted">{material.uom} · planned {qty(material.planned)}{Number(material.extra) ? ` + ${qty(material.extra)} extra` : ""}{material.trackingType !== "none" ? ` · ${material.trackingType}-tracked` : ""}</span></span></Cell>
      <Cell numeric>{qty(material.issued)}</Cell><Cell numeric>{qty(material.consumed)}</Cell><Cell numeric>{qty(material.scrapped)} / {qty(material.returned)}</Cell><Cell numeric>{qty(material.inCustody)}</Cell>
      <Cell numeric>{suggestion === null ? "—" : qty(suggestion)}</Cell>
      <Cell>{row.include && (
        <span className="flex flex-col gap-1">
          <span className="flex gap-1">
            <TextField aria-label={`${material.code} used`} size="compact" inputMode="decimal" className="w-24" value={row.quantity} onChange={(value) => onChange({ quantity: value })} />
            <Select aria-label={`${material.code} unit`} size="compact" selectedKey={row.uomId} onSelectionChange={(value) => onChange({ uomId: String(value) })}
              options={(units.data?.units ?? [{ uomId: material.uomId, code: material.uom }]).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
          </span>
          {over && <span className="text-xs text-danger">More than is in production ({qty(material.inCustody)}).</span>}
          {suggestion !== null && Number(row.quantity) > 0 && row.uomId === material.uomId && (
            <span className="text-xs text-text-muted">{Number(row.quantity) - Number(suggestion) === 0 ? "As the BOM expects" : `${Number(row.quantity) > Number(suggestion) ? "+" : ""}${qty(String(Number(row.quantity) - Number(suggestion)))} against the BOM`}</span>
          )}
        </span>
      )}</Cell>
      <Cell>{row.include && material.trackingType === "batch" && (
        <Select aria-label={`${material.code} batch`} size="compact" selectedKey={row.batchId ?? "oldest"} onSelectionChange={(value) => onChange({ batchId: value === "oldest" ? null : String(value) })}
          options={[{ value: "oldest", label: "Oldest issued first" }, ...batches.map((identity) => ({ value: identity.batchId!, label: `${identity.batch} · ${qty(identity.available)} in production${identity.expiresOn ? ` · exp ${formatDate(identity.expiresOn)}` : ""}${identity.batchUsable ? "" : " · not usable"}` }))]} />
      )}
      {row.include && material.trackingType === "serial" && (
        <span className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {!serials.length && <span className="text-xs text-text-muted">No serial units in production.</span>}
          {serials.map((identity) => (
            <Checkbox key={identity.serialId} isSelected={row.serialIds.includes(identity.serialId!)}
              onChange={(value) => { const serialIds = value ? [...row.serialIds, identity.serialId!] : row.serialIds.filter((id) => id !== identity.serialId); onChange({ serialIds, quantity: String(serialIds.length) }); }}>
              {identity.serial}{identity.sources[0]?.issueNumber ? ` · ${identity.sources[0].issueNumber}` : ""}
            </Checkbox>
          ))}
        </span>
      )}
      {row.include && material.trackingType === "none" && <span className="text-xs text-text-muted">{material.identities[0]?.sources.map((source) => `${source.issueNumber}${source.location ? ` @ ${source.location}` : ""} ${qty(source.remaining)}`).join(", ") || "—"}</span>}
      </Cell>
    </tr>
  );
}
