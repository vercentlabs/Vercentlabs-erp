"use client";

// Assets — Opening / Existing Assets. A company bringing in the assets it already owns: a migration batch is started from a CSV or Excel
// file (or one asset by hand) with an explicit cutover date; rows are validated and corrected, matches with the register resolved (link,
// create or skip), then valid rows registered — each on its own. Finance reviews the opening values, reconciles them with its opening
// balances per account, approves them (never the person who started the migration) and closes the batch, which locks them. Nothing here
// posts a journal or recreates years of history.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { REGISTER_BASE, dateLabel, errorMessage, errorStatus, getAssetView, getOptions, money } from "../register/register-api";
import {
  BATCH_TONE, OPENING_BASE, OPENING_REPORT_KINDS, POSITION_TONE, ROW_TONE, batchAction, batchExportHref, getBatch, getBatches, getExceptions, getHistory, getOpeningReport, getOverview, getReconciliation,
  openingAction, templateHref, uploadOpeningFile, type AssetOpening, type Batch, type BatchDetail, type OpeningEvent, type Position, type Row,
} from "./opening-api";

const VIEWS = [{ id: "overview", label: "Overview" }, { id: "import", label: "Import Assets" }, { id: "drafts", label: "Draft Batches" }, { id: "issues", label: "Validation Issues" },
  { id: "finance", label: "Finance Review" }, { id: "completed", label: "Completed Imports" }, { id: "history", label: "History" }];

function BatchTable({ rows, empty }: { rows: Batch[]; empty: string }) {
  return (
    <LinesTable columns={["Batch", "Source", "Cutover", "Status", { label: "Rows", numeric: true }, { label: "Registered", numeric: true }, { label: "To fix", numeric: true }, "Started"]} empty={rows.length ? undefined : empty}>
      {rows.map((b) => <tr key={b.id}><Cell><Link className="text-brand hover:underline" href={b.href}>{b.number}</Link></Cell><Cell>{b.source === "FILE" ? b.fileName : "Entered by hand"}</Cell><Cell>{dateLabel(b.cutoverDate)}</Cell>
        <Cell><StatusBadge tone={BATCH_TONE[b.status]}>{b.statusLabel}</StatusBadge></Cell><Cell numeric>{b.rows}</Cell><Cell numeric>{b.registered}</Cell><Cell numeric>{b.exceptions}</Cell>
        <Cell>{`${formatDateTime(b.createdAt)}${b.createdBy ? ` · ${b.createdBy}` : ""}`}</Cell></tr>)}
    </LinesTable>
  );
}
function EventTable({ rows, showBatch = true }: { rows: OpeningEvent[]; showBatch?: boolean }) {
  return (
    <LinesTable columns={["When", ...(showBatch ? ["Batch"] : []), "What", "Asset", "By", "Reason"]} empty={rows.length ? undefined : "Nothing recorded yet."}>
      {rows.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell>{showBatch && <Cell><Link className="text-brand hover:underline" href={`${OPENING_BASE}/${e.batchId}`}>{e.batch}</Link></Cell>}
        <Cell>{e.actionLabel}</Cell><Cell>{e.asset}</Cell><Cell>{e.by}</Cell><Cell>{e.reason}</Cell></tr>)}
    </LinesTable>
  );
}

