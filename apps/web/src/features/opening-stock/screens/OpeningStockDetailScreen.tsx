"use client";

// One Opening Stock document: Overview, Items (edited while a draft), Lots & Serials, Valuation, Accounting, Import Report, Attachments and
// History. Actions: Save lines, Validate, Import spreadsheet, Post (stronger permission; zero-cost lines need a reason, backdating a
// confirmation), Cancel draft and — while nothing has used the stock — Reverse. A posted document never changes: later differences are
// Inventory adjustments.
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge, Button, Checkbox, ComboBox, Dialog, EmptyState, ErrorState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { ErrorBanner, money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  cancelOpeningStock, errorCode, errorMessage, findingsOf, getOpeningOptions, getOpeningStock, getReversalBlockers, importOpeningStockFile, openingFileUrl, postOpeningStock, removeOpeningFile,
  reverseOpeningStock, templateUrl, updateOpeningStock, uploadOpeningFile, validateOpeningStock, type Disposition, type Finding, type ImportResult, type LineInput, type OpeningDocument,
  type Validation,
} from "../api/opening-stock-api";
import { OPENING_BASE, STATUS_TONE } from "./OpeningStockListScreen";

const TABS = ["overview", "items", "tracking", "valuation", "accounting", "imports", "files", "history"] as const;
const DISPOSITIONS: Array<{ value: Disposition; label: string }> = [
  { value: "available", label: "Available" }, { value: "quality_hold", label: "Quality hold" }, { value: "quarantined", label: "Quarantined" }, { value: "damaged", label: "Damaged" },
];



function Findings({ validation }: { validation: Validation }) {
  const { summary } = validation;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm">
      <p className="font-medium">Validation · {summary.warehouse}</p>
      <p className="text-text-secondary">{summary.items} items · {summary.lines} lines · {summary.batches} batches · {summary.serials} serials
        {summary.value !== undefined ? ` · ${money(summary.value)}` : ""} · {validation.errors.length} errors · {validation.warnings.length} warnings</p>
      {validation.errors.length > 0 && <ul className="list-disc pl-5 text-danger">{validation.errors.map((entry, index) => <li key={`e${index}`}>{entry.message}</li>)}</ul>}
      {validation.warnings.length > 0 && <ul className="list-disc pl-5 text-warning">{validation.warnings.map((entry, index) => <li key={`w${index}`}>{entry.message}</li>)}</ul>}
      {!validation.errors.length && !validation.warnings.length && <p className="text-success">Ready to post.</p>}
    </div>
  );
}

