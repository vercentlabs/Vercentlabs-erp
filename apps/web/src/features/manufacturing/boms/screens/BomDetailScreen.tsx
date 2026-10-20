"use client";

// One BOM: its revisions and the chosen one's recipe; editing a draft; submitting, approving or rejecting, activating with an effective date,
// starting a new revision, retiring and archiving; the planning preview (requirements, availability, estimated cost, subassemblies made or
// taken from stock) with the Procurement hand-off and the frozen production recipe; comparison between revisions; where it is used; and its
// history. Revision control: a new revision copies an approved one; approval binds to the content; a revision is scheduled (or activated
// now) on its own effectivity window and the schedule can be cancelled before it starts; each draft edit is logged line by line; compare
// and impact open their own pages. Every button is offered only to those allowed, and the server checks again.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumb, Button, Dialog, ErrorState, LinkButton, PermissionState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { bomAvailability } from "@/features/manufacturing/availability/api/availability-api";
import {
  STATUS_LABEL, STATUS_TONE, archiveBom, bomOptions, errorIssues, errorMessage, errorStatus, freezeForProduction, getBom, inr, itemUnits, newKey, newRevision, qty, revisionAction,
  saveDraft, type Bom, type BomIssue, type PlanInput, type Preview,
} from "../api/bom-api";
import { BomEditor, payloadOf, stateFromRevision, type EditorState } from "../components/BomEditor";
import { BOM_BASE } from "./BomListScreen";

const ACTION_LABEL: Record<string, string> = { CREATED: "Created", EDITED: "Draft edited", SUBMITTED: "Submitted for approval", WITHDRAWN: "Withdrawn", APPROVED: "Approved", REJECTED: "Rejected",
  ACTIVATED: "Activated", SUPERSEDED: "Superseded", OBSOLETED: "Retired", REVISION_CREATED: "New revision started", DRAFT_DISCARDED: "Draft discarded", ARCHIVED: "BOM archived",
  SNAPSHOT_TAKEN: "Recipe frozen for production", SHORTAGES_HANDED_OFF: "Shortages handed to Procurement", EXPORTED: "Exported", SCHEDULED: "Scheduled",
  BECAME_EFFECTIVE: "Became effective", SCHEDULE_CANCELLED: "Schedule cancelled" };

type Ask = { action: string; title: string; label: string; reason?: boolean; dates?: boolean; product?: boolean; confirm: string };