// ------------------------------------------------------------------ the workspace
export function OpeningWorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const overview = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "overview"), queryFn: getOverview, retry: false });
  const group = view === "drafts" ? "open" : view === "finance" ? "finance" : view === "completed" ? "completed" : null;
  const batches = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "batches", group), queryFn: () => getBatches(group ?? "all"), retry: false, enabled: Boolean(group) });
  const issues = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "issues"), queryFn: getExceptions, retry: false, enabled: view === "issues" });
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "history"), queryFn: () => getHistory(), retry: false, enabled: view === "history" });
  if (overview.isError && errorStatus(overview.error) === 403) return <PermissionState title="You can't see the opening migration" description="It needs an opening-assets permission." />;
  if (overview.isLoading) return <LoadingState label="Loading" rows={4} />;
  if (!overview.data) return <Notice tone="danger">{errorMessage(overview.error)}</Notice>;
  const o = overview.data;
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Opening / Existing Assets" description="Bring in the assets the Company already owns, as of a cutover date. Each becomes an ordinary register asset; its opening values are Finance's to approve. Nothing is posted from here."
        primaryAction={o.can.upload || o.can.create ? <span className="flex flex-wrap gap-2">{o.can.upload && <Button variant="primary" onPress={() => select("import")}>Import assets</Button>}
          {o.can.create && <LinkButton variant="secondary" href={`${OPENING_BASE}/new`}>Add one existing asset</LinkButton>}</span> : undefined} />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Opening views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" && <OverviewTab overview={o} />}
      {view === "import" && <ImportTab cutover={o.cutoverDate} canUpload={o.can.upload} canCreate={o.can.create} />}
      {group && (batches.isLoading ? <LoadingState label="Loading batches" rows={3} /> : batches.isError ? <Notice tone="danger">{errorMessage(batches.error)}</Notice>
        : <BatchTable rows={batches.data ?? []} empty={view === "drafts" ? "No unfinished migrations." : view === "finance" ? "Nothing waits for Finance." : "No completed migrations yet."} />)}
      {view === "issues" && (issues.isLoading ? <LoadingState label="Loading" rows={3} /> : (
        <LinesTable columns={["Batch", "Row", "Asset", "Issue", "Details"]} empty={(issues.data ?? []).length ? undefined : "No rows need attention."}>
          {(issues.data ?? []).map((e) => <tr key={`${e.batch}-${e.row}`}><Cell>{e.batch}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.row}</Link></Cell><Cell>{e.name}</Cell>
            <Cell><StatusBadge tone={e.kind === "Possible duplicate" ? "warning" : "danger"}>{e.kind}</StatusBadge></Cell><Cell>{e.issue}</Cell></tr>)}
        </LinesTable>
      ))}
      {view === "history" && (history.isLoading ? <LoadingState label="Loading" rows={3} /> : history.isError ? <Notice tone="warning">{errorMessage(history.error)}</Notice> : <EventTable rows={history.data ?? []} />)}
    </div>
  );
}
function OverviewTab({ overview: o }: { overview: Awaited<ReturnType<typeof getOverview>> }) {
  const workspace = useWorkspaceContext();
  const kinds = OPENING_REPORT_KINDS.filter((k) => !k.money || o.can.financials);
  const [kind, setKind] = useState(kinds[0]?.id ?? "opening-register");
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "report", kind), queryFn: () => getOpeningReport(kind), retry: false });
  const rows = report.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((k) => k !== "href") : [];
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Cutover" description="The day Vercentlabs takes over from the earlier register. Every migration uses it; once a migration closes it is fixed.">
        <FactList columns={3} items={[["Company cutover", o.cutoverDate ? dateLabel(o.cutoverDate) : "Not set yet — chosen on the first import"], ["Assets brought in", String(o.counts.migrated)],
          ["Unfinished migrations", String(o.counts.openBatches)], ["Rows to fix", String(o.counts.rowExceptions)], ["Waiting for Finance", String(o.counts.pendingFinance)], ["Values to review", String(o.counts.needsReview)]]} />
      </Panel>
      {o.totals && <Panel title="Opening values" description="Totals of the opening positions recorded so far, for Finance.">
        <FactList columns={2} items={[["Cost", money(o.totals.cost)], ["Accumulated depreciation", money(o.totals.accumulatedDepreciation)], ["Impairment", money(o.totals.impairment)], ["Opening carrying value", money(o.totals.carrying)]]} />
      </Panel>}
      <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={kinds.map((k) => ({ value: k.id, label: k.label }))} />}>
        {report.isLoading ? <LoadingState label="Loading" rows={3} /> : report.isError ? <Notice tone="warning">{errorMessage(report.error)}</Notice> : (
          <LinesTable columns={cols.length ? cols.map((c) => c.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
            {rows.map((r, i) => <tr key={i}>{cols.map((c, j) => <Cell key={c}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{String(r[c] ?? "")}</Link> : String(r[c] ?? "")}</Cell>)}</tr>)}
          </LinesTable>
        )}
      </Panel>
    </div>
  );
}
function ImportTab({ cutover, canUpload, canCreate }: { cutover: string | null; canUpload: boolean; canCreate: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [date, setDate] = useState(cutover ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      if (file.size > 10_000_000) throw new Error("Use a file under 10 MB, or split it.");
      const r = await uploadOpeningFile(file, date);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
      router.replace(`${OPENING_BASE}/${r.batchId}`);
    } catch (f) { setError(errorMessage(f)); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <Panel title="1. Prepare the file" description="One row per asset. Categories, locations, stores and departments by code or name; custodians by e-mail; dates as YYYY-MM-DD (Excel dates are read too); amounts as numbers — formulas are refused.">
        <ul className="list-disc pl-5 text-sm">
          <li>Status from the earlier register: active, in storage, not installed, under repair, on hold, retired, missing, lost or disposed.</li>
          <li>Fixed assets need their historical cost; give accumulated depreciation, impairment and remaining useful life so depreciation continues from the cutover — never repeated.</li>
          <li>A previous asset code is kept beside the new system code and still finds the asset.</li>
        </ul>
        <span className="flex flex-wrap gap-2"><LinkButton size="compact" variant="secondary" href={templateHref("xlsx")}>Excel template</LinkButton><LinkButton size="compact" variant="ghost" href={templateHref("csv")}>CSV template</LinkButton></span>
      </Panel>
      {canUpload ? (
        <Panel title="2. Upload" description="Nothing is created yet: the file becomes a draft batch to check and correct, row by row.">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Cutover date" type="date" value={date} onChange={setDate} isRequired isDisabled={Boolean(cutover)} description={cutover ? "The Company's cutover is set." : "The day the earlier register stops."} />
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium">File (.csv or .xlsx)</span>
              <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Existing assets file" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          </div>
          <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={busy || !file || !date} onPress={upload}>Upload and validate</Button></div>
        </Panel>
      ) : <Notice tone="info">Uploading a register needs the upload permission.</Notice>}
      {canCreate && <Panel title="Just one or two assets?"><span><LinkButton size="compact" variant="secondary" href={`${OPENING_BASE}/new`}>Add an existing asset by hand</LinkButton></span></Panel>}
    </div>
  );
}

// ------------------------------------------------------------------ one batch
const BATCH_TABS = [{ id: "rows", label: "Rows" }, { id: "finance", label: "Finance Review" }, { id: "history", label: "History" }];
const ROW_FILTERS = [{ value: "", label: "All rows" }, { value: "INVALID", label: "Needs correction" }, { value: "DUPLICATE", label: "Possible duplicates" }, { value: "VALID", label: "Ready" },
  { value: "REGISTERED", label: "Registered" }, { value: "LINKED", label: "Linked" }, { value: "SKIPPED", label: "Skipped" }];
export function OpeningBatchScreen({ batchId }: { batchId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "rows");
  const [rowStatus, setRowStatus] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "batch", batchId, rowStatus, search), queryFn: () => getBatch(batchId, { rowStatus: rowStatus || undefined, search: search || undefined }), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <LoadingState label="Loading the migration" rows={5} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see this migration" description="It needs an opening-assets permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const b = q.data;
  const refresh = async (text: string, tone: "success" | "warning" = "success") => { setMessage({ tone, text }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const act = async (action: string, input: Record<string, unknown>, text: (r: Record<string, unknown>) => string) => {
    setBusy(true); setMessage(null);
    try { const r = await batchAction(b.id, action, input); await refresh(text(r)); } catch (f) { setMessage({ tone: "danger", text: errorMessage(f) }); } finally { setBusy(false); }
  };
  const selectTab = (id: string) => { setTab(id); router.replace(`${pathname}?tab=${id}`, { scroll: false }); };
  const ready = b.counts.VALID ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${b.number} · ${b.source === "FILE" ? b.fileName : "Entered by hand"}`} description={`Cutover ${dateLabel(b.cutoverDate)}. ${b.registered} of ${b.rows} row(s) registered.`}
        primaryAction={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={BATCH_TONE[b.status]}>{b.statusLabel}</StatusBadge>
          {b.can.validate && <Button variant="secondary" isDisabled={busy} onPress={() => act("validate", {}, () => "Validated again.")}>Validate</Button>}
          {b.can.register && <Button variant="primary" isLoading={busy} isDisabled={busy} onPress={() => setAsk({ title: `Register ${ready} asset(s)`, confirm: "Register",
            description: "Each ready row becomes a registered asset with its own system code, opening location, custody and status. A row that fails is left to correct; the others still register. Registered rows are never registered twice.",
            fields: [], run: async () => { const r = await batchAction<{ results: Array<{ ok: boolean }> }>(b.id, "register", { expectedVersion: b.version });
              const ok = r.results.filter((x) => x.ok).length; await refresh(`${ok} registered${r.results.length - ok ? `, ${r.results.length - ok} need correcting` : ""}.`, r.results.length - ok ? "warning" : "success"); } })}>{`Register ${ready}`}</Button>}
          {b.can.cancel && <Button variant="ghost" isDisabled={busy} onPress={() => setAsk({ title: "Cancel this migration", confirm: "Cancel migration", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea" }],
            run: async (v) => { await batchAction(b.id, "cancel", { reason: v.reason || undefined }); await refresh("Cancelled."); } })}>Cancel</Button>}
          {b.can.export && <Link className="text-sm text-brand hover:underline" href={batchExportHref(b.id)}>Export rows</Link>}
          <Link className="text-sm text-brand hover:underline" href={`${OPENING_BASE}?view=drafts`}>All migrations</Link>
        </span>} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => selectTab(String(k))}>
        <TabList aria-label="Migration views">{BATCH_TABS.filter((t) => t.id !== "finance" || b.can.financials).filter((t) => t.id !== "history" || b.can.audit).map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
      </Tabs>
      {tab === "rows" && <>
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Show" size="compact" selectedKey={rowStatus} onSelectionChange={(k) => setRowStatus(String(k ?? ""))} options={ROW_FILTERS} />
          <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Name, previous code or serial" />
          <span className="text-xs text-text-muted">{ROW_FILTERS.slice(1).map((f) => `${f.label}: ${b.counts[f.value] ?? 0}`).join(" · ")}</span>
        </div>
        <RowsTable batch={b} onAsk={setAsk} onDone={refresh} />
      </>}
      {tab === "finance" && b.can.financials && <FinanceTab batch={b} onAsk={setAsk} onDone={refresh} />}
      {tab === "history" && b.can.audit && <BatchHistory batchId={b.id} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
const CORRECTABLE = ["name", "category", "existing_asset_code", "serial_number", "asset_tag", "manufacturer", "model", "location", "store", "custodian_email", "department", "status", "condition", "acquisition_date",
  "available_for_use_date", "disposal_date", "original_cost", "capitalized_cost", "accumulated_depreciation", "accumulated_impairment", "other_adjustments", "opening_book_value", "residual_value",
  "remaining_useful_life_months", "useful_life_months", "depreciation_method", "tracking", "ownership", "evidence", "notes"];
function RowsTable({ batch: b, onAsk, onDone }: { batch: BatchDetail; onAsk: (a: Ask) => void; onDone: (text: string) => Promise<void> }) {
  const correct = (r: Row): Ask => {
    const firstField = r.errors.find((e) => e.field && CORRECTABLE.includes(e.field))?.field ?? "name";
    return { title: `Correct row ${r.row}`, confirm: "Save and revalidate", description: "The uploaded value is kept as it was; the correction is recorded beside it.",
      fields: [{ name: "column", label: "Field", kind: "select", required: true, options: CORRECTABLE.map((c) => ({ value: c, label: c.replace(/_/g, " ") })), initial: firstField },
        { name: "value", label: "Corrected value", kind: "text", initial: r.corrections[firstField] ?? r.raw[firstField] ?? "" }],
      run: async (v) => { const res = await batchAction<{ status: string }>(b.id, "row", { row: r.row, corrections: { [String(v.column)]: String(v.value ?? "") } }); await onDone(`Row ${r.row}: ${res.status === "VALID" ? "ready" : "still needs attention"}.`); } };
  };
  const resolve = (r: Row): Ask => ({ title: `Resolve row ${r.row}`, confirm: "Save", description: "It may already be in the register. Link it to that asset (nothing new is created), create a new asset anyway (for a serial shared by different equipment), or skip the row.",
    fields: [{ name: "resolution", label: "Decision", kind: "select", required: true, options: [{ value: "LINK", label: "Link to the existing asset" }, { value: "CREATE", label: "Create a new asset" }, { value: "SKIP", label: "Skip this row" }], initial: "LINK" },
      { name: "linkAssetId", label: "Existing asset (for a link)", kind: "select", options: r.matches.map((m) => ({ value: m.assetId, label: `${m.code} · ${m.name} — ${m.reason}` })), initial: r.matches[0]?.assetId }],
    run: async (v) => { await batchAction(b.id, "row", { row: r.row, resolution: v.resolution, linkAssetId: v.resolution === "LINK" ? v.linkAssetId : null }); await onDone(`Row ${r.row} resolved.`); } });
  return (
    <LinesTable columns={["Row", "Asset", "Category", "Status", "Earlier status", ...(b.can.financials ? [{ label: "Opening value", numeric: true }] : []), "Result", ""]} empty={b.rows.length ? undefined : "No rows match."}>
      {b.rows.map((r) => <tr key={r.row} id={`row-${r.row}`}>
        <Cell>{r.row}</Cell>
        <Cell>{r.name}<span className="block text-xs text-text-muted">{[r.existingCode && `Previous: ${r.existingCode}`, r.serialNumber && `Serial ${r.serialNumber}`].filter(Boolean).join(" · ")}</span></Cell>
        <Cell>{r.category}</Cell>
        <Cell><StatusBadge tone={ROW_TONE[r.status]}>{r.statusLabel}</StatusBadge></Cell>
        <Cell>{r.lifecycleLabel}</Cell>
        {b.can.financials && <Cell numeric>{r.values ? money(r.values.carrying) : ""}</Cell>}
        <Cell>{r.assetId ? <Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${r.assetId}?tab=acquisition`}>{r.assetNumber}</Link> : (
          <span className="flex flex-col gap-0.5 text-xs">
            {r.errors.map((e, i) => <span key={`e${i}`} className="text-danger">{e.message}</span>)}
            {r.status === "DUPLICATE" && r.matches.map((m) => <span key={m.assetId} className="text-warning">{`Matches ${m.code} (${m.reason})`}</span>)}
            {r.warnings.map((w, i) => <span key={`w${i}`} className="text-text-muted">{w.message}</span>)}
          </span>)}</Cell>
        <Cell>{b.can.edit && !["REGISTERED", "LINKED"].includes(r.status) && <span className="flex gap-1">
          <Button size="compact" variant="ghost" onPress={() => onAsk(correct(r))}>Correct</Button>
          {r.matches.length > 0 && <Button size="compact" variant="ghost" onPress={() => onAsk(resolve(r))}>Resolve</Button>}
          {r.status !== "SKIPPED" && !r.matches.length && <Button size="compact" variant="ghost" onPress={() => batchAction(b.id, "row", { row: r.row, resolution: "SKIP" }).then(() => onDone(`Row ${r.row} skipped.`))}>Skip</Button>}
        </span>}</Cell>
      </tr>)}
    </LinesTable>
  );
}
function FinanceTab({ batch: b, onAsk, onDone }: { batch: BatchDetail; onAsk: (a: Ask) => void; onDone: (text: string, tone?: "success" | "warning") => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const rec = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "reconciliation", b.id), queryFn: () => getReconciliation(b.id), retry: false, enabled: b.positions.length > 0 });
  const review = (p: Position): Ask => ({ title: `Review the opening value — ${p.asset}`, confirm: "Save", description: "Carrying value = cost − accumulated depreciation − impairment ± adjustments. Every change is recorded with its reason.",
    fields: [{ name: "capitalizedCost", label: "Cost", kind: "quantity", initial: p.capitalizedCost }, { name: "accumulatedDepreciation", label: "Accumulated depreciation", kind: "quantity", initial: p.accumulatedDepreciation },
      { name: "accumulatedImpairment", label: "Accumulated impairment", kind: "quantity", initial: p.accumulatedImpairment }, { name: "otherAdjustments", label: "Other adjustments", kind: "quantity", initial: p.otherAdjustments },
      { name: "residualValue", label: "Residual value", kind: "quantity", initial: p.residualValue }, { name: "remainingUsefulLifeMonths", label: "Remaining useful life (months)", kind: "quantity", initial: p.remaining === null ? "" : String(p.remaining) },
      { name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await openingAction("position-update", { positionId: p.id, ...v, remainingUsefulLifeMonths: v.remainingUsefulLifeMonths === "" ? null : Number(v.remainingUsefulLifeMonths) }); await onDone("Opening value updated."); } });
  const correctLocked = (p: Position): Ask => ({ title: `Correct a locked opening value — ${p.asset}`, confirm: "Record correction", tone: "danger",
    description: "Recorded as a new version, applied to the asset as a difference. Post any matching adjustment in Finance — nothing is posted from Assets.",
    fields: [{ name: "capitalizedCost", label: "Cost", kind: "quantity", initial: p.capitalizedCost }, { name: "accumulatedDepreciation", label: "Accumulated depreciation", kind: "quantity", initial: p.accumulatedDepreciation },
      { name: "accumulatedImpairment", label: "Accumulated impairment", kind: "quantity", initial: p.accumulatedImpairment }, { name: "reason", label: "Reason", kind: "textarea", required: true }, { name: "evidence", label: "Evidence", kind: "text", required: true }],
    run: async (v) => { await openingAction("position-correct", { positionId: p.id, ...v }); await onDone("Correction recorded."); } });
  const approve = (): Ask => ({ title: "Approve the opening values", confirm: "Approve", description: "The assets take these values and depreciation continues from them over the remaining life, from the day after cutover. You cannot approve a migration you started.",
    fields: [{ name: "mode", label: "Finance's opening balances", kind: "select", required: true, initial: b.financeOpeningBalanceId ? "PREPARED" : "LINKED",
      options: [{ value: "LINKED", label: "Already posted in Finance — link to them" }, ...(b.financeOpeningBalanceId ? [{ value: "PREPARED", label: "Prepared from this migration" }] : [])] },
      { name: "varianceReason", label: "If the totals differ: why the difference is accepted", kind: "textarea" }],
    run: async (v) => { await batchAction(b.id, "approve", { mode: v.mode, varianceReason: v.varianceReason || undefined, expectedVersion: b.version }); await onDone("Opening values approved."); } });
  const r = rec.data;
  return (
    <div className="flex flex-col gap-4">
      {b.positions.length === 0 ? <Notice tone="info">No opening values yet: they are proposed when fixed assets register.</Notice> : (
        <Panel title="Reconciliation with Finance" description={r?.note}
          actions={<span className="flex flex-wrap gap-2">
            {b.can.prepare && <Button size="compact" variant="secondary" onPress={() => onAsk({ title: "Prepare Finance's opening balance", confirm: "Prepare draft", fields: [],
              description: "For opening balances not yet in Finance: a draft opening-balance document (cost debit, accumulated depreciation credit, per account) for Finance's own workflow to complete and post — once.",
              run: async () => { const x = await batchAction<{ documentNumber?: string }>(b.id, "prepare-finance"); await onDone(`Draft ${x.documentNumber ?? ""} prepared in Finance.`); } })}>Prepare Finance draft</Button>}
            {b.can.approve && <Button size="compact" variant="primary" onPress={() => onAsk(approve())}>Approve</Button>}
            {b.can.close && <Button size="compact" variant="primary" onPress={() => onAsk({ title: "Close the migration", confirm: "Close", fields: [], description: "Locks the approved opening values and the Company's cutover. Later changes are recorded corrections.",
              run: async () => { await batchAction(b.id, "close"); await onDone("Closed: the opening values are locked."); } })}>Close</Button>}
          </span>}>
          {rec.isLoading ? <LoadingState label="Reconciling" rows={2} /> : !r ? <Notice tone="warning">{errorMessage(rec.error)}</Notice> : <>
            <Notice tone={r.matched ? "success" : "warning"}>{r.matched ? "The asset totals agree with Finance for every account." : `The totals do not agree yet (${r.source === "PREPARED" ? "against the prepared draft" : "against posted opening balances"}).`}</Notice>
            <LinesTable columns={["Account", "Measure", "Categories", { label: "Assets", numeric: true }, { label: "Finance", numeric: true }, { label: "Difference", numeric: true }]} empty={r.lines.length ? undefined : "No accounts."}>
              {r.lines.map((l) => <tr key={`${l.accountId}${l.side}`}><Cell>{l.account}</Cell><Cell>{l.measure}</Cell><Cell>{l.categories.join(", ")}</Cell><Cell numeric>{money(l.register)}</Cell><Cell numeric>{money(l.finance)}</Cell>
                <Cell numeric className={l.matched ? "" : "text-danger"}>{money(l.variance)}</Cell></tr>)}
            </LinesTable>
            {r.unmapped.map((u, i) => <Notice key={i} tone="warning">{u.note}</Notice>)}
            {b.varianceNote && <p className="text-sm">{`Accepted difference: ${b.varianceNote}`}</p>}
          </>}
        </Panel>
      )}
      {b.positions.length > 0 && <Panel title="Opening positions">
        <LinesTable columns={["Asset", { label: "Cost", numeric: true }, { label: "Accumulated", numeric: true }, { label: "Carrying", numeric: true }, { label: "Remaining (months)", numeric: true }, "Status", ""]}>
          {b.positions.map((p) => <tr key={p.id}><Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${p.assetId}?tab=acquisition`}>{p.asset}</Link>{p.reviewNote && <span className="block text-xs text-text-muted">{p.reviewNote}</span>}</Cell>
            <Cell numeric>{money(p.capitalizedCost, p.currency)}</Cell><Cell numeric>{money(String(Number(p.accumulatedDepreciation) + Number(p.accumulatedImpairment)), p.currency)}</Cell><Cell numeric>{money(p.openingCarryingAmount, p.currency)}</Cell>
            <Cell numeric>{p.remaining === null ? "" : String(p.remaining)}</Cell><Cell><StatusBadge tone={POSITION_TONE[p.status]}>{p.statusLabel}</StatusBadge></Cell>
            <Cell>{["PROPOSED", "NEEDS_REVIEW"].includes(p.status) && b.can.approve ? <Button size="compact" variant="ghost" onPress={() => onAsk(review(p))}>Review</Button>
              : p.status === "LOCKED" && b.can.correct ? <Button size="compact" variant="ghost" onPress={() => onAsk(correctLocked(p))}>Correct</Button> : null}</Cell></tr>)}
        </LinesTable>
      </Panel>}
    </div>
  );
}
function BatchHistory({ batchId }: { batchId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "history", batchId), queryFn: () => getHistory(batchId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (q.isError) return <Notice tone="warning">{errorMessage(q.error)}</Notice>;
  return <EventTable rows={q.data ?? []} showBatch={false} />;
}

// ------------------------------------------------------------------ one existing asset, by hand
type Manual = Record<string, string>;
const blankManual = (cutover: string | null): Manual => ({ cutoverDate: cutover ?? "", name: "", category: "", existing_asset_code: "", manufacturer: "", model: "", serial_number: "", asset_tag: "",
  tracking: "fixed", ownership: "owned", status: "active", acquisition_date: "", available_for_use_date: "", location: "", custodian_email: "", department: "", condition: "GOOD",
  original_cost: "", accumulated_depreciation: "", accumulated_impairment: "", residual_value: "", remaining_useful_life_months: "", evidence: "", supplier: "", purchase_reference: "", notes: "" });
const STATUSES = ["active", "in storage", "not installed", "under repair", "on hold", "retired", "missing", "lost"].map((s) => ({ value: s, label: s.replace(/^./, (x) => x.toUpperCase()) }));
export function ManualOpeningScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const overview = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "opening", "overview"), queryFn: getOverview, retry: false });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const submit = useSubmitKey();
  const [form, setForm] = useState<Manual | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (overview.isLoading || options.isLoading) return <LoadingState label="Preparing the form" rows={6} />;
  if (overview.isError && errorStatus(overview.error) === 403) return <PermissionState title="You can't add existing assets" description="It needs the opening-assets permission." />;
  const f = form ?? blankManual(overview.data?.cutoverDate ?? null);
  const set = (k: string) => (v: string) => setForm({ ...f, [k]: v });
  const fixed = f.tracking === "fixed";
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await submit.run(() => openingAction<{ batchId: string; status: string; errors: Array<{ message: string }>; assetId: string | null }>("manual", Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""))));
      if (r.assetId) { setDone(true); router.replace(`${REGISTER_BASE}/${r.assetId}?tab=acquisition`); return; }
      setDone(true); router.replace(`${OPENING_BASE}/${r.batchId}`);
    } catch (x) { setError(errorMessage(x)); setBusy(false); }
  };
  const opt = (rows: Array<{ code: string; name: string }> | undefined) => (rows ?? []).map((r) => ({ value: r.name, label: `${r.code} · ${r.name}` }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Add an existing asset" description="An asset the Company already owned before the cutover. It gets its own system code; its earlier code is kept. Its opening value goes to Finance for approval." />
      {error && <Notice tone="danger">{error}</Notice>}
      <FormSection title="The asset">
        <TextField label="Cutover date" type="date" value={f.cutoverDate} onChange={set("cutoverDate")} isRequired isDisabled={Boolean(overview.data?.cutoverDate)} />
        <TextField label="Name" value={f.name} onChange={set("name")} isRequired />
        <Select label="Category" selectedKey={f.category || null} onSelectionChange={(k) => set("category")(String(k ?? ""))} options={opt(options.data?.categories)} isRequired />
        <TextField label="Previous asset code" value={f.existing_asset_code} onChange={set("existing_asset_code")} description="The code on the earlier register or label." />
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Manufacturer" value={f.manufacturer} onChange={set("manufacturer")} /><TextField label="Model" value={f.model} onChange={set("model")} />
          <TextField label="Serial number" value={f.serial_number} onChange={set("serial_number")} /><TextField label="Asset tag" value={f.asset_tag} onChange={set("asset_tag")} /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Tracking" selectedKey={f.tracking} onSelectionChange={(k) => set("tracking")(String(k))} options={[{ value: "fixed", label: "Fixed asset" }, { value: "tracked", label: "Tracked only" }]} />
          <Select label="Ownership" selectedKey={f.ownership} onSelectionChange={(k) => set("ownership")(String(k))} options={[{ value: "owned", label: "Owned" }, { value: "leased", label: "Leased" }, { value: "loaned", label: "Borrowed" }]} />
          <Select label="Status before cutover" selectedKey={f.status} onSelectionChange={(k) => set("status")(String(k))} options={STATUSES} /></div>
      </FormSection>
      <FormSection title="Where it is and who has it">
        <Select label="Location" selectedKey={f.location || null} onSelectionChange={(k) => set("location")(String(k ?? ""))} options={opt(options.data?.locations)} />
        <Select label="Custodian" selectedKey={f.custodian_email || null} onSelectionChange={(k) => set("custodian_email")(String(k ?? ""))} options={(options.data?.users ?? []).map((u) => ({ value: u.email, label: u.name }))} />
        <Select label="Department" selectedKey={f.department || null} onSelectionChange={(k) => set("department")(String(k ?? ""))} options={opt(options.data?.departments)} />
        <Select label="Condition" selectedKey={f.condition} onSelectionChange={(k) => set("condition")(String(k))} options={["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"].map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() }))} />
      </FormSection>
      <FormSection title="Acquisition and opening value" description={fixed ? "Historical cost is required; a missing invoice is noted under evidence, never entered as zero." : "A tracked-only asset carries no opening value."}>
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Acquisition date" type="date" value={f.acquisition_date} onChange={set("acquisition_date")} />
          <TextField label="Available for use" type="date" value={f.available_for_use_date} onChange={set("available_for_use_date")} /></div>
        {fixed && <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Original cost" inputMode="decimal" value={f.original_cost} onChange={set("original_cost")} isRequired /><TextField label="Accumulated depreciation" inputMode="decimal" value={f.accumulated_depreciation} onChange={set("accumulated_depreciation")} />
          <TextField label="Accumulated impairment" inputMode="decimal" value={f.accumulated_impairment} onChange={set("accumulated_impairment")} /><TextField label="Residual value" inputMode="decimal" value={f.residual_value} onChange={set("residual_value")} />
          <TextField label="Remaining useful life (months)" inputMode="numeric" value={f.remaining_useful_life_months} onChange={set("remaining_useful_life_months")} /></div>}
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Supplier" value={f.supplier} onChange={set("supplier")} /><TextField label="Purchase reference" value={f.purchase_reference} onChange={set("purchase_reference")} /></div>
        <TextField label="Evidence" value={f.evidence} onChange={set("evidence")} placeholder="e.g. Purchase invoice on file" />
        <TextArea label="Notes" value={f.notes} onChange={set("notes")} />
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(OPENING_BASE)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={busy || done || f.name.trim().length < 2 || !f.category || !f.cutoverDate} onPress={save}>Add asset</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the asset's opening history (Acquisition tab)
export function AssetOpeningPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "opening"), queryFn: () => getAssetView<AssetOpening>(assetId, "opening"), retry: false });
  if (q.isLoading || q.isError || !q.data || !q.data.migrated) return null;
  const d = q.data;
  return (
    <Panel title="Opening / Migration" description={d.note}>
      <FactList columns={3} items={[["Migrated", d.linked ? "Linked to an asset already registered" : "From the existing assets register"], ["Batch", <Link key="b" className="text-brand hover:underline" href={d.batchHref}>{`${d.batch}, row ${d.row}`}</Link>],
        ["Cutover", dateLabel(d.cutoverDate)], ["Previous code", d.legacyCode ?? "—"], ["Acquired", dateLabel(d.acquisitionDate)], ["Supplier", d.supplier ?? "—"], ["Purchase reference", d.purchaseReference ?? "—"], ["Evidence", d.evidence ?? "None recorded"],
        ...(d.position ? [["Opening cost", money(d.position.capitalizedCost, d.position.currency)], ["Accumulated depreciation", money(d.position.accumulatedDepreciation, d.position.currency)],
          ["Opening carrying value", money(d.position.openingCarryingAmount, d.position.currency)], ["Finance validation", <StatusBadge key="s" tone={POSITION_TONE[d.position.status]}>{d.position.statusLabel}</StatusBadge>]] as Array<[string, ReactNode]> : [])]} />
      {d.corrections.length > 0 && <LinesTable columns={["When", "Change", "By", "Reason"]}>
        {d.corrections.map((c, i) => <tr key={i}><Cell>{formatDateTime(c.at)}</Cell><Cell>{c.action === "POSITION_CORRECTED" ? "Correction" : "Finance review"}</Cell><Cell>{c.by}</Cell><Cell>{c.reason}</Cell></tr>)}
      </LinesTable>}
    </Panel>
  );
}
