"use client";

// Assets — one asset's page. The header keeps its code, name, status, location and custodian in view, with only the lifecycle actions its
// state and the person's access allow (never a free status dropdown). Tabs: Overview, Acquisition, Financials (Finance's figures, when
// allowed), Assignments & Transfers, Maintenance & Warranty, Documents, Verification, Activity. The QR label prints from here; a scan opens here.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions, type MoreAction } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { getReclassifications } from "../categories/categories-api";
import { ReclassificationsPanel, ReclassifyDialog } from "../categories/CategoryScreens";
import { IdentificationPanel, LabelDialog } from "./IdentificationScreens";
import { StatusHistoryPanel, StatusPanel, statusAsk } from "./StatusScreens";
import { AssetLocationPanel } from "../locations/AssetLocationPanel";
import { AssetCustodyPanel } from "../custody/CustodyScreens";
import { AssetOpeningPanel } from "../opening/OpeningScreens";
import { AssetCapitalizationPanel } from "../capitalization/CapitalizationScreens";
import { AssetTransferPanel } from "../transfers/TransferScreens";
import { AssetMovementHistoryPanel } from "../movements/MovementScreens";
import { AssetMaintenancePanel } from "../maintenance/MaintenanceScreens";
import { AssetDisposalPanel } from "../disposals/DisposalScreens";
import { AssetDepreciationPanel } from "../depreciation/DepreciationScreens";
import { AssetAssignmentPanel } from "../assignments/AssignmentScreens";
import {
  ACTION_LABEL, AVAILABILITY_TONE, CONDITION_TONE, LIFECYCLE_TONE, REGISTER_BASE, WARRANTY_LABEL, assetAction, dateLabel, errorMessage, errorStatus, getAsset, getAssetView, getOptions, money, registerAction, updateAsset,
  type AssetDetail, type AssetStatus,
} from "./register-api";

const TABS = [{ id: "overview", label: "Overview" }, { id: "identification", label: "Identification" }, { id: "acquisition", label: "Acquisition" }, { id: "financials", label: "Financials" },
  { id: "custody", label: "Assignments & Transfers" }, { id: "movements", label: "Movement History" }, { id: "warranty", label: "Maintenance & Warranty" }, { id: "disposal", label: "Disposal" },
  { id: "documents", label: "Documents" }, { id: "activity", label: "Activity & Audit" }];
// Earlier links keep working: the verification tab is part of Identification now.
const TAB_ALIAS: Record<string, string> = { verification: "identification" };