export function BomDetailScreen({ bomId }: { bomId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [revisionId, setRevisionId] = useState<string | null>(params.get("revision"));
  const [tab, setTab] = useState(params.get("tab") ?? "recipe");
  const key = scopedQueryKey(workspace, "manufacturing", "bom", bomId, revisionId ?? "");
  const query = useQuery({ queryKey: key, queryFn: () => getBom(bomId, revisionId), retry: false });
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [issues, setIssues] = useState<BomIssue[]>([]);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(params.get("submitError") ? { tone: "danger", text: params.get("submitError")! } : null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the BOM" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to bills of materials" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the BOM" description={errorMessage(query.error)} />;
  }
  const bom = query.data;
  const r = bom.revision;
  const refresh = async (next?: Bom) => {
    if (next) { queryClient.setQueryData(scopedQueryKey(workspace, "manufacturing", "bom", bomId, next.revision?.id ?? ""), next); setRevisionId(next.revision?.id ?? null); }
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  const run = async (work: () => Promise<Bom | void>, text: string) => {
    setBusy(true);
    setMessage(null);
    setIssues([]);
    try { const next = await work(); await refresh(next ?? undefined); setMessage({ tone: "success", text }); return true; }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); setIssues(errorIssues(failure)); return false; } finally { setBusy(false); }
  };
  const act = (action: string, input: Record<string, unknown> = {}, text = "Done.") => run(async () => (await revisionAction(bom.id, r!.id, action, { expectedVersion: r!.version, ...input })).bom, text);
  const exportCsv = async () => {
    try {
      const { file } = await revisionAction<{ file: { fileName: string; csv: string } }>(bom.id, r!.id, "export");
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url; link.download = file.fileName; link.click();
      URL.revokeObjectURL(url);
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const can = bom.can;
  const actions = (
    <div className="flex flex-wrap gap-2">
      {can.edit && !editing && r && <Button size="compact" variant="secondary" onPress={() => { setEditing(stateFromRevision(r, bom.finishedItem.id, bom.name)); setTab("recipe"); }}>Edit draft</Button>}
      {can.submit && !editing && <Button size="compact" variant="primary" isLoading={busy} onPress={() => act("submit", {}, "Submitted for approval.")}>Submit for approval</Button>}
      {can.withdraw && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => act("withdraw", {}, "Back to draft.")}>Withdraw</Button>}
      {can.approve && <Button size="compact" variant="primary" isLoading={busy} onPress={() => act("approve", { contentHash: r?.contentHash }, "Approved.")}>Approve</Button>}
      {can.approve && <Button size="compact" variant="secondary" onPress={() => setAsk({ action: "reject", title: "Reject this revision", label: "Why it is rejected", reason: true, confirm: "Reject" })}>Reject</Button>}
      {can.activate && <Button size="compact" variant="primary" onPress={() => setAsk({ action: "activate", title: "Schedule or activate this revision", label: "", dates: true, confirm: "Schedule" })}>Schedule / activate</Button>}
      {can.cancelSchedule && <Button size="compact" variant="secondary" onPress={() => setAsk({ action: "cancel-schedule", title: "Cancel this schedule", label: "Why the schedule is cancelled", reason: true, confirm: "Cancel schedule" })}>Cancel schedule</Button>}
      {r && r.status !== "DRAFT" && bom.effectiveRevisionId && bom.effectiveRevisionId !== r.id && <LinkButton size="compact" variant="ghost" href={`${BOM_BASE}/${bom.id}/revisions/${r.id}/impact`}>Impact</LinkButton>}
      {can.revise && <Button size="compact" variant="secondary" onPress={() => setAsk({ action: "revise", title: "New revision", label: "What the new revision changes", reason: true, confirm: "Start revision" })}>New revision</Button>}
      {can.obsolete && <Button size="compact" variant="ghost" onPress={() => setAsk({ action: "obsolete", title: "Retire this revision", label: "Why it is retired", reason: true, confirm: "Retire" })}>Retire</Button>}
      {can.discard && <Button size="compact" variant="ghost" onPress={() => setAsk({ action: "discard", title: "Discard this draft", label: "", confirm: "Discard draft" })}>Discard draft</Button>}
      {can.duplicate && r && <Button size="compact" variant="ghost" onPress={() => setAsk({ action: "duplicate", title: "Copy as another product's BOM", label: "", product: true, confirm: "Copy" })}>Duplicate</Button>}
      {can.export && r && <Button size="compact" variant="ghost" onPress={exportCsv}>Export CSV</Button>}
      {r && <Button size="compact" variant="ghost" onPress={() => window.print()}>Print</Button>}
      {can.archive && !bom.revisions.some((row) => ["PENDING_APPROVAL", "APPROVED", "ACTIVE"].includes(row.status)) &&
        <Button size="compact" variant="ghost" onPress={() => setAsk({ action: "archive", title: "Archive this BOM", label: "Why the BOM is archived", reason: true, confirm: "Archive" })}>Archive</Button>}
    </div>
  );
  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Breadcrumb href={BOM_BASE}>Bills of Materials</Breadcrumb>,
        title: `${bom.number} · ${bom.finishedItem.name}`,
        status: bom.archivedAt ? <StatusBadge tone="neutral">Archived</StatusBadge> : r ? <StatusBadge tone={STATUS_TONE[r.status]}>{`Rev ${r.revisionNumber} · ${r.statusLabel}`}</StatusBadge> : undefined,
        fields: [
          { label: "Product", value: `${bom.finishedItem.code}` },
          { label: "Output", value: r ? `${qty(r.outputQuantity)} ${r.outputUom}` : "—" },
          { label: "Effective", value: bom.effectiveRevisionId ? `Rev ${bom.revisions.find((row) => row.id === bom.effectiveRevisionId)?.revisionNumber}` : "None" },
        ],
        primaryAction: actions,
      }}
    >
      <div className="flex flex-col gap-4">
        {bom.archivedAt && <Notice tone="neutral">Archived {formatDateTime(bom.archivedAt)}: {bom.archiveReason}</Notice>}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Revision" size="compact" selectedKey={r?.id ?? null} onSelectionChange={(value) => { setRevisionId(String(value)); setEditing(null); }}
            options={bom.revisions.map((row) => ({ value: row.id, label: `Rev ${row.revisionNumber} · ${row.scheduled ? "Scheduled" : row.statusLabel}${row.id === bom.effectiveRevisionId ? " (effective)" : ""}` }))} />
        </div>
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="BOM sections">
            <Tab id="recipe">Recipe</Tab>
            <Tab id="plan">Requirements &amp; cost</Tab>
            <Tab id="revisions">Revisions</Tab>
            <Tab id="where-used">Where used</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="recipe">
            <div className="pt-4">
              {editing ? (
                <BomEditor state={editing} onChange={setEditing} productLocked issues={issues.length ? issues : r?.validation?.issues ?? []} saving={busy}
                  onSave={async () => { if (await run(async () => saveDraft(bom.id, r!.id, { expectedVersion: r!.version, ...payloadOf(editing) }), "Draft saved.")) setEditing(null); }}
                  onSubmit={async () => {
                    const saved = await run(async () => saveDraft(bom.id, r!.id, { expectedVersion: r!.version, ...payloadOf(editing) }), "Draft saved.");
                    if (!saved) return;
                    setEditing(null);
                    await run(async () => (await revisionAction(bom.id, r!.id, "submit")).bom, "Saved and submitted for approval.");
                  }} />
              ) : r ? <RecipeView bom={bom} issues={issues} /> : <p className="text-sm text-text-muted">No revision.</p>}
            </div>
          </TabPanel>
          <TabPanel id="plan"><div className="pt-4">{r && <PlanPanel bom={bom} />}</div></TabPanel>
          <TabPanel id="revisions"><div className="pt-4"><RevisionsPanel bom={bom} onOpen={(id) => { setRevisionId(id); setTab("recipe"); }} /></div></TabPanel>
          <TabPanel id="where-used">
            <div className="flex flex-col gap-3 pt-4">
              <Panel title="Recipes that use this product" description="Other BOMs that list it as a material (a subassembly).">
                {bom.whereUsed.parents.length ? (
                  <LinesTable columns={["BOM", "Product", "Revision", "Status"]}>
                    {bom.whereUsed.parents.map((row) => (
                      <tr key={`${row.bomId}-${row.revisionNumber}`}><Cell><Link className="text-brand underline" href={`${BOM_BASE}/${row.bomId}`}>{row.bomNumber}</Link></Cell><Cell>{row.product}</Cell>
                        <Cell>Rev {row.revisionNumber}</Cell><Cell>{STATUS_LABEL[row.status]}</Cell></tr>
                    ))}
                  </LinesTable>
                ) : <p className="text-sm text-text-muted">No other recipe uses it.</p>}
              </Panel>
              <FactList items={[["Production recipes frozen from this BOM", String(bom.whereUsed.productionSnapshots)], ["Open material demand", String(bom.whereUsed.openDemands)]]} />
            </div>
          </TabPanel>
          <TabPanel id="history">
            <div className="pt-4">
              <HistoryList title={null} entries={bom.history.map((entry) => ({
                summary: `${ACTION_LABEL[entry.action] ?? entry.action}${entry.revisionNumber ? ` · rev ${entry.revisionNumber}` : entry.details?.revisionNumber ? ` · rev ${String(entry.details.revisionNumber)}` : ""}`,
                at: entry.at, actor: entry.actor, detail: entry.reason ?? undefined }))} />
            </div>
          </TabPanel>
        </Tabs>
      </div>
      {ask && r && <AskDialog ask={ask} bom={bom} busy={busy} onClose={() => setAsk(null)} onConfirm={async (values) => {
        let ok = false;
        if (ask.action === "revise") ok = await run(() => newRevision(bom.id, values.reason, r.approvedContentHash ? r.id : undefined, values.key), "New draft revision started.");
        else if (ask.action === "archive") ok = await run(() => archiveBom(bom.id, values.reason), "BOM archived.");
        else if (ask.action === "discard") {
          ok = await run(async () => { const result = await revisionAction<{ result: { bomArchived: boolean } }>(bom.id, r.id, "discard"); if (result.result.bomArchived) router.push(BOM_BASE); setRevisionId(null); }, "Draft discarded.");
        } else if (ask.action === "duplicate") {
          ok = await run(async () => { const copy = (await revisionAction(bom.id, r.id, "duplicate", { finishedItemId: values.productId })).bom; router.push(`${BOM_BASE}/${copy.id}`); }, "Copied as a new draft.");
        } else if (ask.action === "activate") {
          const future = Boolean(values.from) && new Date(values.from).getTime() > Date.now();
          ok = await act("activate", { effectiveFrom: values.from || undefined, effectiveTo: values.to || null, idempotencyKey: values.key }, future ? "Scheduled." : "Activated.");
        } else ok = await act(ask.action, { reason: values.reason }, ask.action === "reject" ? "Rejected." : ask.action === "cancel-schedule" ? "Schedule cancelled." : "Retired.");
        if (ok) setAsk(null);
      }} />}
    </RecordDetailsPage>
  );
}

