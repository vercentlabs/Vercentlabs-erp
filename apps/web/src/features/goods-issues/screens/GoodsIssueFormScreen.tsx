"use client";

// Create or edit a draft Goods Issue: one warehouse, a reason, who or what the goods go to, and lines — an item from one location, in any of
// its units, with the batches or serial numbers it comes from. What is available is shown as you go; saving keeps a draft (nothing moves or is
// reserved), posting checks everything again against current stock.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, ComboBox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { ErrorBanner, quantity } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  DISPOSITION_LABEL, createGoodsIssue, errorCode, errorMessage, errorsOf, getAvailability, getGoodsIssue, getGoodsIssueOptions, postGoodsIssue, updateGoodsIssue, type Disposition, type GoodsIssueDetail,
  type GoodsIssueOptions, type LineInput,
} from "../api/goods-issues-api";
import { GOODS_ISSUES_BASE } from "./GoodsIssuesScreen";

type Line = { key: string; itemId: string; quantity: string; uomId: string; locationId: string; disposition: Disposition; batches: Array<{ batchId: string; quantity: string }>; serialIds: string[]; notes: string };
const blank = (): Line => ({ key: crypto.randomUUID(), itemId: "", quantity: "", uomId: "", locationId: "", disposition: "available", batches: [], serialIds: [], notes: "" });

export type GoodsIssuePrefill = { itemId?: string; warehouseId?: string; locationId?: string; batchId?: string; serialId?: string };
export function GoodsIssueFormScreen({ issueId, prefill }: { issueId?: string; prefill?: GoodsIssuePrefill }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "goods-issues", "options"), queryFn: getGoodsIssueOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "goods-issues", "detail", issueId), queryFn: () => getGoodsIssue(issueId!), enabled: Boolean(issueId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading goods issue" rows={4} />;
  if (!options.data || (issueId && !existing.data)) return <ErrorState title="Could not load the goods issue" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.goodsIssue.status !== "draft")
    return <ErrorState title="This goods issue cannot be edited" description="Only a draft is edited. A posted goods issue is reversed, fully or partly." />;
  return <Form options={options.data} existing={existing.data ?? null} prefill={prefill} />;
}