export function AssetDetailScreen({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset", assetId), queryFn: () => getAsset(assetId), retry: false });
  const statusQuery = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "status"), queryFn: () => getAssetView<AssetStatus>(assetId, "status"), retry: false });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const asked = TAB_ALIAS[params.get("tab") ?? ""] ?? params.get("tab");
  const [tab, setTab] = useState(TABS.some((row) => row.id === asked) ? asked! : "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"edit" | "label" | "verify" | "reclassify" | null>(params.get("via") === "qr" ? "verify" : null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const refresh = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); setMessage({ tone: "success", text }); };
  if (query.isLoading) return <LoadingState label="Loading the asset" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to this asset" description="Ask an administrator for access." />;
    return <ErrorState title="Asset not found" description={errorStatus(query.error) === 404 ? "It does not exist, or it is not in your care." : errorMessage(query.error)} action={{ label: "Asset Register", onPress: () => router.push(REGISTER_BASE) }} />;
  }
  const a = query.data;
  const tabs = TABS.filter((row) => row.id !== "financials" || a.can.financials);
  const selectTab = (id: string) => { setTab(id); router.replace(`${pathname}?tab=${id}`, { scroll: false }); };
  const run = async (action: string, input: Record<string, unknown>, text: string) => {
    try { await assetAction(a.id, action, { expectedVersion: a.version, ...input }); await refresh(text); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  // Every status action opens its own dialog with the fields it needs; registering needs none.
  const act = (action: string) => (action === "register" ? void run("register", {}, `${a.code} registered.`) : setAsk(statusAsk(action, a, statusQuery.data, options.data, refresh)));
  const primaryAction = a.can.actions.find((x) => ["register", "activate", "release", "recover", "reinstate"].includes(x));
  const more: MoreAction[] = [
    ...a.can.actions.filter((x) => x !== primaryAction).map((x) => ({ id: x, label: ACTION_LABEL[x] ?? x, run: () => act(x) })),
    { id: "verify", label: "Record verification", show: a.can.verify, run: () => setDialog("verify") },
    { id: "label", label: "Print label", show: a.can.printLabel, run: () => setDialog("label") },
    { id: "reclassify", label: "Change category", show: a.can.reclassify && a.lifecycle !== "DRAFT", run: () => setDialog("reclassify") },
    { id: "archive", label: "Archive", show: a.can.archive, run: () => setAsk({ title: `Archive ${a.code}`, confirm: "Archive", description: "It leaves the everyday register; everything about it is kept.",
      fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: (v) => assetAction(a.id, "archive", { reason: v.reason }).then(() => refresh("Archived.")) }) },
  ];
  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{a.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{a.code}{a.tagCode ? ` · ${a.tagCode}` : ""}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={LIFECYCLE_TONE[a.lifecycle]}>{a.lifecycleLabel}</StatusBadge>
              <StatusBadge tone={AVAILABILITY_TONE[a.availability]}>{a.availabilityLabel}</StatusBadge>
              {a.condition && ["DAMAGED", "UNSERVICEABLE"].includes(a.condition) && <StatusBadge tone={CONDITION_TONE[a.condition]}>{a.conditionLabel}</StatusBadge>}
              {a.missingReported && <StatusBadge tone="danger">Reported missing</StatusBadge>}
              {a.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
            </span>
          ),
          fields: [
            { label: "Category", value: a.category ?? "—" }, { label: "Location", value: a.location ?? "Not set" }, { label: "Custodian", value: a.custodian ?? (a.department ? `${a.department} (department)` : "Unassigned") },
            { label: "Condition", value: a.conditionLabel ?? "—" }, { label: "Serial", value: a.serialNumber ?? "—" }, { label: "Tracking", value: a.capitalizationLabel },
          ],
          primaryAction: primaryAction ? <Button variant="primary" onPress={() => act(primaryAction)}>{ACTION_LABEL[primaryAction]}</Button> : undefined,
          secondaryActions: (
            <>
              {(a.can.editDraft || a.can.editDetails) && <Button variant="secondary" onPress={() => setDialog("edit")}>Edit</Button>}
              <MoreActions actions={more} />
            </>
          ),
        }}
        tabs={message ? <Notice tone={message.tone}>{message.text}</Notice> : undefined}
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => selectTab(String(key))}>
          <TabList aria-label="Asset sections">{tabs.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <OverviewTab asset={a} status={statusQuery.data} onAct={act} />}
          {tab === "acquisition" && <div className="flex flex-col gap-4"><AssetOpeningPanel assetId={a.id} /><AcquisitionTab asset={a} onDone={refresh} /></div>}
          {tab === "financials" && a.can.financials && <div className="flex flex-col gap-4"><AssetCapitalizationPanel assetId={a.id} /><FinancialsTab assetId={a.id} /><AssetDepreciationPanel assetId={a.id} /></div>}
          {tab === "identification" && <div className="flex flex-col gap-4"><IdentificationPanel asset={a} onDone={refresh} /><VerificationTab asset={a} onVerify={() => setDialog("verify")} /></div>}
          {tab === "custody" && <div className="flex flex-col gap-4"><AssetCustodyPanel assetId={a.id} /><AssetAssignmentPanel assetId={a.id} /><AssetTransferPanel assetId={a.id} /><AssetLocationPanel assetId={a.id} /><CustodyTab asset={a} /></div>}
          {tab === "movements" && <AssetMovementHistoryPanel assetId={a.id} />}
          {tab === "warranty" && <WarrantyTab asset={a} />}
          {tab === "disposal" && <AssetDisposalPanel assetId={a.id} assetCode={a.code} />}
          {tab === "documents" && <DocumentsTab asset={a} onDone={refresh} />}
          {tab === "activity" && <ActivityTab assetId={a.id} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "edit" && <EditDialog asset={a} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(text); }} />}
      {dialog === "label" && <LabelDialog assetId={a.id} code={a.code} onClose={() => setDialog(null)} onPrinted={() => { setDialog(null); void refresh("Label printed."); }} />}
      {dialog === "reclassify" && <ReclassifyDialog assetId={a.id} assetCode={a.code} currentCategoryId={a.categoryId} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(text); }} />}
      {dialog === "verify" && a.can.verify && <VerifyDialog asset={a} method={params.get("via") === "qr" ? "QR" : "MANUAL"} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(text); }} />}
    </>
  );
}

