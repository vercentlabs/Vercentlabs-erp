"use client";

// One Stock Count. Draft: preview the scope, start (capturing the system stock and freezing the scope). In progress: count every line — a
// quantity in any of the item's units (blank is not counted; 0 is none found), serial numbers present and found, stock found that the count had
// no line for — by hand, by scanner or from a count sheet; recounts add attempts beside the first. Ready for review: variances by kind, recounts,
// how each is resolved and the cost of stock found, the adjustment it will post (reservation conflicts resolved here), then Complete. A count
// moves no stock: its linked Stock Adjustment does.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Checkbox, ComboBox, Dialog, EmptyState, ErrorState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { ErrorBanner, money, quantity } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { FactList, HistoryList, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  KIND_LABEL, LINE_STATUS_LABEL, STATUS_TONE, STOCK_COUNTS_BASE, acceptLines, addUnexpected, cancelCount, completeCount, enterCount, enterSerials, errorCode, errorDetails, errorMessage,
  getCount, importSheet, previewAdjustment, previewScope, requestRecount, setResolution, sheetUrl, startCount, submitCount, type CountDetail, type CountLine, type ResolutionType,
} from "../api/stock-counts-api";

const signed = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value > 0 ? `+${quantity(value)}` : quantity(value));
const RESOLUTIONS: Array<{ value: ResolutionType; label: string }> = [{ value: "stock_adjustment", label: "Stock adjustment" }, { value: "location_transfer", label: "Location transfer" },
  { value: "disposition_movement", label: "Disposition movement" }, { value: "manual_investigation", label: "Manual investigation" }, { value: "no_action", label: "No action" }];

