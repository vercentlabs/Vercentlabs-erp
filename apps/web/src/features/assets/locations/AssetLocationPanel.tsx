"use client";

// Assets — one asset's location: its registered location (the last confirmed official one), its custodian and department shown apart,
// a pending transfer destination, its current whereabouts and last verification sighting, any open discrepancy, and its location history.
// Recording whereabouts never moves the asset; a correction needs the review permission and a reason; moving it is an Asset Transfer.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList, HistoryList } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { assetAction, dateLabel, errorMessage, getAssetView, newKey } from "../register/register-api";
import { LOCATIONS_BASE, getChoices, resolveDiscrepancy, type AssetLocationView } from "./locations-api";

export function AssetLocationPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "asset-view", assetId, "location"), queryFn: () => getAssetView<AssetLocationView>(assetId, "location"), retry: false });
  const choices = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-choices"), queryFn: getChoices, staleTime: 30_000 });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (q.isLoading) return <LoadingState label="Loading location" rows={3} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  const places = (choices.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const done = async (text: string) => { setMessage({ tone: "success", text }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); };
  const observe = (): Ask => {
    const key = newKey();
    return { title: "Record whereabouts", confirm: "Record", description: "Where the asset is for now — a customer visit, an external repair. Its registered location stays as it is.",
      fields: [{ name: "kind", label: "What is this?", kind: "select", required: true, options: [{ value: "TEMPORARY", label: "Temporary whereabouts" }, { value: "MAINTENANCE", label: "At maintenance / repair" }] },
        { name: "locationId", label: "Where (a known location)", kind: "select", options: places }, { name: "locationText", label: "…or describe the place", kind: "text" },
        { name: "expiresAt", label: "Until (expected return)", kind: "date" }, { name: "reason", label: "Business reason", kind: "textarea", required: true },
        { name: "flagDiscrepancy", label: "This is unexpected — flag it for review", kind: "checkbox" }],
      run: async (v) => { await assetAction(assetId, "location-observation", { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "")), flagDiscrepancy: v.flagDiscrepancy === true, idempotencyKey: key }); await done("Whereabouts recorded; the registered location is unchanged."); } };
  };
  const correct = (): Ask => ({ title: "Correct the registered location", confirm: "Correct", tone: "danger", description: "For a record that is wrong (for example from an import), not for a move. A move is an Asset Transfer.",
    fields: [{ name: "locationId", label: "The correct location", kind: "select", required: true, options: places }, { name: "reason", label: "Why the record is wrong", kind: "textarea", required: true }],
    run: async (v) => { await assetAction(assetId, "location-correction", { locationId: v.locationId, reason: v.reason, expectedVersion: d.version }); await done("Location corrected."); } });
  const resolve = (): Ask => ({ title: `Resolve ${d.discrepancy?.number}`, confirm: "Resolve", description: `Registered at ${d.discrepancy?.expected ?? "—"}, seen at ${d.discrepancy?.observed ?? "—"}.`,
    fields: [{ name: "resolution", label: "Resolution", kind: "select", required: true, options: [{ value: "TRANSFER", label: "It has moved — request a transfer" }, { value: "CORRECTION", label: "The record was wrong — correct it" }, { value: "DISMISS", label: "It is where it is registered" }] },
      { name: "toLocationId", label: "Correct location (if not the one seen)", kind: "select", options: places }, { name: "note", label: "Explanation", kind: "textarea", required: true }],
    run: async (v) => { await resolveDiscrepancy({ discrepancyId: d.discrepancy?.id, resolution: v.resolution, note: v.note, toLocationId: v.toLocationId || undefined }); await done("Discrepancy resolved."); } });
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {d.discrepancy && <Notice tone="warning">{`${d.discrepancy.number}: seen at ${d.discrepancy.observed ?? "—"} (${d.discrepancy.source === "VERIFICATION" ? "verification" : "reported"}, ${formatDateTime(d.discrepancy.reportedAt)}) but registered at ${d.discrepancy.expected ?? "no location"}.`}
        {d.can.review && <> <button type="button" className="font-medium underline" onClick={() => setAsk(resolve())}>Resolve</button></>}</Notice>}
      <Panel title="Location" description={d.note} actions={<span className="flex flex-wrap gap-1">
        {d.can.observe && <Button size="compact" variant="secondary" onPress={() => setAsk(observe())}>Record whereabouts</Button>}
        {d.can.observe && d.currentWhereabouts && <Button size="compact" variant="ghost" onPress={async () => { try { await assetAction(assetId, "location-observation-end", {}); await done("Back at its registered location."); } catch (f) { setMessage({ tone: "danger", text: errorMessage(f) }); } }}>Back at its location</Button>}
        {d.can.correct && <Button size="compact" variant="ghost" onPress={() => setAsk(correct())}>Correct location</Button>}
        {d.can.transfer && <Link className="self-center text-sm text-brand hover:underline" href="/assets/transfers">Transfer</Link>}
      </span>}>
        <FactList items={[["Registered location", d.registeredLocation ?? "Not set"], ["Custodian", d.custodian ?? "—"], ["Department", d.department ?? "—"],
          ["Pending destination", d.pendingDestination ? `${d.pendingDestination.to ?? "—"} (${d.pendingDestination.transfer}, ${d.pendingDestination.status})` : "None"],
          ["Current whereabouts", d.currentWhereabouts ? `${d.currentWhereabouts.location ?? "—"} — ${d.currentWhereabouts.kindLabel.toLowerCase()}${d.currentWhereabouts.until ? ` until ${dateLabel(d.currentWhereabouts.until)}` : ""}` : "At its registered location"],
          ["Last seen in verification", d.lastSighting ? `${d.lastSighting.location ?? "—"} · ${formatDateTime(d.lastSighting.at)}` : "—"], ["Last verified", d.lastVerifiedAt ? formatDateTime(d.lastVerifiedAt) : "Never"]]} />
      </Panel>
      {d.history.length > 0 && <HistoryList title="Location history" entries={d.history.map((e) => ({ summary: `${e.eventLabel}: ${e.from ?? "—"} → ${e.to ?? "—"}`, at: e.at, actor: e.by, detail: e.reason ? <span className="text-xs text-text-muted">{e.reason}</span> : undefined }))} />}
      {d.observations.length > 0 && <HistoryList title="Whereabouts and sightings" entries={d.observations.map((o) => ({ summary: `${o.kindLabel}: ${o.location ?? "—"}${o.differs ? " (differs)" : ""}${o.ended ? " — ended" : ""}`, at: o.at, actor: o.by,
        detail: o.reason ? <span className="text-xs text-text-muted">{o.reason}</span> : undefined }))} />}
      <p className="text-xs text-text-muted">Locations are managed under <Link className="text-brand hover:underline" href={LOCATIONS_BASE}>Asset Locations</Link>.</p>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