function Form({ options, existing, prefill }: { options: GoodsIssueOptions; existing: GoodsIssueDetail | null; prefill?: GoodsIssuePrefill }) {
  const router = useRouter();
  const inv = useInvOptions();
  const saved = existing?.goodsIssue;
  const [header, setHeader] = useState({
    warehouseId: saved?.warehouseId ?? options.warehouses.find((entry) => entry.isDefault)?.id ?? options.warehouses[0]?.id ?? "",
    issueDate: saved?.issueDate ?? "", reasonId: saved?.reasonId ?? options.reasons.find((entry) => entry.code === "INTERNAL_CONSUMPTION")?.id ?? "",
    issueToType: saved?.issueToType ?? "", issueToId: saved?.issueToId ?? "", issueToText: saved?.issueToText ?? "", projectId: saved?.projectId ?? "",
    costCenterId: saved?.costCenterId ?? "", externalReference: saved?.externalReference ?? "", notes: saved?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.length ? existing.lines.map((line) => ({
    key: line.id, itemId: line.itemId, quantity: String(line.quantity), uomId: line.uomId, locationId: line.locationId ?? "", disposition: line.sourceDisposition,
    batches: line.batches.map((batch) => ({ batchId: batch.batchId, quantity: String(batch.quantity) })), serialIds: line.serials.map((serial) => serial.id), notes: line.notes ?? "",
  })) : [{ ...blank(), itemId: prefill?.itemId ?? "", locationId: prefill?.locationId ?? "", serialIds: prefill?.serialId ? [prefill.serialId] : [],
    batches: prefill?.batchId ? [{ batchId: prefill.batchId, quantity: "" }] as Line["batches"] : [] }]);
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const setLine = (key: string, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const reason = options.reasons.find((entry) => entry.id === header.reasonId);
  const warehouse = options.warehouses.find((entry) => entry.id === header.warehouseId);
  const recipients = { department: options.departments, employee: options.employees, project: options.projects, cost_center: options.costCenters }[header.issueToType] ?? null;
  const payload = useMemo(() => ({
    warehouseId: header.warehouseId, issueDate: header.issueDate || undefined, reasonId: header.reasonId, issueToType: header.issueToType || null,
    issueToId: recipients ? header.issueToId || null : null, issueToText: header.issueToText || null, projectId: header.projectId || null, costCenterId: header.costCenterId || null,
    externalReference: header.externalReference || null, notes: header.notes || null,
    lines: lines.filter((line) => line.itemId).map((line): LineInput => {
      const item = inv.data?.items.find((entry) => entry.id === line.itemId);
      return { itemId: line.itemId, quantity: line.quantity, uomId: line.uomId || undefined, locationId: line.locationId || null, sourceDisposition: line.disposition,
        ...(item?.tracking_type === "batch" ? { batches: line.batches.filter((batch) => batch.batchId && batch.quantity) } : {}),
        ...(item?.tracking_type === "serial" ? { serialIds: line.serialIds } : {}), notes: line.notes || null };
    }),
  }), [header, lines, inv.data, recipients]);
  const save = useMutation({
    mutationFn: async (post: boolean) => {
      const detail = existing ? await updateGoodsIssue(existing.goodsIssue.id, { ...payload, expectedVersion: existing.goodsIssue.version }) : await createGoodsIssue(payload);
      return post ? postGoodsIssue(detail.goodsIssue.id).catch((error) => { throw Object.assign(error, { savedId: detail.goodsIssue.id }); }) : detail;
    },
    onSuccess: (detail) => router.push(`${GOODS_ISSUES_BASE}/${detail.goodsIssue.id}`),
    onError: (error: Error & { savedId?: string }) => { if (error.savedId && !existing) router.replace(`${GOODS_ISSUES_BASE}/${error.savedId}/edit`); },
  });
  const errors = errorsOf(save.error);

  return (
    <RecordFormPage
      header={{
        title: saved ? `Edit ${saved.number}` : "New goods issue",
        description: "Stock leaving inventory on purpose. Saving keeps a draft (no stock moves, nothing is reserved); posting checks availability again and issues the stock at its valuation cost.",
      }}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `${GOODS_ISSUES_BASE}/${saved.id}` : GOODS_ISSUES_BASE)}>Cancel</Button>
          <Button variant={options.capabilities.post ? "secondary" : "primary"} isLoading={save.isPending && save.variables === false} onPress={() => save.mutate(false)}>Save draft</Button>
          {options.capabilities.post && <Button variant="primary" isLoading={save.isPending && save.variables === true} onPress={() => save.mutate(true)}>Post goods issue</Button>}
        </>
      }
      banner={save.error ? <Notice>
        {errorMessage(save.error)}{errors.length > 1 && <ul className="mt-1 list-disc pl-5">{errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}
        {(save.error as Error & { savedId?: string }).savedId && <p className="mt-1">{errorCode(save.error) === "NEGATIVE_STOCK_OVERRIDE_REQUIRED"
          ? <>The draft was saved. <Link className="underline" href={`${GOODS_ISSUES_BASE}/${(save.error as Error & { savedId?: string }).savedId}`}>Open it</Link> to post with an authorised negative-stock override, or reduce the quantity.</>
          : "The draft was saved; fix the above and post it again."}</p>}</Notice> : undefined}
    >
      <FormSection title="Goods issue" columns={1}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Warehouse" isRequired selectedKey={header.warehouseId || null} onSelectionChange={(key) => { set("warehouseId")(String(key)); setLines((current) => current.map((line) => ({ ...line, locationId: "", batches: [], serialIds: [] }))); }}
            options={options.warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} description="One source warehouse per goods issue." />
          <TextField label="Issue date" type="date" value={header.issueDate} onChange={set("issueDate")} description="When the goods were issued (today if empty)." />
          <Select label="Reason" isRequired selectedKey={header.reasonId || null} onSelectionChange={(key) => set("reasonId")(String(key))}
            options={options.reasons.map((entry) => ({ value: entry.id, label: entry.name }))} description={reason?.description ?? undefined} />
          <Select label="Issued to" selectedKey={header.issueToType || "none"} onSelectionChange={(key) => setHeader((current) => ({ ...current, issueToType: key === "none" ? "" : String(key), issueToId: "" }))}
            options={[{ value: "none", label: reason?.requiresRecipient ? "Choose…" : "Not specified" }, ...options.issueToTypes.map((entry) => ({ value: entry.id, label: entry.label }))]}
            description={reason?.requiresRecipient ? `${reason.name} needs a recipient.` : undefined} />
          {recipients && recipients.length > 0
            ? <Select label="Recipient" selectedKey={header.issueToId || null} onSelectionChange={(key) => set("issueToId")(String(key))} options={recipients.map((entry) => ({ value: entry.id, label: entry.name }))} />
            : header.issueToType ? <TextField label="Recipient" value={header.issueToText} onChange={set("issueToText")} placeholder="Who or what received the goods" /> : <span />}
          {options.projects.length > 0 && <Select label="Project" selectedKey={header.projectId || "none"} onSelectionChange={(key) => set("projectId")(key === "none" ? "" : String(key))}
            options={[{ value: "none", label: "No project" }, ...options.projects.map((entry) => ({ value: entry.id, label: entry.name }))]} />}
          {options.costCenters.length > 0 && <Select label="Cost center" selectedKey={header.costCenterId || "none"} onSelectionChange={(key) => set("costCenterId")(key === "none" ? "" : String(key))}
            options={[{ value: "none", label: "No cost center" }, ...options.costCenters.map((entry) => ({ value: entry.id, label: entry.name }))]} />}
          <TextField label="Reference" value={header.externalReference} onChange={set("externalReference")} placeholder="Requisition or ticket, e.g. MAINT-REQ-2031" />
        </div>
        <TextArea label="Notes" isRequired={reason?.requiresNotes} value={header.notes} onChange={set("notes")} description={reason?.requiresNotes ? `${reason.name} needs notes.` : undefined} />
      </FormSection>
      <FormSection title="Items" description="What is issued, from which location, in any of the item's units." columns={1}>
        {lines.map((line, index) => (
          <LineEditor key={line.key} index={index} line={line} warehouseId={header.warehouseId} locations={warehouse?.locations ?? []} items={inv.data?.items ?? []}
            allowed={reason?.allowedDispositions ?? ["available"]} onChange={(change) => setLine(line.key, change)}
            onRemove={lines.length > 1 ? () => setLines((current) => current.filter((entry) => entry.key !== line.key)) : undefined} />
        ))}
        <div><Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add item</Button></div>
      </FormSection>
    </RecordFormPage>
  );
}

