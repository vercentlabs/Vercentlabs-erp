"use client";

// Assets — Asset Status on screen. The asset's four dimensions shown apart — lifecycle, availability (derived, with its reason), condition
// and Finance's classification — and only the actions its state and the person's access allow, each in its own dialog with the fields that
// action needs (never a status dropdown). The status history lists every lifecycle, availability and condition change, the holds and the
// missing reports. Bulk actions run asset by asset and report each result.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import type { Ask, Field } from "@/shared/ui/AskDialog";
import {
  ACTION_LABEL, AVAILABILITY_TONE, CONDITION_TONE, LIFECYCLE_TONE, REGISTER_BASE, assetAction, dateLabel, getAssetView, newKey, registerAction, type AssetDetail, type AssetStatus, type BulkResult,
  type Options, type StatusHistory,
} from "./register-api";

const CONDITIONS = [{ value: "NEW", label: "New" }, { value: "GOOD", label: "Good" }, { value: "FAIR", label: "Fair" }, { value: "DAMAGED", label: "Damaged" }, { value: "UNSERVICEABLE", label: "Unserviceable" }];
const ENDPOINT: Record<string, string> = { "record-condition": "condition" };
const todayIso = () => new Date().toISOString().slice(0, 10);

// The dialog for one status action: its fields, and the call it makes (once — the key stays the same for retries of this dialog).
export function statusAsk(action: string, asset: { id: string; code: string; version: number }, status: AssetStatus | undefined, options: Options | undefined, onDone: (text: string) => Promise<void>): Ask {
  const key = newKey();
  const users = (options?.users ?? []).map((u) => ({ value: u.id, label: u.name }));
  const locations = (options?.locations ?? []).map((l) => ({ value: l.id, label: l.name }));
  const holdReasons = Object.entries(options?.labels.holdReason ?? {}).map(([value, label]) => ({ value, label }));
  const run = (done: string) => async (v: Record<string, string | boolean>) => {
    const input = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined));
    await assetAction(asset.id, ENDPOINT[action] ?? action, { ...input, expectedVersion: asset.version, idempotencyKey: key });
    await onDone(done);
  };
  const reason = (label = "Reason", required = true): Field => ({ name: "reason", label, kind: "textarea", required });
  const base = { confirm: ACTION_LABEL[action] ?? action, title: `${ACTION_LABEL[action] ?? action} — ${asset.code}` };
  switch (action) {
    case "activate": return { ...base, description: "The asset goes into business use. Commissioning never capitalizes or depreciates it; Finance does that.",
      fields: [{ name: "availableForUseDate", label: "Available for use from", kind: "date", initial: todayIso() }], run: run(`${asset.code} commissioned.`) };
    case "hold": return { ...base, description: "Stops ordinary assignment and use until the hold is released. The custodian and history are kept; depreciation is Finance's decision.",
      fields: [{ name: "reasonCode", label: "Why", kind: "select", required: true, options: holdReasons }, { name: "description", label: "What needs to happen", kind: "textarea", required: true },
        { name: "resolutionOwnerId", label: "Responsible for resolving it", kind: "select", options: users, description: "Defaults to you." }], run: run(`${asset.code} placed on hold.`) };
    case "release": return { ...base, description: status?.hold ? `Returns the asset to ${status.hold.fromLabel.toLowerCase()} — where the hold began.` : undefined,
      fields: [reason("How the hold was resolved")], run: run("Hold released.") };
    case "retire": return { ...base, tone: "danger", description: "Withdraws the asset from ordinary use. It is not a disposal: Finance still decides disposal and derecognition.",
      fields: [reason("Why it is retired"), { name: "retiredOn", label: "Retired on", kind: "date", initial: todayIso() },
        ...(status && (status.availability === "ASSIGNED") ? [{ name: "custodyReviewed", label: "The custodian has returned it", kind: "checkbox" as const }] : [])],
      run: async (v) => run(`${asset.code} retired.`)({ ...v, custodyReviewed: v.custodyReviewed === true }) };
    case "report-missing": return { ...base, confirm: "Report missing", description: "Opens an investigation. It does not mark the asset lost; the asset team decides after investigating.",
      fields: [{ name: "description", label: "When and where it was last seen", kind: "textarea", required: true }, { name: "missingSince", label: "Missing since", kind: "date" }], run: run("Missing report recorded; the asset team has been told.") };
    case "close-missing": return { ...base, confirm: "Close report", description: "The asset was found before any loss was confirmed.", fields: [{ name: "note", label: "Where it was found", kind: "textarea", required: true }], run: run("Missing report closed.") };
    case "confirm-lost": return { ...base, tone: "danger", description: "Confirms the loss after the investigation. Nothing is written off: Finance decides any write-off.",
      fields: [{ name: "note", label: "Investigation summary", kind: "textarea", required: true }], run: run(`${asset.code} confirmed lost.`) };
    case "recover": return { ...base, description: "Inspect the asset, confirm it is the right one, and record where it is.",
      fields: [{ name: "recoveredOn", label: "Recovered on", kind: "date", required: true, initial: todayIso() }, { name: "condition", label: "Condition on inspection", kind: "select", required: true, options: CONDITIONS },
        { name: "locationId", label: "Where it is now", kind: "select", required: true, options: locations }, { name: "custodianUserId", label: "Custodian (optional)", kind: "select", options: users },
        { name: "identityConfirmed", label: "The asset code or serial matches", kind: "checkbox" }, { name: "note", label: "Note", kind: "textarea" },
        ...(status?.can.recoverWithFinance ? [{ name: "financeReviewed", label: "Finance has reviewed any write-off already recorded", kind: "checkbox" as const }] : [])],
      run: async (v) => run(`${asset.code} recovered.`)({ ...v, identityConfirmed: v.identityConfirmed === true, financeReviewed: v.financeReviewed === true }) };
    case "reinstate": return { ...base, description: "Returns a retired asset to service after a suitability review.",
      fields: [reason("Why it returns to service"), { name: "suitabilityConfirmed", label: "Reviewed and suitable for use", kind: "checkbox" }, { name: "locationId", label: "Where it is", kind: "select", options: locations }],
      run: async (v) => run(`${asset.code} reinstated.`)({ ...v, suitabilityConfirmed: v.suitabilityConfirmed === true }) };
    case "record-condition": return { ...base, confirm: "Record", description: "An observation with its date. Damage does not retire or dispose of the asset; an unserviceable asset cannot be issued.",
      fields: [{ name: "condition", label: "Condition observed", kind: "select", required: true, options: CONDITIONS }, { name: "observedOn", label: "Observed on", kind: "date", initial: todayIso() }, reason("What you saw", false)],
      run: run("Condition recorded.") };
    default: return { ...base, fields: [reason()], run: run("Done.") };
  }
}