export function OpeningStockDetailScreen({ documentId, initialTab }: { documentId: string; initialTab?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(initialTab && (TABS as readonly string[]).includes(initialTab) ? initialTab : "overview");
  const [dialog, setDialog] = useState<"post" | "import" | "cancel" | "reverse" | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "opening-stock", "one", documentId);
  const query = useQuery({ queryKey: key, queryFn: () => getOpeningStock(documentId) });
  const refresh = (message?: string) => {
    setError(null);
    if (message) setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "opening-stock") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") });
  };
  const validate = useMutation({ mutationFn: () => validateOpeningStock(documentId), onSuccess: (result) => { setValidation(result); refresh(); }, onError: (failure) => setError(errorMessage(failure)) });

  if (query.isLoading) return <LoadingState label="Loading opening stock" rows={6} />;
  if (query.isError) return errorCode(query.error) === "OPENING_STOCK_NOT_FOUND"
    ? <EmptyState title="Opening stock not found" description="It may belong to another workspace." action={{ label: "All opening stock", onPress: () => router.push(OPENING_BASE) }} />
    : <ErrorState title="Could not load opening stock" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const document = query.data!;
  const can = document.capabilities;
  const draft = document.status === "draft";

  return (
    <>
    <RecordDetailsPage
      header={{
        title: <>{document.number} <span className="text-base font-normal whitespace-nowrap text-text-muted">{document.warehouseCode}</span></>,
        status: <StatusBadge tone={STATUS_TONE[document.status]}>{document.statusLabel}</StatusBadge>,
        fields: [
          { label: "As of", value: formatDate(document.openingDate) },
          { label: "Migration reference", value: document.migrationReference },
          ...(document.value !== undefined ? [{ label: "Value", value: money(document.value) }] : []),
        ],
        primaryAction: draft && can.post ? <Button variant="primary" onPress={() => { setError(null); setDialog("post"); }}>Post opening stock</Button> : undefined,
        secondaryActions: (
          <>
            {draft && <Button variant="secondary" isLoading={validate.isPending} onPress={() => { setNotice(null); validate.mutate(); }}>Validate</Button>}
            {draft && can.prepare && <Button variant="secondary" onPress={() => { setError(null); setDialog("import"); }}>Import spreadsheet</Button>}
            <MoreActions actions={[
              { id: "cancel", label: "Cancel draft", show: draft && can.prepare, run: () => setDialog("cancel") },
              { id: "reverse", label: "Reverse opening stock", show: document.status === "posted" && can.reverse, run: () => setDialog("reverse") },
            ]} />
          </>
        ),
      }}
      tabs={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {notice && <Notice tone="success">{notice}</Notice>}
          {validation && draft && <Findings validation={validation} />}
          {document.status === "posted" && <Notice tone="neutral">Posted opening stock is migration history and never changes. A quantity found wrong later is corrected with an Inventory adjustment.</Notice>}
        </div>
      }
    >
      <Tabs selectedKey={tab} onSelectionChange={(next) => setTab(String(next))}>
        <TabList aria-label="Opening stock sections">
          <Tab id="overview">Overview</Tab>
          <Tab id="items">Items</Tab>
          <Tab id="tracking">Lots &amp; Serials</Tab>
          {can.viewCost && <Tab id="valuation">Valuation</Tab>}
          {can.reconcile && <Tab id="accounting">Accounting</Tab>}
          <Tab id="imports">Import Report</Tab>
          <Tab id="files">Attachments</Tab>
          <Tab id="history">History</Tab>
        </TabList>
        <TabPanel id="overview" className="pt-3">
          <FactList items={[
            ["Company", workspace.organizationName], ["Warehouse", `${document.warehouseCode} · ${document.warehouseName}`], ["Opening (cutoff) date", document.openingDate],
            ["Accounting date", document.accountingDate], ["Migration reference", document.migrationReference], ["Source system", document.sourceSystem],
            ["External reference", document.externalReference], ["Status", document.statusLabel], ["Items", `${document.items} (${document.lines} lines)`],
            ...(document.value !== undefined ? [["Inventory value", money(document.value)] as [string, ReactNode]] : []), ["Currency", document.currencyCode],
            ["Created", `${formatDateTime(document.createdAt)}${document.createdBy ? ` · ${document.createdBy}` : ""}`],
            ["Posted", document.postedAt ? `${formatDateTime(document.postedAt)}${document.postedBy ? ` · ${document.postedBy}` : ""}` : null],
            ["Zero-cost reason", document.zeroCostReason], ["Reversal reason", document.reversalReason], ["Notes", document.notes],
          ]} />
        </TabPanel>
        <TabPanel id="items" className="pt-3">
          {draft && can.prepare ? <LinesEditor document={document} onSaved={(message) => { setValidation(null); refresh(message); }} /> : <DocumentLines document={document} />}
        </TabPanel>
        <TabPanel id="tracking" className="pt-3"><TrackingTable document={document} /></TabPanel>
        <TabPanel id="valuation" className="pt-3"><ValuationTable document={document} /></TabPanel>
        <TabPanel id="accounting" className="pt-3"><AccountingPanel document={document} /></TabPanel>
        <TabPanel id="imports" className="pt-3"><ImportsPanel document={document} /></TabPanel>
        <TabPanel id="files" className="pt-3"><FilesPanel document={document} onChanged={refresh} /></TabPanel>
        <TabPanel id="history" className="pt-3">
          <ol className="flex flex-col divide-y divide-border text-sm">
            {document.history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 py-2">
                <span>{entry.summary}{entry.reason ? <span className="text-text-muted"> · {entry.reason}</span> : null}</span>
                <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)}{entry.actorName ? ` · ${entry.actorName}` : ""}</span>
              </li>
            ))}
          </ol>
        </TabPanel>
      </Tabs>
    </RecordDetailsPage>

      {dialog === "post" && <PostDialog document={document} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setValidation(null); refresh(`${document.number} posted.`); }} />}
      {dialog === "import" && <ImportDialog document={document} onClose={() => setDialog(null)} onDone={(message) => { setDialog(null); refresh(message); setTab("items"); }} />}
      {dialog === "cancel" && <ReasonDialog title={`Cancel ${document.number}?`} description="Nothing was posted, so nothing moves. The migration reference can then be used again." confirm="Cancel draft"
        optional run={(reason) => cancelOpeningStock(document.id, reason)} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Cancelled."); }} />}
      {dialog === "reverse" && <ReverseDialog document={document} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Reversed: the stock and its Finance entry are taken back out."); }} />}
    </>
  );
}

