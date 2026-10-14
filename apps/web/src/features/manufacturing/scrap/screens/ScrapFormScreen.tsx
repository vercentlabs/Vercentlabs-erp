"use client";

// New (or draft) scrap note for one manufacturing order. It starts from what the order can scrap now — issued material still in production
// custody (with its batches and serial units) or output Quality rejected and nobody disposed of — so the operator chooses the source and
// enters the actual loss, never a stock balance or the recipe. Then why, recoverable or not (recoverable goes to a damaged-stock bin), and
// whether the loss is normal or abnormal. "Save draft" moves nothing; the note's own page asks for any approval and posts it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, newKey, qty } from "@/features/manufacturing/orders/api/mo-api";
import { SCRAP_BASE, TYPE_LABEL, createScrap, getScrap, scrapSources, updateScrap, type ManufacturingScrap, type ScrapSources, type ScrapType } from "../api/scrap-api";

type Row = { key: string; include: boolean; quantity: string; identity: string; serialIds: string[] };
const NONE = "none";

export function ScrapFormScreen({ orderId, scrapId, type }: { orderId?: string; scrapId?: string; type?: ScrapType }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap", scrapId ?? ""), queryFn: () => getScrap(scrapId!), enabled: Boolean(scrapId) });
  const order = orderId ?? existing.data?.order.id;
  const sources = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap-sources", order ?? ""), queryFn: () => scrapSources(order!), enabled: Boolean(order) });
  if (!orderId && !scrapId) return <ErrorState title="Choose a manufacturing order" description="Record scrap from the order's Materials or Production tab." />;
  if ((scrapId && existing.isLoading) || sources.isLoading) return <LoadingState label="Loading what the order can scrap" rows={6} />;
  const failure = existing.error ?? sources.error;
  if (failure || !sources.data) {
    if (errorStatus(failure) === 403) return <PermissionState title="You don't have access to scrap" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order" description={errorMessage(failure)} />;
  }
  return <ScrapForm data={sources.data} existing={existing.data ?? null} initialType={existing.data?.scrapType ?? type ?? "ISSUED_MATERIAL"} />;
}

function initialRows(data: ScrapSources, existing: FinishedScrap, scrapType: ScrapType): Row[] {
  if (scrapType === "ISSUED_MATERIAL") {
    return data.materials.filter((row) => Number(row.inCustody) > 0 || existing?.lines.some((line) => line.materialId === row.materialId)).map((row) => {
      const line = existing?.lines.find((entry) => entry.materialId === row.materialId);
      return { key: row.materialId, include: Boolean(line), quantity: line?.quantity ?? "", identity: line?.batch?.id ?? NONE, serialIds: line?.serials.map((serial) => serial.id) ?? [] };
    });
  }
  return data.entries.filter((row) => Number(row.undisposed) > 0 || existing?.lines.some((line) => line.productionEntryId === row.id)).map((row) => {
    const line = existing?.lines.find((entry) => entry.productionEntryId === row.id);
    return { key: row.id, include: Boolean(line), quantity: line?.quantity ?? "", identity: NONE, serialIds: [] };
  });
}
type FinishedScrap = ManufacturingScrap | null;