function OverviewTab({ asset: a, status, onAct }: { asset: AssetDetail; status: AssetStatus | undefined; onAct: (action: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {a.lifecycle === "LOST" && <Notice tone="danger">This asset is confirmed lost. Finance decides any write-off; its history is kept. Record a recovery if it is found.</Notice>}
      {status && <StatusPanel asset={a} status={status} onAct={onAct} />}
      {a.verificationDue && <Notice tone="warning">{`Not verified within the verification period${a.lastVerifiedAt ? ` (last ${formatDateTime(a.lastVerifiedAt)})` : ""}.`}</Notice>}
      {a.lifecycle === "REGISTERED" && !a.hasSource && a.capitalizationClass !== "TRACKED_ONLY" && <Notice tone="info">Link its acquisition source (Acquisition tab) before commissioning it.</Notice>}
      <FactList title="What it is" items={[["Name", a.name], ["Category", a.category ?? "—"], ["Type", a.assetTypeLabel], ["Manufacturer", a.manufacturer ?? "—"], ["Model", a.model ?? "—"],
        ["Ownership", a.ownershipLabel], ["Tracking", a.capitalizationLabel], ["Criticality", a.criticality]]} />
      <FactList title="Where it is" items={[["Location", a.location ?? "Not set"], ["Department", a.department ?? "—"], ["Custodian", a.custodian ?? "Unassigned"], ["Availability", a.availabilityLabel],
        ["Condition", a.conditionLabel ?? "—"], ["Last verified", a.lastVerifiedAt ? formatDateTime(a.lastVerifiedAt) : "Never"]]} />
      <FactList title="Dates" items={[["Purchased", dateLabel(a.purchaseDate)], ["Received", dateLabel(a.receivedDate)], ["Available for use", dateLabel(a.availableForUseDate)],
        ["Warranty", a.warrantyEndDate ? `${WARRANTY_LABEL[a.warranty]} · until ${dateLabel(a.warrantyEndDate)}` : WARRANTY_LABEL.NONE], ["Registered", formatDateTime(a.createdAt)]]} />
      <AssetReclassifications asset={a} />
      {(a.description || a.notes) && <Panel title="Notes">{a.description && <p className="whitespace-pre-wrap text-sm">{a.description}</p>}{a.notes && <p className="whitespace-pre-wrap text-sm text-text-secondary">{a.notes}</p>}</Panel>}
    </div>
  );
}

// The asset's category corrections, with Finance's decision where one was needed.
function AssetReclassifications({ asset: a }: { asset: AssetDetail }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "reclassifications", a.id), queryFn: () => getReclassifications({ assetId: a.id }), retry: false });
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  return <ReclassificationsPanel title="Category changes" rows={rows} canDecide={a.can.decideReclassification} />;
}

type Allocation = { id: string; number: string; sourceType: string; sourceLabel: string; document: string | null; href: string | null; quantity: number; status: string; reason: string | null; by: string | null;
  at: string; cost?: string | null; costBasis?: string; costStatus?: string; currency?: string; reversalReason: string | null };