// ------------------------------------------------------------------ the status, on the asset's Overview
export function StatusPanel({ asset: a, status: s, onAct }: { asset: AssetDetail; status: AssetStatus; onAct: (action: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {s.hold && <Notice tone="warning">{`On hold (${s.hold.number}) — ${s.hold.reason.toLowerCase()}: ${s.hold.description} Responsible: ${s.hold.owner ?? "—"}. Since ${formatDateTime(s.hold.since)}. Releasing returns it to ${s.hold.fromLabel.toLowerCase()}.`}</Notice>}
      {s.missing && <Notice tone="danger">{`Reported missing (${s.missing.number}) by ${s.missing.reportedBy ?? "—"} on ${formatDateTime(s.missing.reportedAt)}: ${s.missing.description} It is under investigation, not yet confirmed lost.`}</Notice>}
      {s.proposedCondition && <Notice tone="warning">{`${s.proposedCondition.by ?? "Someone"} reported it as ${s.proposedCondition.label.toLowerCase()}${s.proposedCondition.reason ? `: ${s.proposedCondition.reason}` : ""}.`}
        {s.actions.includes("record-condition") && <> <button type="button" className="font-medium underline" onClick={() => onAct("record-condition")}>Record the condition</button></>}</Notice>}
      {!s.hold && !s.missing && s.availabilityReason && <Notice tone={s.availability === "UNDER_MAINTENANCE" ? "warning" : "neutral"}>{s.availabilityReason}</Notice>}
      <FactList title="Status" items={[
        ["Lifecycle", <StatusBadge key="l" tone={LIFECYCLE_TONE[s.lifecycle]}>{s.lifecycleLabel}</StatusBadge>], ["Availability", <StatusBadge key="a" tone={AVAILABILITY_TONE[s.availability]}>{s.availabilityLabel}</StatusBadge>],
        ["Condition", <span key="c"><StatusBadge tone={CONDITION_TONE[s.condition]}>{s.conditionLabel}</StatusBadge>{s.conditionObservedAt ? <span className="ml-1 text-xs text-text-muted">{`observed ${formatDateTime(s.conditionObservedAt)}`}</span> : null}</span>],
        ["Finance classification", s.finance.label + (s.finance.fullyDepreciated ? " · fully depreciated" : "")], ["Commissioned", s.commissionedAt ? `${dateLabel(s.availableForUseDate)} (available for use)` : "—"],
        ["Last status change", s.statusChangedAt ? formatDateTime(s.statusChangedAt) : "—"], ...(s.retiredAt ? [["Retired", formatDateTime(s.retiredAt)] as [string, string]] : []),
        ...(s.openWork.maintenance ? [["Maintenance", s.openWork.maintenance] as [string, string]] : []), ...(s.openWork.transfer ? [["Transfer in progress", s.openWork.transfer] as [string, string]] : []),
      ]} description={s.finance.note ?? undefined} />
      {a.lifecycle === "RETIRED" && <p className="text-sm">Disposal goes through <Link className="text-brand hover:underline" href="/assets/disposals">the Disposal workflow</Link>; a status change never disposes of an asset.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ status history
export function StatusHistoryPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "status-history"), queryFn: () => getAssetView<StatusHistory>(assetId, "status-history"), retry: false });
  if (q.isLoading) return <LoadingState label="Loading status history" rows={3} />;
  if (q.isError || !q.data) return null;
  const h = q.data;
  return (
    <div className="flex flex-col gap-4">
      <HistoryList title="Status history" empty="No status change yet." entries={h.lifecycle.map((e) => ({
        summary: `${e.actionLabel}: ${e.fromLabel ?? "—"} → ${e.toLabel}`, at: e.at, actor: e.by, detail: e.reason || e.effectiveDate ? <span className="text-xs text-text-muted">{[e.reason, e.effectiveDate ? `effective ${dateLabel(e.effectiveDate)}` : null].filter(Boolean).join(" · ")}</span> : undefined,
      }))} />
      {h.conditions.length > 0 && <Panel title="Condition observations">
        <LinesTable columns={["Observed", "Condition", "Source", "State", "Note", "By"]}>
          {h.conditions.map((e) => <tr key={e.id}><Cell>{dateLabel(e.observedOn)}</Cell><Cell>{`${e.from} → ${e.to}`}</Cell><Cell>{e.source.toLowerCase()}</Cell>
            <Cell>{e.status === "APPLIED" ? <StatusBadge tone="success">Recorded</StatusBadge> : <StatusBadge tone="warning">Reported</StatusBadge>}</Cell><Cell>{e.reason ?? "—"}</Cell><Cell>{e.by ?? "—"}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {(h.holds.length > 0 || h.incidents.length > 0) && <Panel title="Holds and missing reports">
        <LinesTable columns={["Record", "Details", "State", "Resolution"]}>
          {h.holds.map((x) => <tr key={x.id}><Cell>{x.number}<span className="block text-xs text-text-muted">{formatDateTime(x.since)}</span></Cell><Cell>{`${x.reason}: ${x.description}`}</Cell>
            <Cell>{x.status === "ACTIVE" ? <StatusBadge tone="warning">Active</StatusBadge> : <StatusBadge tone="neutral">{x.status === "RELEASED" ? "Released" : "Closed"}</StatusBadge>}</Cell>
            <Cell>{x.releaseReason ? `${x.releasedBy ?? ""}: ${x.releaseReason}` : `Owner: ${x.owner ?? "—"}`}</Cell></tr>)}
          {h.incidents.map((x) => <tr key={x.id}><Cell>{x.number}<span className="block text-xs text-text-muted">{formatDateTime(x.reportedAt)}</span></Cell><Cell>{x.description}</Cell>
            <Cell><StatusBadge tone={x.status === "OPEN" ? "warning" : x.status === "CONFIRMED_LOST" ? "danger" : "success"}>{x.statusLabel}</StatusBadge></Cell><Cell>{x.note ?? `Reported by ${x.reportedBy ?? "—"}`}</Cell></tr>)}
        </LinesTable>
      </Panel>}
      {h.availability.length > 0 && <HistoryList title="Availability changes" entries={h.availability.map((e) => ({ summary: `${e.from} → ${e.to} (${e.action.toLowerCase()})`, at: e.at, actor: e.by }))} />}
    </div>
  );
}

// ------------------------------------------------------------------ bulk
const BULK = [{ id: "commission", label: "Commission" }, { id: "hold", label: "Place on hold" }, { id: "release", label: "Release hold" }, { id: "retire", label: "Retire" }];
export function BulkStatusActions({ count, onPick }: { count: number; onPick: (action: string) => void }) {
  return <span className="flex flex-wrap gap-2">{BULK.map((b) => <Button key={b.id} size="compact" variant="secondary" isDisabled={!count} onPress={() => onPick(b.id)}>{b.label}</Button>)}</span>;
}
export function bulkAsk(action: string, assetIds: string[], options: Options | undefined, onResult: (result: BulkResult) => void): Ask {
  const key = newKey();
  const holdReasons = Object.entries(options?.labels.holdReason ?? {}).map(([value, label]) => ({ value, label }));
  const label = BULK.find((b) => b.id === action)?.label ?? action;
  const fields: Field[] = action === "hold" ? [{ name: "reasonCode", label: "Why", kind: "select", required: true, options: holdReasons }, { name: "description", label: "What needs to happen", kind: "textarea", required: true }]
    : action === "release" ? [{ name: "reason", label: "How the hold was resolved", kind: "textarea", required: true }]
    : action === "retire" ? [{ name: "reason", label: "Why they are retired", kind: "textarea", required: true }, { name: "custodyReviewed", label: "Assigned assets have been returned", kind: "checkbox" }]
    : [{ name: "availableForUseDate", label: "Available for use from", kind: "date", initial: todayIso() }];
  return { title: `${label} — ${assetIds.length} asset(s)`, confirm: label, tone: action === "retire" ? "danger" : "primary", description: "Each asset is checked on its own; one that cannot change is listed with the reason and the others still proceed.",
    fields, run: async (v) => {
      const input = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ""));
      onResult(await registerAction<BulkResult>("bulk-status", { ...input, ...(action === "retire" ? { custodyReviewed: v.custodyReviewed === true } : {}), action, assetIds, idempotencyKey: key }));
    } };
}
export function BulkResultDialog({ result, onClose }: { result: BulkResult; onClose: () => void }) {
  const failed = result.results.filter((r) => !r.ok);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`${result.succeeded} changed, ${result.failed} not changed`}>
      <div className="flex flex-col gap-3">
        {failed.length === 0 ? <Notice tone="success">Every selected asset was changed.</Notice> : (
          <LinesTable columns={["Asset", "Why not"]}>
            {failed.map((r) => <tr key={r.assetId}><Cell><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${r.assetId}`}>{r.assetNumber ?? r.assetId}</Link></Cell><Cell>{r.message ?? r.errorCode}</Cell></tr>)}
          </LinesTable>
        )}
        <div className="flex justify-end"><Button variant="primary" onPress={onClose}>Done</Button></div>
      </div>
    </Dialog>
  );
}