export function StockCountDetailScreen({ countId }: { countId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "stock-counts", "detail", countId);
  const detail = useQuery({ queryKey: key, queryFn: () => getCount(countId) });
  const refresh = (data?: CountDetail) => { if (data) queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "stock-counts") }); };
  const [dialog, setDialog] = useState<"cancel" | "complete" | "unexpected" | "import" | null>(null);
  const [serialLine, setSerialLine] = useState<CountLine | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const status = detail.data?.count.status;
  const scope = useQuery({ queryKey: [...key, "scope"], queryFn: () => previewScope(countId), enabled: status === "draft" });
  const step = useMutation({ mutationFn: (action: "start" | "submit" | "accept") => (action === "start" ? startCount(countId) : action === "submit" ? submitCount(countId) : acceptLines(countId)),
    onSuccess: refresh });
  const recount = useMutation({ mutationFn: () => requestRecount(countId, selected), onSuccess: (data) => { setSelected([]); refresh(data); } });

  if (detail.isLoading) return <LoadingState label="Loading stock count" rows={5} />;
  if (detail.isError) return errorCode(detail.error) === "COUNT_NOT_FOUND"
    ? <EmptyState title="Stock count not found" description="It does not exist, or it is in a warehouse you cannot see." />
    : <ErrorState title="Could not load the stock count" description={errorMessage(detail.error)} action={{ label: "Try again", onPress: () => void detail.refetch() }} />;
  const data = detail.data!;
  const head = data.count;
  const can = data.capabilities;
  const sees = data.seesSystemQuantity;
  const toggle = (id: string, value: boolean) => setSelected((current) => (value ? [...current, id] : current.filter((entry) => entry !== id)));
  const primaryAction = can.start ? <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate("start")}>Start count</Button>
    : can.submit ? <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate("submit")}>Submit for review</Button>
      : can.complete ? <Button variant="primary" onPress={() => setDialog("complete")}>Complete count</Button> : undefined;
  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{head.number} <span className="text-base font-normal whitespace-nowrap text-text-muted">{head.countTypeLabel}</span></>,
        status: <span className="flex flex-wrap items-center gap-2"><StatusBadge tone={STATUS_TONE[head.status]}>{head.statusLabel}</StatusBadge>{head.blindCount && <Badge tone="neutral">Blind</Badge>}</span>,
        fields: [
          { label: "Warehouse", value: `${head.warehouse} · ${head.warehouseName}` },
          { label: "Counter", value: head.assignedUserName ?? "Not assigned" },
          { label: "Snapshot", value: head.snapshotAt ? formatDateTime(head.snapshotAt) : "Not started" },
          ...(head.status !== "draft" ? [{ label: "Progress", value: `${data.summary.counted} of ${data.summary.lines} (${head.progress}%)` }] : []),
          ...(head.reference ? [{ label: "Reference", value: head.reference }] : []),
        ],
        primaryAction,
        secondaryActions: (
          <>
            {can.edit && <Button variant="secondary" onPress={() => router.push(`${STOCK_COUNTS_BASE}/${head.id}/edit`)}>Edit</Button>}
            {can.import && <Button variant="secondary" onPress={() => setDialog("import")}>Import counts</Button>}
            <MoreActions actions={[
              { id: "unexpected", label: "Add unexpected stock", show: can.addUnexpected, run: () => setDialog("unexpected") },
              { id: "export", label: "Export count sheet", show: can.export, run: () => { window.location.href = sheetUrl(head.id, "xlsx"); } },
              { id: "print", label: "Print count sheet", show: can.export, run: () => router.push(`${STOCK_COUNTS_BASE}/${head.id}/sheet`) },
              { id: "cancel", label: "Cancel count", show: can.cancel, run: () => setDialog("cancel") },
            ]} />
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={step.isError ? errorMessage(step.error) : recount.isError ? errorMessage(recount.error) : null} />
          {head.status === "draft" && scope.data && (
            <Notice tone="neutral">
              <p className="font-medium text-text">Starting will capture and freeze: {scope.data.freeze}</p>
              <p>{scope.data.locations} location{scope.data.locations === 1 ? "" : "s"} · {scope.data.items} item{scope.data.items === 1 ? "" : "s"} · {scope.data.positions} stock positions
                · {scope.data.batchPositions} batch positions · {scope.data.serialsExpected} serial numbers · {scope.data.activeReservations} active reservations</p>
              {scope.data.overlaps.length > 0 && <p className="text-danger">Overlaps active count {scope.data.overlaps.join(", ")}: it cannot start until that one is completed or cancelled.</p>}
            </Notice>
          )}
          {["in_progress", "ready_for_review"].includes(head.status) && <Notice tone="warning">
            The scope is frozen since {formatDateTime(head.snapshotAt!)}: stock there does not move and is not newly reserved until the count is completed or cancelled.</Notice>}
        </div>
      }
    >
      <Tabs defaultSelectedKey={head.status === "ready_for_review" ? "variances" : head.status === "draft" ? "overview" : "lines"}>
        <TabList aria-label="Stock count sections">
          <Tab id="overview">Overview</Tab><Tab id="lines">Count lines</Tab><Tab id="serials">Serials</Tab>{sees && <Tab id="variances">Variances</Tab>}<Tab id="adjustment">Adjustment</Tab><Tab id="history">History</Tab>
        </TabList>
        <TabPanel id="overview"><div className="flex flex-col gap-4 pt-4">
          <FactList title="Stock count" items={[
            ["Warehouse", `${head.warehouse} · ${head.warehouseName}`], ["Scope", data.scope.length ? data.scope.map((entry) => [entry.location, entry.item].filter(Boolean).join(" / ")).join("; ") : "The whole warehouse"],
            ["Blind count", head.blindCount ? "Yes" : "No"], ["Recount threshold", head.recountThresholdPercent === null ? "None" : `${head.recountThresholdPercent}%`],
            ["Snapshot", head.snapshotAt ? formatDateTime(head.snapshotAt) : "Not started"], ["Submitted", head.submittedAt ? formatDateTime(head.submittedAt) : null],
            ["Completed", head.completedAt ? `${formatDateTime(head.completedAt)}${head.completedByName ? ` by ${head.completedByName}` : ""}` : null],
            ["Cancelled", head.cancelledAt ? `${formatDateTime(head.cancelledAt)}${head.cancelReason ? ` · ${head.cancelReason}` : ""}` : null], ["Instructions", head.instructions],
          ]} />
          {head.status !== "draft" && <FactList title="Progress and variances" items={[
            ["Lines", data.summary.lines], ["Counted", `${data.summary.counted} (${head.progress}%)`], ["Not counted", data.summary.notCounted], ["Recount required", data.summary.recountRequired],
            ...(data.summary.serialsExpected ? [["Serials expected / present", `${data.summary.serialsExpected} / ${data.summary.serialsPresent}`] as [string, ReactNode]] : []),
            ...(sees ? [["No variance", data.summary.noVariance], ["Shortages", data.summary.shortages], ["Gains", data.summary.gains],
              ["Missing / unexpected serials", `${data.summary.serialsMissing ?? 0} / ${data.summary.serialsUnexpected ?? 0}`], ["Possible misplacements", data.summary.possibleMisplacements]] as Array<[string, ReactNode]> : []),
          ]} />}
        </div></TabPanel>
        <TabPanel id="lines"><div className="flex flex-col gap-2 pt-4">
          {can.requestRecount && selected.length > 0 && <div><Button size="compact" variant="secondary" isLoading={recount.isPending} onPress={() => recount.mutate()}>Request recount of {selected.length} line{selected.length === 1 ? "" : "s"}</Button></div>}
          {data.lines.length === 0 ? <p className="text-sm text-text-muted">{head.status === "draft" ? "Lines are generated when the count starts." : "Nothing was in scope."}</p> : (
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["", "#", "Location", "SKU", "Item", "Batch", ...(sees ? ["System"] : []), "Counted", ...(sees ? ["Variance", "%"] : []), "Status", "Count"]
                  .map((label, index) => <th key={`${label}${index}`} className="px-3 py-2 font-medium whitespace-nowrap">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {data.lines.map((line) => (
                    <tr key={line.id} className={line.status === "recount_required" ? "bg-warning-soft" : ""}>
                      <td className="px-3 py-2">{can.requestRecount && ["counted", "accepted"].includes(line.status) && <Checkbox aria-label={`Select line ${line.lineNumber}`} isSelected={selected.includes(line.id)} onChange={(value) => toggle(line.id, value)} />}</td>
                      <td className="px-3 py-2">{line.lineNumber}</td><td className="px-3 py-2">{line.location}{line.disposition !== "available" ? <span className="text-xs text-text-muted"> · {line.disposition.replace(/_/g, " ")}</span> : null}</td>
                      <td className="px-3 py-2">{line.sku}{line.unexpected && <> <Badge tone="info">Found</Badge></>}</td><td className="px-3 py-2">{line.itemName}</td>
                      <td className="px-3 py-2">{line.batch ? `${line.batch}${line.newBatch ? " (new)" : ""}${line.expiresOn ? ` · ${line.expiresOn}` : ""}` : "—"}</td>
                      {sees && <td className="px-3 py-2 tabular-nums">{quantity(line.system ?? 0, line.baseUom)}</td>}
                      <td className="px-3 py-2 tabular-nums">{line.counted === null ? <span className="text-text-muted">Not counted</span> : quantity(line.counted, line.baseUom)}</td>
                      {sees && <><td className="px-3 py-2 tabular-nums">{signed(line.variance)}</td><td className="px-3 py-2 tabular-nums">{line.variancePercent === null || line.variancePercent === undefined ? (line.counted && !line.system ? "New" : "—") : `${line.variancePercent}%`}</td></>}
                      <td className="px-3 py-2"><Badge tone={line.status === "recount_required" ? "warning" : line.status === "not_counted" ? "neutral" : "success"}>{LINE_STATUS_LABEL[line.status]}</Badge></td>
                      <td className="px-3 py-2">{(can.count || can.recount) && line.status !== "accepted" && (line.trackingType === "serial"
                        ? <Button size="compact" variant="ghost" onPress={() => setSerialLine(line)}>Scan serials</Button>
                        : <EntryCell countId={head.id} line={line} onDone={refresh} />)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div></TabPanel>
        <TabPanel id="serials"><div className="flex flex-col gap-3 pt-4 text-sm">
          {data.lines.filter((line) => line.trackingType === "serial").length === 0 ? <p className="text-text-muted">No serial-numbered items on this count.</p> : data.lines.filter((line) => line.trackingType === "serial").map((line) => (
            <div key={line.id}><p className="font-medium">Line {line.lineNumber} · {line.sku} · {line.location}</p>
              <div className="flex flex-wrap gap-2">{line.serials.map((serial) => (
                <Badge key={serial.serialNumber} tone={serial.result === "missing" ? "danger" : serial.result === "unexpected" ? "info" : serial.result === "present" || serial.result === "counted" ? "success" : "neutral"}>
                  {serial.serialNumber}{serial.result ? ` · ${serial.result}` : ""}</Badge>))}
                {!line.serials.length && <span className="text-text-muted">No serial number expected here.</span>}</div></div>))}
        </div></TabPanel>
        {sees && <TabPanel id="variances"><div className="flex flex-col gap-3 pt-4">
          {can.review && <div><Button size="compact" variant="secondary" isLoading={step.isPending} onPress={() => step.mutate("accept")}>Accept all counted lines</Button></div>}
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["#", "SKU", "Location", "Batch", "System", "Counted", "Variance", "Kind", "Resolution", ""].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {data.lines.filter((line) => !line.kinds.includes("no_variance")).map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2">{line.lineNumber}</td><td className="px-3 py-2">{line.sku}</td><td className="px-3 py-2">{line.location}</td><td className="px-3 py-2">{line.batch ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{quantity(line.system ?? 0)}</td><td className="px-3 py-2 tabular-nums">{line.counted === null ? "—" : quantity(line.counted)}</td>
                    <td className="px-3 py-2 tabular-nums">{signed(line.variance)}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{line.kinds.map((kind) => <Badge key={kind} tone={kind === "possible_misplacement" ? "warning" : "neutral"}>{KIND_LABEL[kind] ?? kind}</Badge>)}</span></td>
                    <td className="px-3 py-2">{RESOLUTIONS.find((entry) => entry.value === line.resolutionType)?.label}{line.resolutionNote ? <span className="block text-xs text-text-muted">{line.resolutionNote}</span> : null}
                      {line.valuationSource && line.valuationSource !== "current_valuation_cost" ? <span className="block text-xs text-text-muted">Cost: {line.valuationSource === "zero_cost_authorized" ? "zero (authorized)" : money(line.unitCost ?? 0)}</span> : null}</td>
                    <td className="px-3 py-2">{can.review && <ResolutionButton countId={head.id} line={line} onDone={refresh} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.summary.possibleMisplacements ? <p className="text-sm text-text-muted">Possible misplacements: the same item short in one place and over in another usually means stock moved without a transfer, or a disposition was recorded wrongly. Resolve them as a location transfer or disposition movement (recorded after the count) rather than as a loss and a gain.</p> : null}
        </div></TabPanel>}
        <TabPanel id="adjustment"><div className="flex flex-col gap-2 pt-4 text-sm">
          {head.adjustmentId ? <p>Variances posted as <Link className="text-brand hover:underline" href={`/inventory/adjustments/${head.adjustmentId}`}>{head.adjustmentNumber}</Link> ({head.adjustmentStatus}).
            <Link className="ml-2 text-brand hover:underline" href={`/inventory/transactions?tab=ledger&sourceId=${head.adjustmentId}`}>View in Stock Ledger</Link></p>
            : head.status === "completed" ? <p className="text-text-muted">Completed with nothing to adjust: no stock adjustment, no movement, no journal.</p>
            : <p className="text-text-muted">Completing posts the stock-adjustment variances as one Stock Adjustment (Physical count gain / loss). Preview it under Complete count.</p>}
        </div></TabPanel>
        <TabPanel id="history">
          <HistoryList entries={[
            ...data.history.map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor })),
            ...data.lines.filter((line) => line.attempts.length > 1).map((line) => ({ label: "Recount", at: null,
              summary: `Line ${line.lineNumber} attempts: ${line.attempts.map((attempt) => `#${attempt.attempt} ${quantity(attempt.quantity, attempt.uom)}${attempt.countedBy ? ` (${attempt.countedBy})` : ""}`).join(" → ")}` })),
          ]} />
        </TabPanel>
      </Tabs>
    </RecordDetailsPage>
      {serialLine && <SerialDialog countId={head.id} line={serialLine} onClose={() => setSerialLine(null)} onDone={(next) => { setSerialLine(null); refresh(next); }} />}
      {dialog === "unexpected" && <UnexpectedDialog detail={data} onClose={() => setDialog(null)} onDone={(next) => { setDialog(null); refresh(next); }} />}
      {dialog === "import" && <ImportDialog countId={head.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === "cancel" && <CancelDialog detail={data} onClose={() => setDialog(null)} onDone={(next) => { setDialog(null); refresh(next); }} />}
      {dialog === "complete" && <CompleteDialog detail={data} onClose={() => setDialog(null)} onDone={(next) => { setDialog(null); refresh(next); }} />}
    </>
  );
}

// One line's count: a quantity in any of the item's units. Blank is not a count; 0 means none found.
function EntryCell({ countId, line, onDone }: { countId: string; line: CountLine; onDone: (data: CountDetail) => void }) {
  const inv = useInvOptions();
  const item = inv.data?.items.find((entry) => entry.id === line.itemId);
  const [value, setValue] = useState("");
  const [uomId, setUomId] = useState("");
  const save = useMutation({ mutationFn: () => enterCount(countId, { lineId: line.id, quantity: value, uomId: uomId || undefined }), onSuccess: (data) => { setValue(""); onDone(data); } });
  return (
    <div className="flex items-end gap-1">
      <TextField aria-label={`Counted for line ${line.lineNumber}`} inputMode="decimal" value={value} onChange={setValue} placeholder={line.status === "recount_required" ? "Recount" : "Qty"} className="w-24" />
      {item?.units && item.units.length > 1 && <Select aria-label="Unit" size="compact" selectedKey={uomId || item.uom_id || null} onSelectionChange={(key) => setUomId(String(key))}
        options={item.units.map((entry) => ({ value: entry.uomId, label: entry.code }))} />}
      <Button size="compact" variant="secondary" isDisabled={value.trim() === ""} isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
      {save.isError && <span role="alert" className="text-xs text-danger">{errorMessage(save.error)}</span>}
    </div>
  );
}

// Serial numbers by identity: scan or type each one found (scanner input ends with Enter); expected ones not found become missing.
function SerialDialog({ countId, line, onClose, onDone }: { countId: string; line: CountLine; onClose: () => void; onDone: (data: CountDetail) => void }) {
  const [scanned, setScanned] = useState<string[]>(() => line.serials.filter((serial) => serial.result === "present" || serial.result === "unexpected").map((serial) => serial.serialNumber));
  const [input, setInput] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const expected = line.serials.filter((serial) => serial.expected).map((serial) => serial.serialNumber.toLowerCase());
  const add = () => {
    const value = input.trim();
    if (!value) return;
    if (scanned.some((entry) => entry.toLowerCase() === value.toLowerCase())) setWarning(`${value} is already scanned.`);
    else { setScanned((current) => [...current, value]); setWarning(null); }
    setInput("");
  };
  const save = useMutation({
    mutationFn: () => enterSerials(countId, { lineId: line.id, presentSerialNumbers: scanned.filter((entry) => expected.includes(entry.toLowerCase())),
      unexpectedSerialNumbers: scanned.filter((entry) => !expected.includes(entry.toLowerCase())) }),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Serial numbers · line ${line.lineNumber} (${line.sku} at ${line.location})`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Scan or type each serial number physically here. Any expected one not scanned is recorded missing; one not expected is recorded found.</p>
        <form onSubmit={(event) => { event.preventDefault(); add(); }} className="flex items-end gap-2">
          <TextField label="Serial number" value={input} onChange={setInput} autoFocus className="flex-1" />
          <Button type="submit" variant="secondary">Add</Button>
        </form>
        {warning && <p className="text-warning">{warning}</p>}
        <div className="flex flex-wrap gap-2">{scanned.map((serial) => (
          <span key={serial} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">{serial}{!expected.includes(serial.toLowerCase()) && <Badge tone="info">found</Badge>}
            <button type="button" aria-label={`Remove ${serial}`} onClick={() => setScanned((current) => current.filter((entry) => entry !== serial))}>×</button></span>))}</div>
        <ErrorBanner message={save.isError ? errorMessage(save.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save serial count</Button></div>
      </div>
    </Dialog>
  );
}

function UnexpectedDialog({ detail, onClose, onDone }: { detail: CountDetail; onClose: () => void; onDone: (data: CountDetail) => void }) {
  const inv = useInvOptions();
  const items = inv.data?.items ?? [];
  const locations = (inv.data?.locations ?? []).filter((entry) => entry.warehouse_id === detail.count.warehouseId);
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [value, setValue] = useState("");
  const [uomId, setUomId] = useState("");
  const [batch, setBatch] = useState("");
  const [expires, setExpires] = useState("");
  const [serials, setSerials] = useState("");
  const item = items.find((entry) => entry.id === itemId);
  const save = useMutation({
    mutationFn: () => addUnexpected(detail.count.id, { itemId, locationId: locationId || null, quantity: value, uomId: uomId || undefined, batchNumber: batch || undefined, newExpiresOn: expires || undefined,
      serialNumbers: serials.split(/[\s,;]+/).filter(Boolean) }),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add unexpected stock">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Stock physically found that the count has no line for. It becomes a gain on completion, at an authorized cost.</p>
        <ComboBox label="Item" selectedKey={itemId || null} onSelectionChange={(key) => setItemId(key ? String(key) : "")} options={items.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
        <Select label="Location" selectedKey={locationId || null} onSelectionChange={(key) => setLocationId(String(key))} options={locations.map((entry) => ({ value: entry.id, label: entry.code }))} />
        {item?.tracking_type === "batch" && <div className="grid grid-cols-2 gap-2"><TextField label="Batch" value={batch} onChange={setBatch} description="An existing batch number, or a new lot." /><TextField label="Expiry (new lot)" type="date" value={expires} onChange={setExpires} /></div>}
        {item?.tracking_type === "serial" ? <TextField label="Serial numbers found" value={serials} onChange={setSerials} placeholder="SN-0101, SN-0102" /> : <div className="grid grid-cols-2 gap-2">
          <TextField label="Quantity" inputMode="decimal" value={value} onChange={setValue} />
          {item?.units && item.units.length > 1 ? <Select label="Unit" selectedKey={uomId || item.uom_id || null} onSelectionChange={(key) => setUomId(String(key))} options={item.units.map((entry) => ({ value: entry.uomId, label: entry.code }))} />
            : <TextField label="Unit" value={item?.base_uom ?? ""} isReadOnly />}</div>}
        <ErrorBanner message={save.isError ? errorMessage(save.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button><Button variant="primary" isDisabled={!itemId} isLoading={save.isPending} onPress={() => save.mutate()}>Add</Button></div>
      </div>
    </Dialog>
  );
}

function ImportDialog({ countId, onClose, onDone }: { countId: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({ mutationFn: () => importSheet(countId, file!), onSuccess: onDone });
  const rows = run.isError ? (errorDetails(run.error)?.details?.errors ?? errorDetails(run.error)?.errors ?? []) : [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Import counts">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Export the count sheet, fill in Counted Qty (one row per serial number found), and import it here — CSV or XLSX. Every row is checked first; if any is wrong, nothing is entered. It enters counts only, never stock.</p>
        <input type="file" accept=".csv,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <ErrorBanner message={run.isError ? errorMessage(run.error) : null} />
        {rows.length > 0 && <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-danger">{rows.map((entry, index) => <li key={index}>{entry.row ? `Row ${entry.row}: ` : ""}{entry.message}</li>)}</ul>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button><Button variant="primary" isDisabled={!file} isLoading={run.isPending} onPress={() => run.mutate()}>Import</Button></div>
      </div>
    </Dialog>
  );
}

function ResolutionButton({ countId, line, onDone }: { countId: string; line: CountLine; onDone: (data: CountDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ResolutionType>(line.resolutionType);
  const [note, setNote] = useState(line.resolutionNote ?? "");
  const [source, setSource] = useState(line.valuationSource ?? "current_valuation_cost");
  const [cost, setCost] = useState(line.unitCost === null ? "" : String(line.unitCost));
  const [costNote, setCostNote] = useState(line.costNote ?? "");
  const gain = (line.variance ?? 0) > 0 || line.kinds.includes("unexpected_serial");
  const save = useMutation({ mutationFn: () => setResolution(countId, { lineId: line.id, resolutionType: type, note, ...(gain ? { valuationSource: source, unitCost: cost || undefined, costNote } : {}) }),
    onSuccess: (data) => { setOpen(false); onDone(data); } });
  return (<>
    <Button size="compact" variant="ghost" onPress={() => setOpen(true)}>Resolve</Button>
    {open && <Dialog isOpen onOpenChange={(value) => !value && setOpen(false)} title={`Line ${line.lineNumber} · ${line.sku}`}>
      <div className="flex flex-col gap-3 text-sm">
        <Select label="Resolve by" selectedKey={type} onSelectionChange={(key) => setType(String(key) as ResolutionType)} options={RESOLUTIONS} />
        {type !== "stock_adjustment" && <TextArea label="How it is resolved" isRequired value={note} onChange={setNote} description="Left out of the count's adjustment: record the transfer, disposition movement or investigation after the count." />}
        {gain && type === "stock_adjustment" && <>
          <Select label="Cost of stock found" selectedKey={source} onSelectionChange={(key) => setSource(String(key))}
            options={[{ value: "current_valuation_cost", label: "Current valuation cost" }, { value: "manual_authorized_cost", label: "Authorized cost entered" }, { value: "zero_cost_authorized", label: "Zero cost (authorized)" }]} />
          {source === "manual_authorized_cost" && <TextField label="Unit cost (per base unit)" inputMode="decimal" value={cost} onChange={setCost} />}
          {source !== "current_valuation_cost" && <TextField label="Where the cost comes from" isRequired value={costNote} onChange={setCostNote} />}
        </>}
        <ErrorBanner message={save.isError ? errorMessage(save.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setOpen(false)}>Close</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </div>
    </Dialog>}
  </>);
}

function CancelDialog({ detail, onClose, onDone }: { detail: CountDetail; onClose: () => void; onDone: (data: CountDetail) => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({ mutationFn: () => cancelCount(detail.count.id, reason), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Cancel ${detail.count.number}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">Nothing is adjusted and the freeze is released. The counts entered stay as history.</p>
        <TextArea label="Reason" isRequired={detail.count.status !== "draft"} value={reason} onChange={setReason} />
        <ErrorBanner message={cancel.isError ? errorMessage(cancel.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Keep it</Button><Button variant="danger" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel count</Button></div>
      </div>
    </Dialog>
  );
}

// Complete: the adjustment preview (projected stock, reservation conflicts and how to resolve them, cost bases still needed, value), then post.
function CompleteDialog({ detail, onClose, onDone }: { detail: CountDetail; onClose: () => void; onDone: (data: CountDetail) => void }) {
  const workspace = useWorkspaceContext();
  const preview = useQuery({ queryKey: scopedQueryKey(workspace, "stock-counts", "detail", detail.count.id, "adjustment-preview"), queryFn: () => previewAdjustment(detail.count.id) });
  const [releases, setReleases] = useState<Record<string, string>>({});
  const complete = useMutation({ mutationFn: () => completeCount(detail.count.id, Object.entries(releases).filter(([, value]) => value).map(([reservationId, value]) => ({ reservationId, action: "release" as const, quantity: value }))),
    onSuccess: onDone });
  const conflicts = (preview.data?.impact?.lines ?? []).flatMap((line) => line.parts.filter((part) => part.shortfall > 0).map((part) => ({ line, part })));
  const blocking = (preview.data?.errors ?? []).filter((entry) => entry.code !== "ADJUSTMENT_RESERVATION_CONFLICT");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Complete ${detail.count.number}`}>
      <div className="flex flex-col gap-3 text-sm">
        {preview.isLoading ? <LoadingState label="Preparing the adjustment" rows={3} /> : preview.data ? (preview.data.lines === 0
          ? <p>No variance to adjust: completing records the count and releases the freeze — no adjustment, no movement, no journal.</p> : <>
            <p>{preview.data.lines} adjustment line{preview.data.lines === 1 ? "" : "s"} will post (Physical count gain / loss).</p>
            {preview.data.impact?.value && <p>Estimated value: found {money(preview.data.impact.value.increase)}, lost {money(preview.data.impact.value.decrease)}, net {money(preview.data.impact.value.net)}.</p>}
            {blocking.length > 0 && <ul className="list-disc rounded-[var(--radius-control)] bg-danger-soft py-2 pl-6 pr-2 text-danger">{blocking.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}
            {conflicts.length > 0 && <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft p-3">
              <p className="font-medium">Reservation conflict: release what can no longer be fulfilled</p>
              {conflicts.map(({ line, part }) => part.reservations.map((reservation) => (
                <div key={reservation.id} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
                  <span>{line.sku}: {quantity(part.shortfall)} short · {reservation.number}{reservation.document ? ` (${reservation.document})` : ""} holds {quantity(reservation.quantity)}</span>
                  <TextField aria-label="Release" inputMode="decimal" isDisabled={!detail.capabilities.resolveReservations} value={releases[reservation.id] ?? ""}
                    onChange={(value) => setReleases((current) => ({ ...current, [reservation.id]: value }))} placeholder={String(Math.min(part.shortfall, reservation.quantity))} />
                </div>)))}
              {!detail.capabilities.resolveReservations && <p className="text-warning">Resolving reservation conflicts needs its permission; reallocate them on the reservation first, or ask an inventory manager.</p>}
            </div>}
          </>) : <ErrorBanner message={errorMessage(preview.error)} />}
        <ErrorBanner message={complete.isError ? errorMessage(complete.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isDisabled={!preview.data || blocking.length > 0} isLoading={complete.isPending} onPress={() => complete.mutate()}>Complete count</Button></div>
      </div>
    </Dialog>
  );
}