function AcquisitionTab({ asset: a, onDone }: { asset: AssetDetail; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", a.id, "acquisition"), queryFn: () => getAssetView<{ methodLabel: string | null; purchaseDate: string | null; receivedDate: string | null;
    availableForUseDate: string | null; allocations: Allocation[]; note: string }>(a.id, "acquisition") });
  const [ask, setAsk] = useState<Ask | null>(null);
  if (q.isLoading) return <LoadingState label="Loading acquisition" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const live = d.allocations.find((row) => row.status === "ACTIVE");
  const link = (): Ask => ({ title: "Link the acquisition source", confirm: "Link", description: "For a purchase, use Register from purchase so each unit claims its own line. Here: an asset already owned, or an approved exception.",
    fields: [{ name: "sourceType", label: "Source", kind: "select", required: true, options: [{ value: "OPENING_BALANCE", label: "Already owned (opening register)" }, { value: "MANUAL_EXCEPTION", label: "Approved exception — no purchase document" }] },
      { name: "openingCost", label: "Original cost (opening register, for Finance to validate)", kind: "quantity" }, { name: "reason", label: "Explanation", kind: "textarea" }],
    run: (v) => assetAction(a.id, "acquisition", { sourceType: v.sourceType, openingCost: v.openingCost || undefined, reason: v.reason || undefined }).then(() => onDone("Acquisition source linked.")) });
  return (
    <div className="flex flex-col gap-4">
      <FactList title="Acquisition" items={[["How it was acquired", d.methodLabel ?? "Not recorded"], ["Supplier", a.supplier ?? "—"], ["Purchased", dateLabel(d.purchaseDate)], ["Received", dateLabel(d.receivedDate)],
        ["Available for use", dateLabel(d.availableForUseDate)]]} />
      <Panel title="Acquisition source" description={d.note} actions={!live && a.can.acquisition && a.lifecycle !== "DISPOSED" ? <Button size="compact" variant="secondary" onPress={() => setAsk(link())}>Link source</Button> : undefined}>
        <LinesTable columns={["Allocation", "Source", "Document", { label: "Units", numeric: true }, ...(a.can.financials ? [{ label: "Cost", numeric: true }, "Cost status"] : []), "Status", ""]} empty={d.allocations.length ? undefined : "No acquisition source linked."}>
          {d.allocations.map((row) => <tr key={row.id}>
            <Cell>{row.number}<span className="block text-xs text-text-muted">{`${row.by ?? ""} · ${formatDateTime(row.at)}`}</span></Cell><Cell>{row.sourceLabel}{row.reason && <span className="block text-xs text-text-muted">{row.reason}</span>}</Cell>
            <Cell>{row.href && row.document ? <Link className="text-brand hover:underline" href={row.href}>{row.document}</Link> : row.document ?? "—"}</Cell><Cell numeric>{row.quantity}</Cell>
            {a.can.financials && <><Cell numeric>{money(row.cost ?? null, row.currency)}</Cell><Cell>{row.costStatus === "FINANCE_CONFIRMED" ? "Confirmed by Finance" : row.costStatus === "PROPOSED" ? "Proposed (tax-exclusive)" : "—"}</Cell></>}
            <Cell>{row.status === "ACTIVE" ? <StatusBadge tone="success">Current</StatusBadge> : <span className="text-xs text-text-muted">{`Reversed: ${row.reversalReason ?? ""}`}</span>}</Cell>
            <Cell>{row.status === "ACTIVE" && <span className="flex gap-1">
              {a.can.confirmCost && row.costStatus === "PROPOSED" && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Confirm the acquisition cost", confirm: "Confirm", fields: [{ name: "cost", label: "Confirmed cost", kind: "quantity", initial: row.cost ?? "" }],
                run: (v) => registerAction("confirm-cost", { allocationId: row.id, cost: v.cost || undefined }).then(() => onDone("Cost confirmed.")) })}>Confirm cost</Button>}
              {a.can.acquisition && a.capitalizationClass !== "CAPITALIZED" && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reverse this source", confirm: "Reverse", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
                run: (v) => registerAction("reverse-acquisition", { allocationId: row.id, reason: v.reason }).then(() => onDone("Source reversed.")) })}>Reverse</Button>}
            </span>}</Cell>
          </tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function FinancialsTab({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "financials"), queryFn: () => getAssetView<{ capitalizationLabel: string; message: string | null; capitalizedCost: string | null;
    capitalizationDate: string | null; depreciation: { method: string; usefulLifeMonths: number; residualValue: string; startDate: string | null } | null; accumulatedDepreciation: string | null; impairment: string | null;
    carryingAmount: string | null; asOf: string | null; currency: string; formula: string }>(assetId, "financials") });
  if (q.isLoading) return <LoadingState label="Loading financials" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const f = q.data!;
  return (
    <div className="flex flex-col gap-4">
      {f.message && <Notice tone="info">{f.message}</Notice>}
      <FactList title="Finance's figures" description={f.formula} items={[["Capitalization", f.capitalizationLabel], ["Capitalized cost", f.capitalizedCost === null ? "Not capitalized" : money(f.capitalizedCost, f.currency)],
        ["Capitalized on", dateLabel(f.capitalizationDate)], ["Depreciation", f.depreciation ? `${f.depreciation.method.replace(/_/g, " ")} · ${f.depreciation.usefulLifeMonths} months` : "Not configured"],
        ["Accumulated depreciation", f.accumulatedDepreciation === null ? "Not configured" : money(f.accumulatedDepreciation, f.currency)], ["Impairment", f.impairment === null ? "—" : money(f.impairment, f.currency)],
        ["Net carrying amount", f.carryingAmount === null ? "Not capitalized" : money(f.carryingAmount, f.currency)], ["As of", dateLabel(f.asOf)]]} />
    </div>
  );
}
function CustodyTab({ asset: a }: { asset: AssetDetail }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", a.id, "custody"), queryFn: () => getAssetView<{ ownership: string; note: string }>(a.id, "custody") });
  if (q.isLoading) return <LoadingState label="Loading custody" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="neutral">{`${d.note} Owner: ${d.ownership}.`}</Notice>
      {["ACTIVE", "ON_HOLD"].includes(a.lifecycle) && <p className="text-sm"><Link className="text-brand hover:underline" href="/assets/custody">Custody & Handovers</Link>{" and "}<Link className="text-brand hover:underline" href="/assets/transfers">Transfers</Link>{" change its custody."}</p>}
    </div>
  );
}
function WarrantyTab({ asset: a }: { asset: AssetDetail }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", a.id, "warranty"), queryFn: () => getAssetView<{ provider: string | null; reference: string | null; startDate: string | null; endDate: string | null;
    state: string; supportContact: string | null; openMaintenanceOrders: number; history: Array<{ id: string; provider: string | null; startDate: string | null; endDate: string | null; reference: string | null; at: string }> }>(a.id, "warranty") });
  if (q.isLoading) return <LoadingState label="Loading warranty" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const w = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <FactList title="Warranty" items={[["Status", WARRANTY_LABEL[w.state]], ["Provider", w.provider ?? "—"], ["Reference", w.reference ?? "—"], ["From", dateLabel(w.startDate)], ["Until", dateLabel(w.endDate)], ["Support contact", w.supportContact ?? "—"]]} />
      <FactList title="Availability" items={[["Availability", a.availabilityLabel], ["Condition", a.conditionLabel ?? "—"]]} />
      <AssetMaintenancePanel assetId={a.id} />
      {w.history.length > 0 && <Panel title="Warranty history"><LinesTable columns={["Recorded", "Provider", "From", "Until", "Reference"]}>
        {w.history.map((h) => <tr key={h.id}><Cell>{formatDateTime(h.at)}</Cell><Cell>{h.provider ?? "—"}</Cell><Cell>{dateLabel(h.startDate)}</Cell><Cell>{dateLabel(h.endDate)}</Cell><Cell>{h.reference ?? "—"}</Cell></tr>)}
      </LinesTable></Panel>}
    </div>
  );
}
function DocumentsTab({ asset: a, onDone }: { asset: AssetDetail; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-files", a.id), queryFn: () => fetch(`/api/assets/register/${a.id}/files`).then((r) => r.json()) as Promise<{ files: Array<{ id: string; fileName: string; sizeBytes: number; uploadedAt: string }> }> });
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`/api/assets/register/${a.id}/files`, { method: "POST", body, credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || "The upload failed.");
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "asset-files", a.id) });
      await onDone(`${file.name} added.`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Documents" description="Photos, manuals, purchase invoices, receipts and warranty certificates. A document is archived, never deleted.">
      {error && <Notice tone="danger">{error}</Notice>}
      {a.can.documents && <input type="file" aria-label="Add a document" className="text-sm" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />}
      <LinesTable columns={["Document", "Added", { label: "Size", numeric: true }]} empty={(q.data?.files ?? []).length ? undefined : "No documents yet."}>
        {(q.data?.files ?? []).map((file) => <tr key={file.id}><Cell><a className="text-brand hover:underline" href={`/api/assets/register/${a.id}/files/${file.id}`}>{file.fileName}</a></Cell><Cell>{formatDateTime(file.uploadedAt)}</Cell>
          <Cell numeric>{`${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
function VerificationTab({ asset: a, onVerify }: { asset: AssetDetail; onVerify: () => void }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", a.id, "verification"), queryFn: () => getAssetView<{ note: string; rows: Array<{ id: string; outcome: string; outcomeLabel: string;
    observedLocation: string | null; expectedLocation: string | null; expectedCustodian: string | null; conditionLabel: string | null; note: string | null; method: string; by: string | null; at: string }> }>(a.id, "verification") });
  if (q.isLoading) return <LoadingState label="Loading verification" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  return (
    <Panel title="Physical verification" description={d.note} actions={a.can.verify ? <Button size="compact" variant="secondary" onPress={onVerify}>Record verification</Button> : undefined}>
      <LinesTable columns={["When", "Outcome", "Expected", "Observed", "Condition", "By"]} empty={d.rows.length ? undefined : "Never verified."}>
        {d.rows.map((r) => <tr key={r.id}><Cell>{formatDateTime(r.at)}<span className="block text-xs text-text-muted">{r.method === "QR" ? "QR scan" : r.method === "SEARCH" ? "Search" : "Manual"}</span></Cell>
          <Cell><StatusBadge tone={r.outcome === "FOUND" ? "success" : r.outcome === "NOT_FOUND" ? "danger" : "warning"}>{r.outcomeLabel}</StatusBadge>{r.note && <span className="block text-xs text-text-muted">{r.note}</span>}</Cell>
          <Cell>{[r.expectedLocation, r.expectedCustodian].filter(Boolean).join(" · ") || "—"}</Cell><Cell>{r.observedLocation ?? "—"}</Cell><Cell>{r.conditionLabel ?? "—"}</Cell><Cell>{r.by ?? "—"}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
function ActivityTab({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "activity"), queryFn: () => getAssetView<{ rows: Array<{ id: string; type: string; payload: Record<string, unknown> | null; by: string | null; at: string }> }>(assetId, "activity") });
  if (q.isLoading) return <LoadingState label="Loading activity" rows={5} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const describe = (type: string, p: Record<string, unknown> | null) => {
    const label = type.replace(/^asset\./, "").replace(/_/g, " ");
    const reason = p && typeof p.reason === "string" ? `: ${p.reason}` : "";
    const changed = p && Array.isArray(p.changed) ? ` (${(p.changed as string[]).join(", ").replace(/_/g, " ")})` : "";
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}${changed}${reason}`;
  };
  return (
    <div className="flex flex-col gap-4">
      <StatusHistoryPanel assetId={assetId} />
      <HistoryList title="Activity" entries={(q.data?.rows ?? []).map((r) => ({ summary: describe(r.type, r.payload), at: r.at, actor: r.by }))} />
    </div>
  );
}

// ------------------------------------------------------------------ dialogs
function EditDialog({ asset: a, onClose, onDone }: { asset: AssetDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const draft = a.lifecycle === "DRAFT";
  const [form, setForm] = useState<Record<string, string>>({ name: a.name, description: a.description ?? "", manufacturer: a.manufacturer ?? "", model: a.model ?? "", serialNumber: a.serialNumber ?? "", tagCode: a.tagCode ?? "",
    condition: a.condition ?? "", warrantyProvider: a.warrantyProvider ?? "", warrantyReference: a.warrantyReference ?? "", warrantyStartDate: a.warrantyStartDate ?? "", warrantyEndDate: a.warrantyEndDate ?? "",
    supportContact: a.supportContact ?? "", notes: a.notes ?? "", categoryId: a.categoryId, locationId: a.locationId ?? "", departmentId: a.departmentId ?? "", custodianUserId: a.custodianId ?? "", purchaseDate: a.purchaseDate ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true); setError(null);
    const fields = ["name", "description", "manufacturer", "model", ...(draft ? ["serialNumber", "tagCode"] : []), "condition", "warrantyProvider", "warrantyReference", "warrantyStartDate", "warrantyEndDate", "supportContact", "notes",
      ...(a.can.editCustody ? ["locationId", "departmentId", "custodianUserId"] : []), ...(draft ? ["categoryId", "purchaseDate"] : [])];
    const original: Record<string, string> = { name: a.name, description: a.description ?? "", manufacturer: a.manufacturer ?? "", model: a.model ?? "", serialNumber: a.serialNumber ?? "", tagCode: a.tagCode ?? "",
      condition: a.condition ?? "", warrantyProvider: a.warrantyProvider ?? "", warrantyReference: a.warrantyReference ?? "", warrantyStartDate: a.warrantyStartDate ?? "", warrantyEndDate: a.warrantyEndDate ?? "",
      supportContact: a.supportContact ?? "", notes: a.notes ?? "", categoryId: a.categoryId, locationId: a.locationId ?? "", departmentId: a.departmentId ?? "", custodianUserId: a.custodianId ?? "", purchaseDate: a.purchaseDate ?? "" };
    const input = Object.fromEntries(fields.filter((k) => form[k] !== original[k]).map((k) => [k, form[k] === "" ? null : form[k]]));
    try { await updateAsset(a.id, { ...input, expectedVersion: a.version }); await onDone("Saved."); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const o = options.data;
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Edit ${a.code}`} size="lg"
      description={draft ? "A draft can change any registration detail." : `${a.can.editCustody ? "Location and custodian can change until the asset is commissioned." : "Non-financial details. Custody changes through assignments and transfers; values through Finance."} The serial and tag are corrected from the Identification panel, with a reason.`}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" value={form.name} onChange={set("name")} isRequired />
          {draft && <Select label="Category" selectedKey={form.categoryId} onSelectionChange={(k) => set("categoryId")(String(k ?? ""))} options={(o?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />}
          <TextField label="Manufacturer" value={form.manufacturer} onChange={set("manufacturer")} />
          <TextField label="Model" value={form.model} onChange={set("model")} />
          {draft && <TextField label="Serial number" value={form.serialNumber} onChange={set("serialNumber")} />}
          {draft && <TextField label="Asset tag" value={form.tagCode} onChange={set("tagCode")} />}
          <Select label="Condition" selectedKey={form.condition || null} onSelectionChange={(k) => set("condition")(String(k ?? ""))} options={Object.entries(o?.labels.condition ?? {}).map(([value, label]) => ({ value, label }))} />
          {draft && <TextField label="Purchase date" type="date" value={form.purchaseDate} onChange={set("purchaseDate")} />}
          {a.can.editCustody && <>
            <Select label="Location" selectedKey={form.locationId || null} onSelectionChange={(k) => set("locationId")(String(k ?? ""))} options={(o?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            <Select label="Department" selectedKey={form.departmentId || null} onSelectionChange={(k) => set("departmentId")(String(k ?? ""))} options={(o?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
            <Select label="Custodian" selectedKey={form.custodianUserId || null} onSelectionChange={(k) => set("custodianUserId")(String(k ?? ""))} options={(o?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} />
          </>}
          <TextField label="Warranty provider" value={form.warrantyProvider} onChange={set("warrantyProvider")} />
          <TextField label="Warranty reference" value={form.warrantyReference} onChange={set("warrantyReference")} />
          <TextField label="Warranty from" type="date" value={form.warrantyStartDate} onChange={set("warrantyStartDate")} />
          <TextField label="Warranty until" type="date" value={form.warrantyEndDate} onChange={set("warrantyEndDate")} />
          <TextField label="Support contact" value={form.supportContact} onChange={set("supportContact")} />
        </div>
        <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={4000} />
        <TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={4000} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || form.name.trim().length < 2} onPress={save}>Save</Button></div>
      </div>
    </Dialog>
  );
}
function VerifyDialog({ asset: a, method, onClose, onDone }: { asset: AssetDetail; method: "QR" | "MANUAL"; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [outcome, setOutcome] = useState("FOUND");
  const [locationId, setLocationId] = useState("");
  const [condition, setCondition] = useState(a.condition ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await assetAction(a.id, "verify", { outcome, observedLocationId: locationId || undefined, condition: condition || undefined, note: note || undefined, method }); await onDone("Verification recorded."); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Verify ${a.code}`} description={`Expected at ${a.location ?? "no recorded location"}${a.custodian ? `, with ${a.custodian}` : ""}. Recording a discrepancy never moves the asset.`}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Select label="What did you find?" selectedKey={outcome} onSelectionChange={(k) => setOutcome(String(k))} options={[{ value: "FOUND", label: "Found as expected" }, { value: "WRONG_LOCATION", label: "Found somewhere else" },
          { value: "DAMAGED", label: "Found damaged" }, { value: "NOT_FOUND", label: "Not found" }]} />
        {outcome === "WRONG_LOCATION" && <Select label="Where it was" selectedKey={locationId || null} onSelectionChange={(k) => setLocationId(String(k ?? ""))} options={(options.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />}
        {outcome !== "NOT_FOUND" && <Select label="Condition observed" selectedKey={condition || null} onSelectionChange={(k) => setCondition(String(k ?? ""))} options={Object.entries(options.data?.labels.condition ?? {}).map(([value, label]) => ({ value, label }))} />}
        <TextArea label="Note" value={note} onChange={setNote} maxLength={1000} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || (outcome === "WRONG_LOCATION" && !locationId)} onPress={save}>Record</Button></div>
      </div>
    </Dialog>
  );
}