function ScrapForm({ data, existing, initialType }: { data: ScrapSources; existing: FinishedScrap; initialType: ScrapType }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [scrapType, setScrapType] = useState<ScrapType>(initialType);
  const [rows, setRows] = useState<Row[]>(() => initialRows(data, existing, initialType));
  const [reasonCode, setReasonCode] = useState(existing?.reasonCode ?? (initialType === "REJECTED_OUTPUT" ? "QUALITY_REJECTION" : "DAMAGED_DURING_PRODUCTION"));
  const [description, setDescription] = useState(existing?.description ?? "");
  const [disposition, setDisposition] = useState<string>(existing?.disposition ?? "IRRECOVERABLE");
  const [lossClass, setLossClass] = useState<string>(existing?.lossClass ?? "NORMAL");
  const [binId, setBinId] = useState(existing?.destination?.location?.id ?? data.bins[0]?.id ?? NONE);
  const [recoveryValue, setRecoveryValue] = useState(existing?.recoveryValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const set = (rowKey: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  const chooseType = (next: ScrapType) => { setScrapType(next); setRows(initialRows(data, null, next)); setReasonCode(next === "REJECTED_OUTPUT" ? "QUALITY_REJECTION" : "DAMAGED_DURING_PRODUCTION"); };
  const chosen = rows.filter((row) => row.include && Number(row.quantity) > 0);
  const eligibility = scrapType === "ISSUED_MATERIAL" ? data.material : data.output;
  const needsExplanation = reasonCode === "OTHER" || lossClass === "ABNORMAL";
  const approvalHints = [scrapType === "REJECTED_OUTPUT" && data.policy.outputRequiresApproval ? "scrapping output" : null, lossClass === "ABNORMAL" && data.policy.abnormalRequiresApproval ? "an abnormal loss" : null,
    data.policy.valueAbove ? `a value above ₹${data.policy.valueAbove}` : null].filter(Boolean);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const lines = chosen.map((row) => scrapType === "ISSUED_MATERIAL"
        ? { materialId: row.key, quantity: row.quantity, ...(row.identity !== NONE ? { batchId: row.identity } : {}), ...(row.serialIds.length ? { serialIds: row.serialIds } : {}) }
        : { productionEntryId: row.key, quantity: row.quantity });
      const input = { lines, reasonCode, description: description.trim() || null, disposition, lossClass, destinationLocationId: disposition === "RECOVERABLE" && binId !== NONE ? binId : null,
        recoveryValue: disposition === "RECOVERABLE" && recoveryValue.trim() ? recoveryValue.trim() : null };
      const saved = await submitKey.run(async () => existing ? await updateScrap(existing.id, { ...input, expectedVersion: existing.rowVersion })
        : await createScrap({ ...input, manufacturingOrderId: data.orderId, scrapType, idempotencyKey: key }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${SCRAP_BASE}/${saved.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing ? `Edit ${existing.number}` : "Record scrap"}
        description={`${data.orderNumber} · ${data.finishedItem.code} ${data.finishedItem.name} · ${data.orderStatusLabel}. Saving keeps a draft: nothing is disposed of until the note is posted.`} />
      {!existing && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="What is scrapped">
          {(["ISSUED_MATERIAL", "REJECTED_OUTPUT"] as const).map((value) => (
            <Button key={value} size="compact" variant={scrapType === value ? "primary" : "secondary"} onPress={() => chooseType(value)}>{TYPE_LABEL[value]}</Button>
          ))}
        </div>
      )}
      {!eligibility.eligible && <Notice tone="warning">{eligibility.reason}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {scrapType === "ISSUED_MATERIAL" ? (
        <Panel title="Material in production" description="Only material still in production custody — issued and not used, scrapped or returned. Material already used belongs to the output: scrap the rejected output instead.">
          <LinesTable columns={["", "Material", { label: "Issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped", numeric: true }, { label: "In custody", numeric: true }, "Scrap now", "Batch / serial"]}>
            {data.materials.filter((material) => rows.some((row) => row.key === material.materialId)).map((material) => {
              const row = rows.find((entry) => entry.key === material.materialId)!;
              return (
                <tr key={material.materialId}>
                  <Cell><Checkbox aria-label={`Scrap ${material.code}`} isSelected={row.include} onChange={(value) => set(row.key, { include: value })} /></Cell>
                  <Cell><span className="flex flex-col"><span>{material.code} · {material.name}</span><span className="text-xs text-text-muted">{material.uom}{material.trackingType !== "none" ? ` · ${material.trackingType}-tracked` : ""}</span></span></Cell>
                  <Cell numeric>{qty(material.netIssued)}</Cell><Cell numeric>{qty(material.consumed)}</Cell><Cell numeric>{qty(material.scrapped)}</Cell><Cell numeric>{qty(material.inCustody)}</Cell>
                  <Cell>{row.include && material.trackingType !== "serial" && (
                    <TextField aria-label={`${material.code} quantity`} size="compact" inputMode="decimal" className="w-24" value={row.quantity} onChange={(value) => set(row.key, { quantity: value })} />
                  )}{row.include && material.trackingType === "serial" && <span className="text-sm">{row.serialIds.length}</span>}</Cell>
                  <Cell>{row.include && material.trackingType === "batch" && (
                    <Select aria-label={`${material.code} batch`} size="compact" selectedKey={row.identity} onSelectionChange={(value) => set(row.key, { identity: String(value) })}
                      options={[{ value: NONE, label: "Choose the batch" }, ...material.identities.map((identity) => ({ value: identity.id, label: `${identity.label} · ${qty(identity.available)} in custody` }))]} />
                  )}
                  {row.include && material.trackingType === "serial" && (
                    <span className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                      {material.identities.map((identity) => (
                        <Checkbox key={identity.id} isSelected={row.serialIds.includes(identity.id)}
                          onChange={(value) => { const serialIds = value ? [...row.serialIds, identity.id] : row.serialIds.filter((id) => id !== identity.id); set(row.key, { serialIds, quantity: String(serialIds.length) }); }}>
                          {identity.label}
                        </Checkbox>
                      ))}
                    </span>
                  )}
                  {row.include && material.trackingType === "none" && <span className="text-xs text-text-muted">—</span>}</Cell>
                </tr>
              );
            })}
          </LinesTable>
          {!rows.length && <p className="text-sm text-text-muted">No material of this order is in production custody.</p>}
        </Panel>
      ) : (
        <Panel title="Rejected output" description="Only output Quality rejected and nobody has disposed of. Rejection alone is not scrap: this note is the decision that it cannot be recovered. Accepted output and finished goods are never scrapped here.">
          <LinesTable columns={["", "Production entry", { label: "Reported", numeric: true }, { label: "Rejected", numeric: true }, { label: "Already scrapped", numeric: true }, { label: "Undisposed", numeric: true }, "Quality said", "Scrap now"]}>
            {data.entries.filter((entry) => rows.some((row) => row.key === entry.id)).map((entry) => {
              const row = rows.find((candidate) => candidate.key === entry.id)!;
              return (
                <tr key={entry.id}>
                  <Cell><Checkbox aria-label={`Scrap from ${entry.number}`} isSelected={row.include} onChange={(value) => set(row.key, { include: value })} /></Cell>
                  <Cell>{entry.number}{entry.batch ? ` · ${entry.batch}` : ""}</Cell>
                  <Cell numeric>{qty(entry.reported)}</Cell><Cell numeric>{qty(entry.rejected)}</Cell><Cell numeric>{qty(entry.scrapped)}</Cell><Cell numeric>{qty(entry.undisposed)}</Cell>
                  <Cell>{entry.qualityDisposition ? entry.qualityDisposition.toLowerCase() : "—"}</Cell>
                  <Cell>{row.include && <TextField aria-label={`${entry.number} quantity`} size="compact" inputMode="decimal" className="w-24" value={row.quantity} onChange={(value) => set(row.key, { quantity: value })} />}</Cell>
                </tr>
              );
            })}
          </LinesTable>
          {!rows.length && <p className="text-sm text-text-muted">Nothing rejected on this order waits for a disposition.</p>}
        </Panel>
      )}
      <Panel title="Reason and disposition">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Reason" selectedKey={reasonCode} onSelectionChange={(value) => setReasonCode(String(value))} options={data.reasons} />
          <Select label="Loss" selectedKey={lossClass} onSelectionChange={(value) => setLossClass(String(value))}
            options={[{ value: "NORMAL", label: "Normal (stays in the order's cost)" }, { value: "ABNORMAL", label: "Abnormal (written off to variance)" }]} />
          <Select label="Disposition" selectedKey={disposition} onSelectionChange={(value) => setDisposition(String(value))}
            options={[{ value: "IRRECOVERABLE", label: "Irrecoverable — dispose of it" }, { value: "RECOVERABLE", label: "Recoverable — segregate it" }]} />
        </div>
        {disposition === "RECOVERABLE" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Scrap bin" selectedKey={binId} onSelectionChange={(value) => setBinId(String(value))}
              options={data.bins.length ? data.bins.map((bin) => ({ value: bin.id, label: `${bin.warehouse} / ${bin.code} · ${bin.disposition}` })) : [{ value: NONE, label: "No damaged-stock bin set up" }]} />
            <TextField label="Recovery value (optional)" inputMode="decimal" value={recoveryValue} onChange={setRecoveryValue} description="What it may fetch; it is kept at its source cost." />
          </div>
        )}
        <TextArea label={needsExplanation ? "What happened (required)" : "What happened"} value={description} onChange={setDescription} maxLength={1000} />
        {approvalHints.length > 0 && <p className="text-xs text-text-muted">The company asks for an approval for {approvalHints.join(", ")}.</p>}
      </Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={() => router.replace(existing ? `${SCRAP_BASE}/${existing.id}` : `${MO_BASE}/${data.orderId}?tab=${scrapType === "ISSUED_MATERIAL" ? "materials" : "production"}`)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!chosen.length || !eligibility.eligible || busy || (needsExplanation && description.trim().length < 3)} onPress={save}>Save draft</Button>
      </div>
    </div>
  );
}
