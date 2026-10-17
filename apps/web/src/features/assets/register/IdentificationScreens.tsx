"use client";

// Assets — Asset Identification on screen. The asset's Identification panel shows what identifies it — the permanent asset code, the
// manufacturer's serial, the Company tag, a previous code — with its QR and barcode, and lets someone allowed correct the serial, replace the
// tag or record a previous code, always with a reason (the old value stays in the history). A repeated serial is shown with the assets that
// carry it; someone allowed to resolve duplicates can accept it as genuine. Labels print one at a time here, or many at once on Print Asset
// Labels; printing is recorded so the register knows which assets are labelled.
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  REGISTER_BASE, assetAction, errorDetails, errorMessage, errorStatus, getAssetView, getLabels, getOptions, markLabelsPrinted, printLabelSheet, type AssetDetail, type Candidate, type Identification,
  type IdentifierChange, type Label,
} from "./register-api";

const POLICY: Record<string, string> = { REQUIRED: "required", OPTIONAL: "optional", NOT_APPLICABLE: "not applicable" };

// ------------------------------------------------------------------ the asset's identification
export function IdentificationPanel({ asset: a, onDone }: { asset: AssetDetail; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", a.id, "identification"), queryFn: () => getAssetView<Identification>(a.id, "identification") });
  const [dialog, setDialog] = useState<"serial" | "tag" | "legacy" | "label" | null>(null);
  if (q.isLoading) return <LoadingState label="Loading identification" rows={3} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  const done = async (text: string) => { setDialog(null); await onDone(text); };
  return (
    <div className="flex flex-col gap-4">
      {d.serialMissing && <Notice tone="warning">{`${d.category ?? "This category"} requires a serial number and none is recorded.`}</Notice>}
      {d.tagMissing && <Notice tone="warning">{`${d.category ?? "This category"} requires an asset tag and none is recorded.`}</Notice>}
      <Panel title="Identification" description={d.note}
        actions={<span className="flex flex-wrap gap-1">
          {d.can.editSerial && <Button size="compact" variant="secondary" onPress={() => setDialog("serial")}>Correct serial</Button>}
          {d.can.editTag && <Button size="compact" variant="secondary" onPress={() => setDialog("tag")}>{d.tagCode ? "Replace tag" : "Add tag"}</Button>}
          {d.can.legacy && <Button size="compact" variant="ghost" onPress={() => setDialog("legacy")}>Previous code</Button>}
          {d.can.print && <Button size="compact" variant="ghost" onPress={() => setDialog("label")}>Print label</Button>}
        </span>}>
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 grow">
            <FactList columns={2} items={[["Asset code", <span key="c" className="font-medium">{d.code}</span>], ["Serial number", d.serialNumber ?? `None (${POLICY[d.serialPolicy] ?? "optional"} for this category)`],
              ["Asset tag", d.tagCode ?? `None (${POLICY[d.tagPolicy] ?? "optional"})`], ["Previous code", d.legacyCode ?? "—"], ["Manufacturer · model", [d.manufacturer, d.model].filter(Boolean).join(" · ") || "—"],
              ["Label", d.labelPrintedAt ? `Printed ${formatDateTime(d.labelPrintedAt)}${d.labelPrintCount > 1 ? ` (${d.labelPrintCount} times)` : ""}` : "Never printed"]]} />
            {d.duplicateAccepted && <p className="mt-2 text-xs text-text-muted">{`Shared serial accepted: ${d.duplicateAccepted.reason}`}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 rounded border border-border p-3">
            <div aria-label="QR code" dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
            <div className="max-w-full overflow-hidden" aria-label="Barcode" dangerouslySetInnerHTML={{ __html: d.barcodeSvg }} />
          </div>
        </div>
      </Panel>
      {d.aliases.length > 0 && (
        <Panel title="Earlier identifiers" description="Values this asset carried before. A retired value never identifies it on its own.">
          <LinesTable columns={["Identifier", "Value", "From", "Until", "State"]}>
            {d.aliases.map((x, i) => <tr key={i}><Cell>{x.typeLabel}</Cell><Cell>{x.value}</Cell><Cell>{formatDateTime(x.from)}</Cell><Cell>{x.to ? formatDateTime(x.to) : "—"}</Cell>
              <Cell>{x.active ? (x.ambiguous ? <StatusBadge tone="warning">Also matches another asset</StatusBadge> : <StatusBadge tone="success">Finds this asset</StatusBadge>) : <StatusBadge tone="neutral">Retired</StatusBadge>}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
      {d.can.history && <IdentifierHistory assetId={a.id} />}
      {(dialog === "serial" || dialog === "tag" || dialog === "legacy") && <IdentifierDialog kind={dialog} identification={d} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "label" && <LabelDialog assetId={a.id} code={a.code} onClose={() => setDialog(null)} onPrinted={() => done("Label printed.")} />}
    </div>
  );
}
function IdentifierHistory({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "identifier-history"), queryFn: () => getAssetView<{ rows: IdentifierChange[] }>(assetId, "identifier-history") });
  if (q.isLoading) return null;
  return <HistoryList title="Identifier history" empty="No identifier has changed." entries={(q.data?.rows ?? []).map((h) => ({
    summary: `${h.typeLabel} ${h.kindLabel.toLowerCase()}: ${h.from ?? "none"} → ${h.to ?? "none"}`, at: h.at, actor: h.by, detail: h.reason ? <span className="text-xs text-text-muted">{h.reason}</span> : undefined,
  }))} />;
}

const KIND = {
  serial: { title: "Correct the serial number", field: "serialNumber", label: "Serial number", action: "serial", done: "Serial number corrected.", help: "Type it exactly as on the manufacturer's plate. Leave it blank to remove a wrong serial." },
  tag: { title: "Replace the asset tag", field: "tagCode", label: "Asset tag", action: "tag", done: "Asset tag updated.", help: "The old tag is released and kept in the history; it can no longer find this asset." },
  legacy: { title: "Record the previous asset code", field: "legacyCode", label: "Previous asset code", action: "legacy-code", done: "Previous code recorded.", help: "The code from your earlier register. It still finds this asset; the system asset code never changes." },
} as const;
function IdentifierDialog({ kind, identification: d, onClose, onDone }: { kind: keyof typeof KIND; identification: Identification; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const k = KIND[kind];
  const initial = kind === "serial" ? d.serialNumber : kind === "tag" ? d.tagCode : d.legacyCode;
  const [value, setValue] = useState(initial ?? "");
  const [reason, setReason] = useState("");
  const [duplicate, setDuplicate] = useState<{ matches: Candidate[]; canAccept: boolean } | null>(null);
  const [accept, setAccept] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await assetAction(d.assetId, k.action, { [k.field]: value, reason, expectedVersion: d.version, ...(duplicate && accept ? { duplicateException: { reason: accept } } : {}) }) as { warnings?: Array<{ message: string }> };
      await onDone(result.warnings?.length ? `${k.done} Note: ${result.warnings.map((w) => w.message).join(" ")}` : k.done);
    } catch (failure) {
      const details = errorDetails(failure) as { code?: string; matches?: Candidate[]; canAccept?: boolean };
      if (details.code === "ASSET_SERIAL_DUPLICATE") setDuplicate({ matches: (details.matches ?? []) as Candidate[], canAccept: Boolean(details.canAccept) });
      setError(errorMessage(failure)); setBusy(false);
    }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`${k.title} — ${d.code}`} description={k.help}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label={k.label} value={value} onChange={(v) => { setValue(v); setDuplicate(null); }} />
        {duplicate && (
          <Panel title="Assets with this serial">
            <ul className="text-sm">{duplicate.matches.map((m) => <li key={m.assetId}><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${m.assetId}`}>{m.code}</Link>{` · ${m.name}`}</li>)}</ul>
            {duplicate.canAccept ? <TextArea label="Accept as a genuine shared serial — why?" value={accept} onChange={setAccept} maxLength={1000} />
              : <p className="text-sm text-text-muted">If it is genuinely shared, ask someone allowed to resolve duplicates.</p>}
          </Panel>
        )}
        <TextArea label="Reason for the change" value={reason} onChange={setReason} isRequired maxLength={1000} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || reason.trim().length < 3 || (kind === "legacy" && !value.trim()) || Boolean(duplicate && (!duplicate.canAccept || accept.trim().length < 3))} onPress={save}>
            {duplicate?.canAccept ? "Accept and save" : "Save"}</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ one label
export function LabelDialog({ assetId, code, onClose, onPrinted }: { assetId: string; code: string; onClose: () => void; onPrinted: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-label", assetId), queryFn: () => getAssetView<Label & { svg: string }>(assetId, "label") });
  const [error, setError] = useState<string | null>(null);
  const print = async () => {
    if (!q.data) return;
    if (!printLabelSheet([q.data], q.data.code)) { setError("Allow pop-ups to print the label."); return; }
    try { await markLabelsPrinted([assetId]); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); onPrinted(); } catch (failure) { setError(errorMessage(failure)); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Label for ${code}`} description="The QR code holds a lookup token only and the barcode the asset code: scanning opens the asset for someone allowed to see it. Reprint a damaged label any time.">
      <div className="flex flex-col items-center gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {q.isLoading ? <LoadingState label="Preparing the label" rows={2} /> : q.data && (
          <div className="flex flex-col items-center gap-2 rounded border border-border p-3 text-center">
            <div dangerouslySetInnerHTML={{ __html: q.data.qrSvg }} />
            <p className="text-sm font-medium">{q.data.code}<span className="block text-xs text-text-muted">{q.data.name}{q.data.tagCode ? ` · Tag ${q.data.tagCode}` : ""}</span></p>
            <div className="max-w-full overflow-hidden" dangerouslySetInnerHTML={{ __html: q.data.barcodeSvg }} />
          </div>
        )}
        <div className="flex gap-2"><Button variant="ghost" onPress={onClose}>Close</Button><Button variant="primary" isDisabled={!q.data} onPress={print}>{q.data?.labelPrintedAt ? "Reprint label" : "Print label"}</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ several matches for a scan or search
export function CandidateList({ matches, onPick }: { matches: Candidate[]; onPick?: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">Several assets match. Choose one:</p>
      <LinesTable columns={["Asset", "Serial", "Location", "Status", "Matched on"]}>
        {matches.map((m) => <tr key={m.assetId}><Cell><Link className="text-brand hover:underline" href={m.href} onClick={onPick}>{m.code}</Link><span className="block text-xs text-text-muted">{m.name}</span></Cell>
          <Cell>{m.serialNumber ?? "—"}</Cell><Cell>{m.location ?? "—"}</Cell><Cell>{m.lifecycleLabel}</Cell><Cell>{m.matchedOnLabel}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}

// ------------------------------------------------------------------ print labels in bulk
export function PrintLabelsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const fromIds = params.get("assetIds") ?? undefined;
  const [filters, setFilters] = useState<{ categoryId?: string; locationId?: string; unlabelled: boolean }>({ unlabelled: !fromIds });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const query = fromIds ? { assetIds: fromIds } : { categoryId: filters.categoryId, locationId: filters.locationId, unlabelled: filters.unlabelled ? "true" : undefined };
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "labels", JSON.stringify(query)), queryFn: () => getLabels(query), retry: false });
  const [skip, setSkip] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't print asset labels" description="Printing labels needs the label permission; many at once needs bulk printing." />;
  const rows = q.data?.rows ?? [];
  const chosen = rows.filter((r) => !skip.includes(r.assetId));
  const print = async () => {
    if (!printLabelSheet(chosen, `${chosen.length} asset labels`)) { setMessage({ tone: "danger", text: "Allow pop-ups to print the labels." }); return; }
    try {
      const done = await markLabelsPrinted(chosen.map((r) => r.assetId));
      setMessage({ tone: "success", text: `${done.printed} label(s) sent to the printer and recorded.` });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Print asset labels" description="One label per asset: its QR code, a barcode of the asset code, the code, name and tag. Labels hold no private information; a scan only opens an asset for someone allowed to see it." />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {fromIds ? <Notice tone="info">{`The ${fromIds.split(",").length} asset(s) you just registered.`} <Link className="text-brand underline" href={`${REGISTER_BASE}/labels`}>Choose other assets</Link></Notice> : (
        <Panel title="Which assets?">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Category" placeholder="Any category" selectedKey={filters.categoryId ?? null} onSelectionChange={(k) => setFilters({ ...filters, categoryId: k ? String(k) : undefined })} options={(options.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            <Select label="Location" placeholder="Any location" selectedKey={filters.locationId ?? null} onSelectionChange={(k) => setFilters({ ...filters, locationId: k ? String(k) : undefined })} options={(options.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            <Checkbox isSelected={filters.unlabelled} onChange={(v) => setFilters({ ...filters, unlabelled: v })}>Only assets never labelled</Checkbox>
          </div>
        </Panel>
      )}
      {q.isLoading ? <LoadingState label="Preparing labels" rows={4} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : (
        <Panel title={`${chosen.length} of ${rows.length} label(s) selected`} description={q.data?.more ? "Only the first 200 are shown; print these, then the rest." : undefined}
          actions={<Button variant="primary" isDisabled={!chosen.length} onPress={print}>{`Print ${chosen.length} label(s)`}</Button>}>
          <LinesTable columns={["", "Asset", "Tag", "Serial", "Last printed"]} empty={rows.length ? undefined : "No registered asset matches. Drafts and disposed assets get no labels."}>
            {rows.map((r) => <tr key={r.assetId}><Cell><Checkbox aria-label={`Include ${r.code}`} isSelected={!skip.includes(r.assetId)} onChange={(on) => setSkip((list) => (on ? list.filter((x) => x !== r.assetId) : [...list, r.assetId]))} /></Cell>
              <Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${r.assetId}`}>{r.code}</Link><span className="block text-xs text-text-muted">{r.name}</span></Cell><Cell>{r.tagCode ?? "—"}</Cell><Cell>{r.serialNumber ?? "—"}</Cell>
              <Cell>{r.labelPrintedAt ? formatDateTime(r.labelPrintedAt) : "Never"}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}