function DocumentLines({ document }: { document: OpeningDocument }) {
  const cost = document.capabilities.viewCost;
  return (
    <LinesTable columns={["#", "SKU", "Item", "Location", "Qty", "Base qty", "Disposition", ...(cost ? ["Unit cost", "Value"] : [])]} empty={!document.lineItems.length ? "Nothing yet." : undefined}>
      {document.lineItems.map((line) => (
        <tr key={line.id}>
          <Cell numeric>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.itemName}</Cell><Cell>{line.locationCode}</Cell><Cell numeric>{quantity(line.quantity, line.uomCode)}</Cell>
          <Cell numeric>{quantity(line.baseQuantity, line.baseUomCode)}</Cell><Cell>{line.dispositionLabel}</Cell>
          {cost && <><Cell numeric>{line.unitCost === null || line.unitCost === undefined ? null : `${money(line.unitCost)} / ${line.uomCode}`}</Cell><Cell numeric>{money(line.value ?? 0)}</Cell></>}
        </tr>
      ))}
    </LinesTable>
  );
}

type Row = LineInput & { key: string };
const blankRow = (): Row => ({ key: Math.random().toString(36).slice(2), itemId: "", quantity: "", disposition: "available" });

function LinesEditor({ document, onSaved }: { document: OpeningDocument; onSaved: (message: string) => void }) {
  const options = useInvOptions();
  const [rows, setRows] = useState<Row[]>(() => document.lineItems.map((line) => ({
    key: line.id, id: line.id, itemId: line.itemId, locationId: line.locationId, quantity: String(line.quantity), uomId: line.uomId,
    unitCost: line.unitCost === null || line.unitCost === undefined ? "" : String(line.unitCost), disposition: line.disposition, batchNumber: line.batchNumber ?? "",
    manufacturedOn: line.manufacturedOn ?? "", expiresOn: line.expiresOn ?? "", serialNumbers: line.serialNumbers, notes: line.notes ?? "",
  })));
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => options.data?.items ?? [], [options.data]);
  const locations = (options.data?.locations ?? []).filter((location) => location.warehouse_id === document.warehouseId);
  const cost = document.capabilities.editCost;
  const update = (key: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const save = useMutation({
    mutationFn: () => updateOpeningStock(document.id, {
      expectedVersion: document.version,
      lines: rows.filter((row) => row.itemId).map((row) => ({
        id: row.id, itemId: row.itemId, quantity: row.quantity, disposition: row.disposition, serialNumbers: row.serialNumbers, locationId: row.locationId || null, uomId: row.uomId || null, unitCost: cost ? (row.unitCost === "" ? null : row.unitCost) : undefined, batchNumber: row.batchNumber || null,
        manufacturedOn: row.manufacturedOn || null, expiresOn: row.expiresOn || null, notes: row.notes || null,
      })),
    }),
    onSuccess: (saved) => onSaved(`${saved.lines} line${saved.lines === 1 ? "" : "s"} saved.`),
    onError: (failure) => setError(errorMessage(failure)),
  });
  if (options.isLoading) return <LoadingState label="Loading items" rows={3} />;
  const total = rows.reduce((sum, row) => {
    const value = Number(row.quantity) * Number(row.unitCost);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      <p className="text-sm text-text-muted">Enter each item where it physically is. Quantity in any inventory unit of the item (converted to its base unit); held stock goes to a quality location.
        {cost ? " Cost is per the unit entered." : " Someone who may enter costs completes the opening cost."}</p>
      {rows.map((row, index) => {
        const item = items.find((entry) => entry.id === row.itemId);
        const units = item ? [{ uomId: item.uom_id ?? "", code: item.base_uom ?? "Base", factor: "1" }, ...(item.units ?? [])] : [];
        const unit = units.find((entry) => entry.uomId === (row.uomId || item?.uom_id));
        const base = Number(row.quantity) * Number(unit?.factor ?? 1);
        return (
          <div key={row.key} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <ComboBox className="lg:col-span-2" label={`Line ${index + 1} · Item`} selectedKey={row.itemId || null} placeholder="Search SKU or name"
                options={items.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
                onSelectionChange={(selected) => selected !== null && update(row.key, { itemId: String(selected), uomId: null, batchNumber: "", serialNumbers: [] })} />
              <Select label="Location" selectedKey={row.locationId || "default"} onSelectionChange={(selected) => update(row.key, { locationId: selected === "default" ? null : String(selected) })}
                options={[{ value: "default", label: row.disposition === "available" ? "MAIN (default)" : "Quality location (default)" }, ...locations.map((entry) => ({ value: entry.id, label: entry.code }))]} />
              <TextField label="Quantity" inputMode="decimal" value={row.quantity} onChange={(value) => update(row.key, { quantity: value })} />
              <Select label="Unit" selectedKey={row.uomId || item?.uom_id || null} isDisabled={!item} onSelectionChange={(selected) => update(row.key, { uomId: String(selected) })}
                options={units.map((entry) => ({ value: entry.uomId, label: entry.code }))} />
              {cost ? <TextField label={`Unit cost${unit ? ` / ${unit.code}` : ""}`} inputMode="decimal" value={row.unitCost ?? ""} onChange={(value) => update(row.key, { unitCost: value })} />
                : <div />}
              <Select label="Disposition" selectedKey={row.disposition ?? "available"} onSelectionChange={(selected) => update(row.key, { disposition: String(selected) as Disposition })} options={DISPOSITIONS} />
              {item?.tracking_type === "batch" && <>
                <TextField label="Batch / lot" value={row.batchNumber ?? ""} onChange={(value) => update(row.key, { batchNumber: value })} />
                <TextField label="Manufactured" type="date" value={row.manufacturedOn ?? ""} onChange={(value) => update(row.key, { manufacturedOn: value })} />
                <TextField label={`Expiry${item.requires_expiry_date ? " *" : ""}`} type="date" value={row.expiresOn ?? ""} onChange={(value) => update(row.key, { expiresOn: value })} />
              </>}
              {item?.tracking_type === "serial" && (
                <TextArea className="lg:col-span-3" label="Serial numbers (one per base unit)" rows={2} value={(row.serialNumbers ?? []).join("\n")}
                  onChange={(value) => update(row.key, { serialNumbers: value.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean) })} />
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
              <span>{item && Number(row.quantity) > 0 ? `= ${base.toLocaleString("en-IN", { maximumFractionDigits: 6 })} ${item.base_uom ?? ""}${cost && row.unitCost ? ` · ${money(Number(row.quantity) * Number(row.unitCost))}` : ""}` : ""}
                {item?.tracking_type === "serial" ? ` · ${(row.serialNumbers ?? []).length} serial numbers` : ""}</span>
              <Button size="compact" variant="ghost" aria-label={`Remove line ${index + 1}`} onPress={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                <Trash2 className="size-4" aria-hidden="true" />Remove
              </Button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onPress={() => setRows((current) => [...current, blankRow()])}><Plus className="size-4" aria-hidden="true" />Add line</Button>
        <div className="flex items-center gap-3">
          {cost && <span className="text-sm text-text-muted">Total {money(total)}</span>}
          <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>Save draft</Button>
        </div>
      </div>
    </div>
  );
}

function TrackingTable({ document }: { document: OpeningDocument }) {
  const tracked = document.lineItems.filter((line) => line.batchNumber || line.serialNumbers.length);
  return (
    <LinesTable columns={["#", "SKU", "Location", "Batch / lot", "Manufactured", "Expiry", "Serial numbers", "Quantity", "Disposition"]} empty={!tracked.length ? "Nothing yet." : undefined}>
      {tracked.map((line) => (
        <tr key={line.id}>
          <Cell numeric>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.locationCode}</Cell><Cell>{line.batchNumber}</Cell><Cell>{line.manufacturedOn}</Cell><Cell>{line.expiresOn}</Cell>
          <Cell>{line.serialNumbers.length ? line.serialNumbers.join(", ") : null}</Cell><Cell numeric>{quantity(line.baseQuantity, line.baseUomCode)}</Cell><Cell>{line.dispositionLabel}</Cell>
        </tr>
      ))}
    </LinesTable>
  );
}

function ValuationTable({ document }: { document: OpeningDocument }) {
  return (
    <div className="flex flex-col gap-2">
      <LinesTable columns={["#", "SKU", "Item", "Entered", "Base qty", "Base unit cost", "Value"]} empty={!document.lineItems.length ? "Nothing yet." : undefined}>
        {document.lineItems.map((line) => (
          <tr key={line.id}>
            <Cell numeric>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.itemName}</Cell>
            <Cell numeric>{line.unitCost === null || line.unitCost === undefined ? null : `${quantity(line.quantity, line.uomCode)} × ${money(line.unitCost)}`}</Cell>
            <Cell numeric>{quantity(line.baseQuantity, line.baseUomCode)}</Cell><Cell numeric>{line.baseUnitCost === null || line.baseUnitCost === undefined ? null : money(line.baseUnitCost)}</Cell>
            <Cell numeric>{money(line.value ?? 0)}</Cell>
          </tr>
        ))}
      </LinesTable>
      {document.value !== undefined && <p className="text-right text-sm font-medium">Total {money(document.value)}</p>}
      <p className="text-xs text-text-muted">Posting opens one valuation layer per line at its base unit cost; later issues use the company&apos;s costing method.</p>
    </div>
  );
}

function AccountingPanel({ document }: { document: OpeningDocument }) {
  const accounting = document.accounting;
  if (!accounting) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><Badge tone={accounting.status === "reconciled" ? "success" : accounting.status === "needs_reconciliation" ? "warning" : "neutral"}>{accounting.label}</Badge></div>
      <FactList items={[
        ["Inventory opening value", accounting.inventoryValue === undefined ? null : money(accounting.inventoryValue)],
        ["Finance opening entry", accounting.financeValue === undefined ? null : money(accounting.financeValue)],
        ["Difference", accounting.difference === undefined ? null : money(accounting.difference)],
        ["Journal entry", accounting.journalNumber ?? (document.status === "posted" ? "None (no value to book)" : null)], ["Reversal entry", accounting.reversalJournalNumber],
      ]} />
      <p className="text-xs text-text-muted">Posting books Dr Inventory, Cr Opening balance equity in the Opening balance journal on the accounting date. Finance owns the ledger; this shows how the two agree.</p>
    </div>
  );
}

function ImportsPanel({ document }: { document: OpeningDocument }) {
  if (!document.imports.length) return <p className="py-4 text-sm text-text-muted">No spreadsheet was imported into this document.</p>;
  return (
    <div className="flex flex-col gap-4">
      {document.imports.map((entry) => (
        <section key={entry.id} className="flex flex-col gap-2">
          <p className="text-sm"><span className="font-medium">{entry.fileName}</span> · {entry.status === "applied" ? "Imported" : entry.status === "rejected" ? "Rejected" : "Checked"} · {entry.rows} rows,
            {" "}{entry.valid} valid, {entry.warnings} warnings, {entry.errors} errors · {formatDateTime(entry.uploadedAt)}</p>
          {entry.report.length > 0 && (
            <LinesTable columns={["Row", "SKU", "Outcome", "Message"]}>
              {entry.report.map((row) => <tr key={`${entry.id}-${row.rowNumber}`}><Cell numeric>{row.rowNumber}</Cell><Cell>{row.sku}</Cell><Cell>{row.outcome}</Cell><Cell>{row.message}</Cell></tr>)}
            </LinesTable>
          )}
        </section>
      ))}
    </div>
  );
}

function FilesPanel({ document, onChanged }: { document: OpeningDocument; onChanged: (message?: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({ mutationFn: (file: File) => uploadOpeningFile(document.id, file), onSuccess: () => onChanged("File added."), onError: (failure) => setError(errorMessage(failure)) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeOpeningFile(document.id, fileId), onSuccess: () => onChanged("File removed."), onError: (failure) => setError(errorMessage(failure)) });
  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      {document.capabilities.prepare && (
        <input type="file" aria-label="Attach a file" className="text-sm" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
      )}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {document.files.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-2 py-2">
            <a className="text-brand hover:underline" href={openingFileUrl(document.id, file.id)}>{file.fileName}</a>
            {document.status === "draft" && document.capabilities.prepare && <Button size="compact" variant="ghost" onPress={() => remove.mutate(file.id)}>Remove</Button>}
          </li>
        ))}
        {!document.files.length && <li className="py-2 text-text-muted">No files. Attach the legacy stock report, count sheets or valuation workings.</li>}
      </ul>
    </div>
  );
}

function PostDialog({ document, onClose, onDone }: { document: OpeningDocument; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "validation", document.id, document.version), queryFn: () => validateOpeningStock(document.id) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "options"), queryFn: getOpeningOptions, staleTime: 60_000 });
  const zeroCost = Boolean(check.data?.warnings.some((entry) => entry.code === "OPENING_STOCK_ZERO_COST"));
  const backdated = Boolean(check.data?.warnings.some((entry) => entry.code === "OPENING_STOCK_BACKDATED"));
  const run = useMutation({
    mutationFn: () => postOpeningStock(document.id, { expectedVersion: document.version, zeroCostReason: reason.trim() || undefined, acknowledgeBackdated: acknowledged }),
    onSuccess: onDone, onError: (failure) => { setErrors(findingsOf(failure)); setError(errorMessage(failure)); },
  });
  const blocked = Boolean(check.data?.errors.length) || (zeroCost && (!reason.trim() || !options.data?.capabilities.zeroCost)) || (backdated && (!acknowledged || !options.data?.capabilities.backdate));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Post ${document.number}?`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">Posting brings this stock into {document.warehouseCode} as of {document.openingDate}, opens its valuation and books Finance&apos;s opening entry. It cannot be edited afterwards.</p>
        {check.isLoading ? <LoadingState label="Validating" rows={2} /> : check.data ? <Findings validation={check.data} /> : <ErrorBanner message={errorMessage(check.error)} />}
        {errors.length === 0 && <ErrorBanner message={error} />}
        {zeroCost && (options.data?.capabilities.zeroCost
          ? <TextArea label="Why do some lines carry zero cost?" isRequired rows={2} value={reason} onChange={setReason} description="Such as free samples or fully written-down stock." />
          : <p className="text-sm text-danger">Zero-cost lines need someone with the zero-cost permission to post.</p>)}
        {backdated && (options.data?.capabilities.backdate
          ? <Checkbox isSelected={acknowledged} onChange={setAcknowledged}>Post this opening stock behind movements already recorded after the cutoff</Checkbox>
          : <p className="text-sm text-danger">Movements are already recorded after this cutoff: posting needs the backdate permission.</p>)}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={run.isPending} isDisabled={blocked || check.isLoading} onPress={() => run.mutate()}>Post opening stock</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ImportDialog({ document, onClose, onDone }: { document: OpeningDocument; onClose: () => void; onDone: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importOpeningStockFile(document.id, file!, dryRun),
    onSuccess: (result) => { if (result.dryRun) setReport(result); else onDone(`${result.lines} line${result.lines === 1 ? "" : "s"} imported from ${file?.name}.`); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Import opening stock"
      description={`Rows for ${document.warehouseCode}: SKU, Warehouse, Location, Qty, UOM, Unit Cost, Batch, Manufactured, Expiry, Serial (one per row), Disposition. Checked first; nothing is added until you import.`}>
      <div className="flex flex-col gap-3">
        <ErrorBanner message={run.isError ? errorMessage(run.error) : null} />
        <a className="text-sm text-brand hover:underline" href={templateUrl} download>Download the template</a>
        <input type="file" accept=".csv,.xlsx" aria-label="Opening stock file" className="text-sm" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReport(null); run.reset(); }} />
        {report && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Rows {report.rows} · valid {report.valid} · warnings {report.warnings} · errors {report.errors}</p>
            {report.results.some((row) => row.outcome !== "valid") && (
              <ul className="max-h-60 overflow-auto rounded-[var(--radius-control)] border border-border text-sm">
                {report.results.filter((row) => row.outcome !== "valid").map((row) => (
                  <li key={row.rowNumber} className="border-b border-border px-3 py-1.5 last:border-b-0">Row {row.rowNumber} · {row.sku}: <span className={row.outcome === "error" ? "text-danger" : "text-warning"}>{row.message}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="outline" isDisabled={!file} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check file</Button>
          <Button variant="primary" isDisabled={!file || !report || report.errors > 0} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import lines</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReasonDialog({ title, description, confirm, optional, run, onClose, onDone }: {
  title: string; description: string; confirm: string; optional?: boolean; run: (reason: string) => Promise<unknown>; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const action = useMutation({ mutationFn: () => run(reason.trim()), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description}>
      <div className="flex flex-col gap-3">
        <ErrorBanner message={action.isError ? errorMessage(action.error) : null} />
        <TextArea label="Reason" isRequired={!optional} rows={2} value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="danger" isLoading={action.isPending} isDisabled={!optional && !reason.trim()} onPress={() => action.mutate()}>{confirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReverseDialog({ document, onClose, onDone }: { document: OpeningDocument; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const blockers = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "reversal", document.id), queryFn: () => getReversalBlockers(document.id) });
  if (blockers.isLoading) return <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Reverse ${document.number}?`}><LoadingState label="Checking" rows={2} /></Dialog>;
  if (blockers.data?.length)
    return (
      <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Reversal blocked">
        <div className="flex flex-col gap-3 text-sm">
          <ul className="list-disc pl-5">{blockers.data.map((entry) => <li key={entry.code}>{entry.message}</li>)}</ul>
          <p>Correct the stock with an Inventory adjustment instead: it keeps the history auditable.</p>
          <div className="flex justify-end"><Button variant="secondary" onPress={onClose}>Close</Button></div>
        </div>
      </Dialog>
    );
  return <ReasonDialog title={`Reverse ${document.number}?`} description="Takes this stock back out of the warehouse and reverses Finance's opening entry. Use it for implementation mistakes before the stock is used."
    confirm="Reverse" run={(reason) => reverseOpeningStock(document.id, reason)} onClose={onClose} onDone={onDone} />;
}
