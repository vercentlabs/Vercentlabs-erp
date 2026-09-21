"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { act, AssetsApiError, readView, useAssetsOptions, type Row } from "@/features/assets/shared/client";
import { AssetsAlert, AssetsPanel, useCan } from "@/features/assets/shared/AssetsUi";
import { StatusBadge } from "@vercentlabs/design-system";
import { label, tone } from "@/features/assets/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const errorText = (e: unknown) => (e instanceof AssetsApiError ? e.message : "This could not be completed.");
type Detail = { campaign: Row; lines: Row[]; summary: Record<string, number> };

// The field surface for a physical verification campaign: create and start one, scan tags (a camera or
// keyboard-wedge scanner types into the tag box), and work through discrepancies. Every scan is classified
// on the server, so a stale or offline device can never bypass state.
export function VerificationScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const options = useAssetsOptions();
  const can = useCan();
  const [campaignId, setCampaignId] = useState("");
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [tag, setTag] = useState("");
  const [foundLocationId, setFoundLocationId] = useState("");
  const [condition, setCondition] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
  const fail = (e: unknown) => { setError(errorText(e)); setMessage(null); };
  const done = (m: string) => { setMessage(m); setError(null); void refresh(); };

  const campaigns = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "campaigns"), queryFn: async () => (await readView("campaigns")).rows as Row[] });
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "campaign", campaignId), enabled: Boolean(campaignId), queryFn: async () => (await readView<{ campaign: Detail }>("campaign", { id: campaignId })).campaign });

  const create = useMutation({ mutationFn: () => act<{ record: Row }>("campaign-create", { name, locationId: locationId || undefined }), onSuccess: (r) => { setCampaignId(r.record.id); setName(""); done("Campaign created. Start it to snapshot the expected assets."); }, onError: fail });
  const step = useMutation({ mutationFn: ({ action, input }: { action: string; input?: Record<string, unknown> }) => act(action, { id: campaignId, ...input }), onSuccess: () => done("Done."), onError: fail });
  const scan = useMutation({
    mutationFn: () => act<{ record: Row }>("campaign-scan", { campaignId, tag, foundLocationId: foundLocationId || undefined, condition: condition || undefined }),
    onSuccess: (r) => { setTag(""); done(`${r.record.matched_asset ? `${r.record.matched_asset.asset_number}: ` : "Unknown tag: "}${label(r.record.result)}`); },
    onError: fail,
  });
  const resolve = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => act("campaign-resolve", { id, action, note }), onSuccess: () => { setNote(""); done("Resolved."); }, onError: fail });

  const d = detail.data;
  const status = String(d?.campaign.status ?? "");
  const locs = (options.data?.locations ?? []).map((o) => ({ value: o.id, label: o.name }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Physical verification" description="Reconcile what is in the field to the register. Scan each tag; the server classifies it as matched, moved, damaged or unexpected, and anything unscanned becomes missing at close." />
      {error && <AssetsAlert>{error}</AssetsAlert>}
      {message && <AssetsAlert tone="success">{message}</AssetsAlert>}
      <AssetsPanel title="Campaign">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <Select label="Open a campaign" options={(campaigns.data ?? []).map((c) => ({ value: c.id, label: `${c.campaign_number} ${c.name} (${label(c.status)})` }))} selectedKey={campaignId || null} onSelectionChange={(k) => setCampaignId(String(k ?? ""))} />
          {can("assets.inspect") && (
            <>
              <TextField label="Or start a new one: name" value={name} onChange={setName} />
              <Select label="Scope: location (optional)" options={locs} selectedKey={locationId || null} onSelectionChange={(k) => setLocationId(String(k ?? ""))} />
            </>
          )}
        </div>
        {can("assets.inspect") && <div className="flex justify-end"><Button variant="secondary" isDisabled={!name.trim()} isLoading={create.isPending} onPress={() => create.mutate()}>Create campaign</Button></div>}
      </AssetsPanel>
      {d && (
        <>
          <AssetsPanel title={`${String(d.campaign.campaign_number)}: ${String(d.campaign.name)}`} description={`Status ${label(status)}. Expected ${d.summary.expected}; matched ${d.summary.matched ?? 0}, moved ${d.summary.moved ?? 0}, damaged ${d.summary.damaged ?? 0}, unexpected ${d.summary.unexpected ?? 0}, missing ${d.summary.missing ?? 0}, not yet scanned ${d.summary.pending ?? 0}.`}>
            <div className="flex flex-wrap gap-2">
              {status === "draft" && can("assets.inspect") && <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate({ action: "campaign-start" })}>Start campaign</Button>}
              {status === "in_progress" && can("assets.inspect") && <Button variant="primary" isLoading={step.isPending} onPress={() => step.mutate({ action: "campaign-close", input: { markRemainingMissing: true } })}>Close (unscanned become missing)</Button>}
              {["draft", "in_progress"].includes(status) && can("assets.inspect") && <Button variant="secondary" isLoading={step.isPending} onPress={() => step.mutate({ action: "campaign-cancel" })}>Cancel campaign</Button>}
            </div>
          </AssetsPanel>
          {status === "in_progress" && (
            <AssetsPanel title="Scan">
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
                <TextField label="Tag, asset number or serial" value={tag} onChange={setTag} autoFocus />
                <Select label="Found in" options={locs} selectedKey={foundLocationId || null} onSelectionChange={(k) => setFoundLocationId(String(k ?? ""))} />
                <Select label="Condition" options={["excellent", "good", "fair", "poor", "critical"].map((v) => ({ value: v, label: label(v) }))} selectedKey={condition || null} onSelectionChange={(k) => setCondition(String(k ?? ""))} />
                <Button variant="primary" isDisabled={!tag.trim()} isLoading={scan.isPending} onPress={() => scan.mutate()}>Record scan</Button>
              </div>
            </AssetsPanel>
          )}
          <AssetsPanel title="Lines">
            {status === "in_progress" && <TextField label="Resolution note (required to resolve a discrepancy)" value={note} onChange={setNote} />}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-text-muted"><th className="px-2 py-1 font-medium">Asset</th><th className="px-2 py-1 font-medium">Expected in</th><th className="px-2 py-1 font-medium">Found in</th><th className="px-2 py-1 font-medium">Result</th><th className="px-2 py-1 font-medium">Resolution</th><th className="px-2 py-1" /></tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border/50">
                      <td className="px-2 py-1">{String(l.asset_number ?? l.scanned_tag ?? "Unknown tag")} {l.asset_name ? `· ${l.asset_name}` : ""}</td>
                      <td className="px-2 py-1">{String(l.expected_location_name ?? "")}</td>
                      <td className="px-2 py-1">{String(l.found_location_name ?? "")}</td>
                      <td className="px-2 py-1"><StatusBadge tone={tone(l.result)}>{label(l.result)}</StatusBadge></td>
                      <td className="px-2 py-1">{l.resolution_status === "open" ? "Open" : l.resolution_status === "resolved" ? String(l.resolution_note ?? "Resolved") : ""}</td>
                      <td className="px-2 py-1">
                        {status === "in_progress" && l.resolution_status === "open" && (
                          <div className="flex flex-wrap gap-1">
                            {l.result === "moved" && can("assets.manage") && <Button variant="ghost" size="compact" isDisabled={!note.trim()} onPress={() => resolve.mutate({ id: l.id, action: "update_location" })}>Update location</Button>}
                            {["missing", "unexpected"].includes(String(l.result)) && l.asset_id && can("assets.manage") && <Button variant="ghost" size="compact" isDisabled={!note.trim()} onPress={() => resolve.mutate({ id: l.id, action: "mark_lost" })}>Mark lost</Button>}
                            <Button variant="ghost" size="compact" isDisabled={!note.trim()} onPress={() => resolve.mutate({ id: l.id, action: "accept" })}>Accept</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AssetsPanel>
        </>
      )}
    </div>
  );
}