function RecipeView({ bom, issues }: { bom: Bom; issues: BomIssue[] }) {
  const r = bom.revision!;
  const shown = issues.length ? issues : r.validation?.issues ?? [];
  const newer = r.lines.filter((line) => line.childNewer);
  return (
    <div className="flex flex-col gap-4">
      {r.scheduled && r.effectiveFrom && <Notice tone="info">Approved and scheduled: used for new production from {formatDateTime(r.effectiveFrom)}. Until then the current revision stays in use.</Notice>}
      {newer.length > 0 && ["APPROVED", "ACTIVE"].includes(r.status) && (
        <Notice tone="warning">{newer.map((line) => `${line.code}: this recipe pins ${line.childBom}; ${line.childNewer}.`).join(" ")} The parent keeps its pinned subassembly until a new revision of it changes that.</Notice>
      )}
      {shown.length > 0 && (
        <Notice tone={shown.some((issue) => issue.severity === "error") ? "danger" : "warning"}>
          <ul className="list-disc pl-4">{shown.map((issue, index) => <li key={index}>{issue.lineNumber ? `Line ${issue.lineNumber}: ` : ""}{issue.message.replace(/^Line \d+ \([^)]*\): /, "")}</li>)}</ul>
        </Notice>
      )}
      {r.status === "REJECTED" && r.rejectionReason && <Notice tone="danger">Rejected by {r.rejectedBy}: {r.rejectionReason}</Notice>}
      <FactList items={[
        ["Output", `${qty(r.outputQuantity)} ${r.outputUom}`], ["Expected yield", `${qty(r.expectedYieldPct)}%`], ["Batch size", r.batchSize ? qty(r.batchSize) : "—"],
        ["Effective", r.effectiveFrom ? `${formatDateTime(r.effectiveFrom)}${r.effectiveTo ? ` to ${formatDateTime(r.effectiveTo)}` : ""}` : "Not yet"],
        ["Default warehouse", r.defaultWarehouse ?? "—"], ["Change", r.changeReason ?? "—"], ["Based on", r.basedOnRevisionNumber ? `Rev ${r.basedOnRevisionNumber}` : "—"],
        ["Created", byLine(r.createdAt, r.createdBy) ?? "—"], ["Submitted", byLine(r.submittedAt, r.submittedBy) ?? "—"], ["Approved", byLine(r.approvedAt, r.approvedBy) ?? "—"],
      ]} />
      {r.description && <Panel title="Instructions"><p className="whitespace-pre-wrap text-sm">{r.description}</p></Panel>}
      <Panel title="Materials" description={`For ${qty(r.outputQuantity)} ${r.outputUom} of ${bom.finishedItem.name}.`}>
        <LinesTable columns={["#", "Material", { label: "Quantity", numeric: true }, "Unit", "Counted", { label: "Extra %", numeric: true }, "Type", "Notes"]}>
          {r.lines.map((line) => (
            <tr key={line.id ?? line.lineNumber}>
              <Cell>{line.lineNumber}</Cell>
              <Cell><span className="flex flex-col"><span>{line.name}</span><span className="text-xs text-text-muted">{line.code}{line.trackingType !== "none" ? ` · ${line.trackingType} tracked` : ""}</span></span></Cell>
              <Cell numeric>{qty(line.quantity)}</Cell>
              <Cell>{line.uom}</Cell>
              <Cell>{line.consumptionMode === "FIXED_PER_BATCH" ? "Fixed per batch" : "Per output"}</Cell>
              <Cell numeric>{Number(line.scrapAllowancePct) ? `${qty(line.scrapAllowancePct)}%` : ""}</Cell>
              <Cell>{line.kind === "subassembly" ? `Subassembly${line.childBom ? ` (${line.childBom})` : ""}${line.childNewer ? " · newer revision effective" : ""}` : "Material"}</Cell>
              <Cell>{line.notes}</Cell>
            </tr>
          ))}
        </LinesTable>
      </Panel>
      {r.contentHash && <p className="text-xs text-text-muted">Content fingerprint {r.contentHash.slice(0, 16)}…{r.status !== "DRAFT" && r.status !== "REJECTED" ? " (the approval is bound to it)" : ""}</p>}
      {r.changes.length > 0 && (
        <Panel title="Changes in this revision" description="Every draft edit, line by line, with the values before and after.">
          <LinesTable columns={["When", "Change", "Material", "Before", "After", "By"]}>
            {r.changes.map((change, index) => (
              <tr key={`${change.at}-${index}`}>
                <Cell>{formatDateTime(change.at)}</Cell><Cell>{CHANGE_LABEL[change.type]}</Cell><Cell>{change.item ?? (change.type === "HEADER_MODIFIED" ? "Header" : "—")}</Cell>
                <Cell>{describe(change.from)}</Cell><Cell>{describe(change.to)}</Cell><Cell>{change.actor ?? ""}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

const CHANGE_LABEL: Record<string, string> = { LINE_ADDED: "Added", LINE_REMOVED: "Removed", LINE_MODIFIED: "Modified", HEADER_MODIFIED: "Header changed", CHILD_PINNED: "Subassembly pinned" };
const FIELD_LABEL: Record<string, string> = { quantity: "qty", uomId: "unit", consumptionMode: "counted", scrapAllowancePct: "extra %", childBomRevisionId: "subassembly recipe", notes: "notes",
  componentItemId: "material", lineNumber: "line", outputQuantity: "output", outputUomId: "output unit", expectedYieldPct: "yield %", batchSize: "batch", description: "instructions",
  defaultWarehouseId: "warehouse" };
const HIDDEN = new Set(["componentItemId", "uomId", "childBomRevisionId", "outputUomId", "defaultWarehouseId"]);
function describe(values: Record<string, unknown> | null) {
  if (!values) return "—";
  return Object.entries(values).map(([key, value]) => `${FIELD_LABEL[key] ?? key} ${HIDDEN.has(key) ? (value ? "set" : "none") : value === null || value === "" ? "—" : String(value)}`).join(", ");
}

// Planning: a quantity, a warehouse and, per subassembly, make it or take it from stock. Shows what is needed, what is free in stock, what is
// short, the estimated material cost; hands shortages to Procurement; freezes the recipe for a production order.
function PlanPanel({ bom }: { bom: Bom }) {
  const workspace = useWorkspaceContext();
  const r = bom.revision!;
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", bom.finishedItem.id), queryFn: () => itemUnits(bom.finishedItem.id) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000 });
  const [input, setInput] = useState<PlanInput>({ plannedQuantity: r.outputQuantity, uomId: r.outputUomId, warehouseId: r.defaultWarehouseId, policy: "MANUFACTURE_REQUIRED_SUBASSEMBLIES", choices: {} });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [canMake, setCanMake] = useState<{ quantity: string; warehouse: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(newKey);
  const [reference, setReference] = useState("");
  const subassemblies = useMemo(() => (preview?.lines ?? []).filter((line) => line.kind === "subassembly"), [preview]);
  const calculate = async (next = input) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      setPreview((await revisionAction<{ preview: Preview }>(bom.id, r.id, "requirements-preview", next)).preview); setRequestKey(newKey());
      // With one warehouse chosen: the largest quantity its usable stock makes now (no order needed; nothing reserved).
      setCanMake(null);
      if (next.warehouseId) {
        const warehouse = options.data?.warehouses.find((row) => row.id === next.warehouseId)?.code ?? "";
        bomAvailability(bom.id, r.id, { plannedQuantity: next.plannedQuantity, warehouseId: next.warehouseId, policy: next.policy })
          .then((result) => setCanMake({ quantity: result.maximumFeasible, warehouse })).catch(() => setCanMake(null));
      }
    }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const handOff = async () => {
    setBusy(true); setError(null);
    try {
      const { handoff } = await revisionAction<{ handoff: { created: Array<{ number: string; code: string }>; existing: unknown[] } }>(bom.id, r.id, "shortages", { ...input, requestKey });
      setNotice(handoff.created.length ? `Handed to Procurement: ${handoff.created.map((row) => `${row.number} (${row.code})`).join(", ")}.` : "Already handed to Procurement — nothing new.");
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const freeze = async () => {
    setBusy(true); setError(null);
    try {
      const snapshot = await freezeForProduction({ revisionId: r.id, ...input, warehouseId: input.warehouseId ?? undefined, sourceType: "manufacturing_order", sourceReference: reference.trim() || undefined,
        idempotencyKey: requestKey });
      setNotice(`${snapshot.replayed ? "Already frozen" : "Recipe frozen"} for ${qty(snapshot.plannedQuantity)} ${preview?.plannedUom ?? ""}${reference ? ` (${reference})` : ""}. Later revisions will not change it.`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Plan a quantity" description="A preview only: nothing is reserved, ordered or posted.">
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Quantity to make" inputMode="decimal" value={input.plannedQuantity} onChange={(value) => setInput({ ...input, plannedQuantity: value })} className="w-32" />
          <Select label="Unit" selectedKey={input.uomId ?? null} onSelectionChange={(key) => setInput({ ...input, uomId: String(key) })}
            options={(units.data?.units ?? []).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
          <Select label="Warehouse" selectedKey={input.warehouseId ?? "all"} onSelectionChange={(key) => setInput({ ...input, warehouseId: key === "all" ? null : String(key) })}
            options={[{ value: "all", label: "All warehouses I can see" }, ...(options.data?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.code }))]} />
          <Select label="Subassemblies" selectedKey={input.policy ?? "MANUFACTURE_REQUIRED_SUBASSEMBLIES"} onSelectionChange={(key) => setInput({ ...input, policy: String(key), choices: {} })}
            options={[{ value: "MANUFACTURE_REQUIRED_SUBASSEMBLIES", label: "Make them (default)" }, { value: "USE_STOCKED_SUBASSEMBLIES", label: "Take them from stock (default)" }]} />
          <Button variant="primary" isLoading={busy} onPress={() => calculate()}>Calculate</Button>
        </div>
        {subassemblies.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs text-text-muted">For each subassembly, choose: make all, take all from stock, or take part from stock and make the rest.</p>
            {subassemblies.filter((line, index, all) => all.findIndex((other) => other.itemId === line.itemId) === index).map((line) => {
              const choice = input.choices?.[line.itemId];
              const mode = choice === "USE_STOCK" ? "USE_STOCK" : choice === "MAKE" ? "MAKE" : choice && typeof choice === "object" ? "PARTIAL" : "DEFAULT";
              return (
                <div key={line.itemId} className="flex flex-wrap items-end gap-2">
                  <span className="pb-2 text-sm">{line.code} · {line.name} — needs {qty(line.required)} {line.baseUom}</span>
                  <Select aria-label={`${line.code} choice`} size="compact" selectedKey={mode} onSelectionChange={(key) => {
                    const choices = { ...(input.choices ?? {}) };
                    if (key === "DEFAULT") delete choices[line.itemId]; else if (key === "PARTIAL") choices[line.itemId] = { useFromStock: "0" }; else choices[line.itemId] = key as "MAKE" | "USE_STOCK";
                    setInput({ ...input, choices });
                  }} options={[{ value: "DEFAULT", label: "Default" }, { value: "MAKE", label: "Make all" }, { value: "USE_STOCK", label: "Take from stock" }, { value: "PARTIAL", label: "Part from stock" }]} />
                  {mode === "PARTIAL" && <TextField aria-label="From stock" size="compact" inputMode="decimal" className="w-28"
                    value={(choice as { useFromStock: string }).useFromStock} onChange={(value) => setInput({ ...input, choices: { ...(input.choices ?? {}), [line.itemId]: { useFromStock: value } } })} />}
                </div>
              );
            })}
            <div><Button size="compact" variant="secondary" isLoading={busy} onPress={() => calculate()}>Recalculate</Button></div>
          </div>
        )}
      </Panel>
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {preview && (
        <>
          {preview.issues.length > 0 && <Notice tone="danger">{preview.issues.map((issue) => issue.message).join(" ")}</Notice>}
          <Panel title={`To make ${qty(preview.plannedQuantity)} ${preview.plannedUom} of ${preview.finishedItem.name}`} description={`Revision ${preview.revisionNumber} · produced ${qty(preview.nominalQuantity)}${preview.batches > 1 ? ` in ${preview.batches} batches` : ""}`}>
            {canMake && <Notice tone={Number(canMake.quantity) >= Number(preview.plannedQuantity) ? "success" : "warning"}>Usable stock in {canMake.warehouse} makes {qty(canMake.quantity)} {preview.plannedUom} now{Number(canMake.quantity) < Number(preview.plannedQuantity) ? ` of the ${qty(preview.plannedQuantity)} planned` : ""}.</Notice>}
            <ul className="list-disc pl-4 text-xs text-text-muted">{preview.assumptions.map((line) => <li key={line}>{line}</li>)}</ul>
            <LinesTable columns={["Material", { label: "Required", numeric: true }, "Unit", { label: "Free stock", numeric: true }, { label: "Short", numeric: true }, "Status"]}>
              {preview.availability.lines.map((line) => (
                <tr key={line.itemId}>
                  <Cell><span className="flex flex-col"><span>{line.name}</span><span className="text-xs text-text-muted">{line.code}{line.kind === "subassembly" ? " · subassembly from stock" : ""}</span></span></Cell>
                  <Cell numeric>{qty(line.required)}</Cell><Cell>{line.baseUom}</Cell><Cell numeric>{qty(line.available)}</Cell><Cell numeric>{Number(line.shortage) ? qty(line.shortage) : ""}</Cell>
                  <Cell>{line.status === "short" ? <StatusBadge tone="danger">Short</StatusBadge> : line.status === "available" ? <StatusBadge tone="success">Available</StatusBadge> : <StatusBadge tone="warning">Unknown</StatusBadge>}</Cell>
                </tr>
              ))}
            </LinesTable>
            <p className="text-xs text-text-muted">Stock checked {formatDateTime(preview.availability.checkedAt)}: on hand that can be used, less reservations; held or quarantined stock is not counted.</p>
          </Panel>
          {preview.manufactured.length > 0 && (
            <Panel title="Subassemblies to make" description="Their materials are included above; the subassemblies themselves are not taken from stock.">
              <ul className="text-sm">{preview.manufactured.map((row) => <li key={`${row.itemId}-${row.level}`}>{row.code} · {row.name}: {qty(row.quantity)} {row.baseUom} ({row.revision})</li>)}</ul>
            </Panel>
          )}
          <Panel title="Explosion" description="Every line, level by level: base quantity, then with the extra-material allowance.">
            <LinesTable columns={["Level", "Material", "Per recipe", { label: "Base", numeric: true }, { label: "Required", numeric: true }, "Unit", "Decision"]}>
              {preview.lines.map((line) => (
                <tr key={line.path}>
                  <Cell>{line.level}</Cell>
                  <Cell><span style={{ paddingLeft: `${(line.level - 1) * 16}px` }}>{line.code} · {line.name}</span></Cell>
                  <Cell>{qty(line.quantity)} {line.uom}{line.mode === "FIXED_PER_BATCH" ? " per batch" : ""}{Number(line.scrapAllowancePct) ? ` +${qty(line.scrapAllowancePct)}%` : ""}</Cell>
                  <Cell numeric>{qty(line.beforeAllowance)}</Cell><Cell numeric>{qty(line.required)}</Cell><Cell>{line.baseUom}</Cell>
                  <Cell>{line.kind === "subassembly" ? (line.decision === "USE_STOCK" ? "From stock" : line.decision === "PARTIAL" ? `${qty(line.fromStock)} from stock, make ${qty(line.toMake)}` : "Make") : ""}</Cell>
                </tr>
              ))}
            </LinesTable>
          </Panel>
          {preview.cost && (
            <Panel title={`Estimated material cost: ${inr(preview.cost.totalMaterialCost)}${preview.cost.perUnit ? ` · ${inr(preview.cost.perUnit)} per ${preview.plannedUom}` : ""}`} description={preview.cost.note}>
              {preview.cost.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
              <LinesTable columns={["Material", { label: "Quantity", numeric: true }, { label: "Unit cost", numeric: true }, { label: "Amount", numeric: true }, "Basis"]}>
                {preview.cost.lines.map((line) => (
                  <tr key={line.itemId}><Cell>{line.code} · {line.name}</Cell><Cell numeric>{qty(line.required)} {line.baseUom}</Cell><Cell numeric>{line.unitCost ? inr(line.unitCost) : "Missing"}</Cell>
                    <Cell numeric>{line.amount ? inr(line.amount) : "—"}</Cell><Cell>{line.basis ?? "No cost"}{line.stale ? " (stale)" : ""}</Cell></tr>
                ))}
              </LinesTable>
            </Panel>
          )}
          {bom.can.useForProduction && (
            <Panel title="Use for production">
              <div className="flex flex-wrap items-end gap-2">
                {preview.availability.hasShortages && <Button variant="secondary" isLoading={busy} onPress={handOff}>Hand shortages to Procurement</Button>}
                {r.status === "ACTIVE" && bom.effectiveRevisionId === r.id && (
                  <>
                    <TextField label="Production order reference (optional)" size="compact" value={reference} onChange={setReference} maxLength={200} />
                    <Button variant="primary" isLoading={busy} onPress={freeze}>Freeze recipe for production</Button>
                  </>
                )}
              </div>
              <p className="text-xs text-text-muted">Procurement receives demand, not a purchase order. A frozen recipe is what a production order keeps; later revisions never change it.</p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

// Revision history: every revision with its state, window, reason and approval; its effectivity windows (scheduled, effective, ended,
// cancelled); and links to compare two revisions and to a revision's impact.
function RevisionsPanel({ bom, onOpen }: { bom: Bom; onOpen: (id: string) => void }) {
  const latest = bom.revisions[0];
  const previous = bom.revisions.find((row) => row.id === latest?.basedOnRevisionId) ?? bom.revisions[1];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {bom.revisions.length > 1 && latest && previous && (
          <LinkButton size="compact" variant="secondary" href={`${BOM_BASE}/${bom.id}/compare?from=${previous.id}&to=${latest.id}`}>Compare revisions</LinkButton>
        )}
      </div>
      <LinesTable columns={["Revision", "Status", "Effective", "Change", "Based on", "Approved", ""]}>
        {bom.revisions.map((row) => (
          <tr key={row.id}>
            <Cell><button type="button" className="text-brand underline" onClick={() => onOpen(row.id)}>Rev {row.revisionNumber}</button>{row.id === bom.effectiveRevisionId ? " (in use)" : ""}</Cell>
            <Cell><StatusBadge tone={row.scheduled ? "info" : STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
            <Cell>{row.effectiveFrom ? `${formatDateTime(row.effectiveFrom)}${row.effectiveTo ? ` → ${formatDateTime(row.effectiveTo)}` : " onward"}` : "—"}</Cell>
            <Cell>{row.changeReason}</Cell>
            <Cell>{row.basedOnRevisionId ? `Rev ${bom.revisions.find((other) => other.id === row.basedOnRevisionId)?.revisionNumber ?? "?"}` : ""}</Cell>
            <Cell>{row.approvedBy ? `${row.approvedBy}, ${formatDateTime(row.approvedAt)}` : ""}</Cell>
            <Cell>
              <span className="flex gap-3">
                {row.id !== bom.effectiveRevisionId && bom.effectiveRevisionId && (
                  <Link className="text-brand underline" href={`${BOM_BASE}/${bom.id}/compare?from=${bom.effectiveRevisionId}&to=${row.id}`}>Compare with in use</Link>
                )}
                {row.status !== "DRAFT" && <Link className="text-brand underline" href={`${BOM_BASE}/${bom.id}/revisions/${row.id}/impact`}>Impact</Link>}
              </span>
            </Cell>
          </tr>
        ))}
      </LinesTable>
      <Panel title="Effectivity" description="When each approved revision is used for new production. Windows never overlap; a scheduled one starts on its own at its date.">
        {bom.effectivities.length ? (
          <LinesTable columns={["Revision", "Window", "From", "To", "Scheduled by", "Note"]}>
            {bom.effectivities.map((row) => (
              <tr key={row.id}>
                <Cell>Rev {row.revisionNumber}</Cell>
                <Cell><StatusBadge tone={EFFECTIVITY_TONE[row.status]}>{EFFECTIVITY_LABEL[row.status]}</StatusBadge></Cell>
                <Cell>{formatDateTime(row.effectiveFrom)}</Cell><Cell>{row.effectiveTo ? formatDateTime(row.effectiveTo) : "Until replaced"}</Cell>
                <Cell>{row.scheduledBy ? `${row.scheduledBy}, ${formatDateTime(row.scheduledAt)}` : ""}</Cell>
                <Cell>{row.status === "CANCELLED" ? `Cancelled${row.cancelledBy ? ` by ${row.cancelledBy}` : ""}: ${row.cancelReason}` : ""}</Cell>
              </tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No revision has been scheduled or activated yet.</p>}
      </Panel>
    </div>
  );
}

const EFFECTIVITY_LABEL: Record<string, string> = { SCHEDULED: "Scheduled", ACTIVE: "In use", ENDED: "Ended", CANCELLED: "Cancelled" };
const EFFECTIVITY_TONE: Record<string, "info" | "success" | "neutral" | "danger"> = { SCHEDULED: "info", ACTIVE: "success", ENDED: "neutral", CANCELLED: "neutral" };

function AskDialog({ ask, bom, busy, onClose, onConfirm }: { ask: Ask; bom: Bom; busy: boolean; onClose: () => void;
  onConfirm: (values: { reason: string; from: string; to: string; productId: string | null; key: string }) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000, enabled: Boolean(ask.product) });
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  // One request key per dialog: a retried click returns the first result instead of acting twice.
  const [key] = useState(newKey);
  const ready = (!ask.reason || reason.trim().length >= 3) && (!ask.product || productId);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={ask.title} size="md">
      <div className="flex flex-col gap-3">
        {ask.reason && <TextArea label={ask.label} value={reason} onChange={setReason} maxLength={1000} />}
        {ask.dates && (
          <>
            <p className="text-sm text-text-secondary">From when this revision is used for new production. Leave it empty to activate now; a future date schedules it and the current revision stays in use until then. Production orders already frozen keep their recipe.</p>
            <TextField label="Effective from (leave empty for now)" type="datetime-local" value={from} onChange={setFrom} />
            <TextField label="Effective to (optional)" type="datetime-local" value={to} onChange={setTo} />
          </>
        )}
        {ask.product && (
          <Select label="Product for the copy" selectedKey={productId} onSelectionChange={(key) => setProductId(String(key))}
            options={(options.data?.products ?? []).filter((item) => !item.hasBom && item.id !== bom.finishedItem.id).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} />
        )}
        {ask.action === "discard" && <p className="text-sm text-text-secondary">The draft is removed; its history stays. An approved revision is retired instead.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!ready}
            onPress={() => onConfirm({ reason: reason.trim(), from: from ? new Date(from).toISOString() : "", to: to ? new Date(to).toISOString() : "", productId, key })}>{ask.confirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}