type Item = NonNullable<ReturnType<typeof useInvOptions>["data"]>["items"][number];

function LineEditor({ index, line, warehouseId, locations, items, allowed, onChange, onRemove }: {
  index: number; line: Line; warehouseId: string; locations: Array<{ id: string; code: string; isMain: boolean }>; items: Item[]; allowed: Disposition[];
  onChange: (change: Partial<Line>) => void; onRemove?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const item = items.find((entry) => entry.id === line.itemId);
  const stock = useQuery({ queryKey: scopedQueryKey(workspace, "goods-issues", "availability", warehouseId, line.itemId), queryFn: () => getAvailability(warehouseId, line.itemId),
    enabled: Boolean(warehouseId && line.itemId) });
  const main = locations.find((entry) => entry.isMain);
  const locationId = line.locationId || null;
  const atLocation = (stock.data?.positions ?? []).filter((position) => (position.locationId ?? null) === (locationId && locationId !== main?.id ? locationId : null));
  const unit = item?.units?.find((entry) => entry.uomId === (line.uomId || item.uom_id));
  const base = Number(line.quantity || 0) * Number(unit?.factor ?? 1);
  const free = atLocation.filter((position) => position.disposition === line.disposition).reduce((sum, position) => sum + position.available, 0);
  const serials = (stock.data?.serials ?? []).filter((serial) => (serial.locationId ?? null) === (locationId && locationId !== main?.id ? locationId : null));
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <ComboBox className="sm:col-span-2" label={`Line ${index + 1} · Item`} selectedKey={line.itemId || null} placeholder="Search SKU or name"
          options={items.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
          onSelectionChange={(key) => onChange({ itemId: key ? String(key) : "", uomId: "", batches: [], serialIds: [] })} />
        <Select label="Location" selectedKey={line.locationId || main?.id || null} onSelectionChange={(key) => onChange({ locationId: String(key), batches: [], serialIds: [] })}
          options={locations.map((entry) => ({ value: entry.id, label: entry.code }))} />
        <TextField label="Quantity" inputMode="decimal" value={line.quantity} onChange={(value) => onChange({ quantity: value })} />
        {item?.units && item.units.length > 1
          ? <Select label="Unit" selectedKey={line.uomId || item.uom_id || null} onSelectionChange={(key) => onChange({ uomId: String(key) })}
              options={item.units.map((entry) => ({ value: entry.uomId, label: `${entry.code}${Number(entry.factor) !== 1 ? ` (= ${Number(entry.factor)} ${item.base_uom ?? ""})` : ""}` }))} />
          : <TextField label="Unit" value={item?.base_uom ?? ""} isReadOnly />}
        <Select label="Stock issued from" selectedKey={line.disposition} onSelectionChange={(key) => onChange({ disposition: String(key) as Disposition })}
          options={allowed.map((entry) => ({ value: entry, label: DISPOSITION_LABEL[entry] }))} description={allowed.length === 1 ? "This reason issues available stock only." : undefined} />
      </div>
      {line.itemId && (
        <p className="text-xs text-text-muted">
          {stock.isLoading ? "Checking stock…" : stock.data ? <>In this warehouse: on hand {quantity(stock.data.totals.onHand, item?.base_uom)} · reserved {quantity(stock.data.totals.reserved)} ·
            {" "}<span className="font-medium text-text">available {quantity(stock.data.totals.available)}</span>. Here ({DISPOSITION_LABEL[line.disposition].toLowerCase()}): {quantity(free)}
            {base > 0 && unit && Number(unit.factor) !== 1 ? ` · this line is ${quantity(base)} ${item?.base_uom ?? ""}` : ""}
            {base > free ? <span className="text-warning"> · more than is available now; posting will refuse it</span> : ""}</> : null}
        </p>
      )}
      {item?.tracking_type === "batch" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Batches (base units; they must add up to {quantity(base)} {item.base_uom ?? ""})</p>
          {atLocation.filter((position) => position.batchId).map((position) => {
            const entry = line.batches.find((batch) => batch.batchId === position.batchId);
            return (
              <div key={position.batchId} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-5">
                <span className="text-sm sm:col-span-2">{position.batch}{position.expiresOn ? ` · expires ${position.expiresOn}` : ""} · {DISPOSITION_LABEL[position.disposition] ?? position.disposition} · available {quantity(position.available)}</span>
                <TextField aria-label={`Quantity from ${position.batch}`} inputMode="decimal" value={entry?.quantity ?? ""}
                  onChange={(value) => onChange({ batches: [...line.batches.filter((batch) => batch.batchId !== position.batchId), ...(value ? [{ batchId: position.batchId!, quantity: value }] : [])] })} />
              </div>
            );
          })}
          {!atLocation.some((position) => position.batchId) && <p className="text-xs text-text-muted">No batch of this item is at this location.</p>}
        </div>
      )}
      {item?.tracking_type === "serial" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Serial numbers (one per unit: {line.serialIds.length} of {quantity(base)} chosen)</p>
          <div className="flex flex-wrap gap-3">
            {serials.map((serial) => (
              <Checkbox key={serial.id} isDisabled={serial.reserved} isSelected={line.serialIds.includes(serial.id)}
                onChange={(selected) => onChange({ serialIds: selected ? [...line.serialIds, serial.id] : line.serialIds.filter((id) => id !== serial.id) })}>
                {serial.serialNumber}{serial.reserved ? " (reserved)" : ""}
              </Checkbox>
            ))}
            {!serials.length && <p className="text-xs text-text-muted">No serial number of this item is in stock here.</p>}
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        <TextField className="flex-1" label="Line notes" value={line.notes} onChange={(value) => onChange({ notes: value })} />
        {onRemove && <Button variant="ghost" size="compact" aria-label={`Remove line ${index + 1}`} onPress={onRemove}><Trash2 className="size-4" aria-hidden="true" /></Button>}
      </div>
      <ErrorBanner message={stock.isError ? errorMessage(stock.error) : null} />
    </div>
  );
}
