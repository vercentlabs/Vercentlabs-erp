"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, NumberField, PageHeader, PermissionState, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, InvApiError, readStock } from "@/features/inventory/shared/client";
import { dateTime, label, quantity, tone } from "@/features/inventory/shared/format";
import { InvAlert, InvPanel, useCan } from "@/features/inventory/shared/InvUi";

type Line = { id: string; item_code: string; item_name: string; location_code: string | null; batch_number: string | null; requested_quantity: string; picked_quantity: string; packed_quantity: string; short_reason: string | null };
type Pick = { id: string; pick_number: string; status: string; reference_label: string | null; warehouse_name: string | null; carrier: string | null; tracking_number: string | null; shipped_at: string | null; cancel_reason: string | null; lines: Line[]; packages: Array<{ id: string; package_number: string; weight_kg: string | null; contents: Array<{ itemCode: string; quantity: string }> | null }> };

const errorText = (error: unknown) => (error instanceof InvApiError ? error.message : "That could not be completed.");

export function PickDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "pick", id), queryFn: () => readStock<{ pick: Pick }>("pick", { id }).then((r) => r.pick) });
  const [picks, setPicks] = useState<Record<string, { qty?: number; reason?: string }>>({});
  const [packQty, setPackQty] = useState<Record<string, number>>({});
  const [weight, setWeight] = useState<number>(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"ship" | "cancel" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") });

  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown>; success: string }) => act(action, body),
    onSuccess: (_r, v) => {
      setNotice(v.success);
      setError(null);
      setDialog(null);
      if (v.action === "pick-record") setPicks({});
      if (v.action === "pack-create") { setPackQty({}); setWeight(0); }
      refresh();
    },
    onError: (e) => { setError(errorText(e)); setNotice(null); },
  });

  const pick = query.data;
  if (query.isError && query.error instanceof InvApiError && query.error.status === 403) return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant stock.view." />;
  if (!pick) return <p className="px-4 py-8 text-sm text-text-secondary">{query.isError ? "This pick list could not be loaded." : "Loading…"}</p>;

  const canAct = can("stock.issue");
  const picking = pick.status === "open" || pick.status === "picking";
  const packing = pick.status === "picked" || pick.status === "packing";
  const pendingPicks = Object.entries(picks).filter(([, v]) => v.qty !== undefined || v.reason !== undefined);
  const savePicks = () =>
    run.mutate({
      action: "pick-record",
      success: "Picks saved.",
      body: { listId: pick.id, picks: pendingPicks.map(([lineId, v]) => { const line = pick.lines.find((l) => l.id === lineId)!; return { lineId, pickedQuantity: v.qty ?? Number(line.picked_quantity), shortReason: v.reason ?? line.short_reason ?? "" }; }) },
    });
  const packLines = Object.entries(packQty).filter(([, n]) => n > 0).map(([lineId, n]) => ({ lineId, quantity: n }));
  const unpackedOf = (line: Line) => Number(line.picked_quantity) - Number(line.packed_quantity);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={pick.pick_number}
        description={`${pick.warehouse_name ?? ""}${pick.reference_label ? ` · for ${pick.reference_label}` : ""}${pick.carrier ? ` · shipped via ${pick.carrier}${pick.tracking_number ? ` (${pick.tracking_number})` : ""}` : ""}`}
        secondaryActions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={tone(pick.status)}>{label(pick.status)}</StatusBadge>
            <Link href="/inventory/pick-lists" className="text-sm text-brand hover:underline">Back to pick lists</Link>
          </div>
        }
      />
      {notice && <InvAlert tone="success">{notice}</InvAlert>}
      {error && <InvAlert>{error}</InvAlert>}
      {pick.status === "cancelled" && <InvAlert tone="warning">Cancelled: {pick.cancel_reason}</InvAlert>}
      <MetricStrip metrics={[{ label: "Requested", value: quantity(pick.lines.reduce((t, l) => t + Number(l.requested_quantity), 0)) }, { label: "Picked", value: quantity(pick.lines.reduce((t, l) => t + Number(l.picked_quantity), 0)) }, { label: "Packed", value: quantity(pick.lines.reduce((t, l) => t + Number(l.packed_quantity), 0)) }, { label: "Packages", value: String(pick.packages.length) }, ...(pick.shipped_at ? [{ label: "Shipped", value: dateTime(pick.shipped_at) }] : [])]} />

      <InvPanel
        title="Lines"
        description={picking ? "Enter what you found. A quantity below the request needs a reason, and the difference is released back to available stock." : undefined}
        actions={
          canAct && (
            <div className="flex flex-wrap gap-2">
              {picking && <Button variant="secondary" onPress={savePicks} isDisabled={!pendingPicks.length} isLoading={run.isPending}>Save picks</Button>}
              {picking && <Button variant="primary" onPress={() => run.mutate({ action: "pick-complete", body: { id: pick.id }, success: "Picking complete." })} isDisabled={pendingPicks.length > 0}>Complete picking</Button>}
              {packing && <Button variant="primary" onPress={() => run.mutate({ action: "pack-complete", body: { id: pick.id }, success: "Packing complete." })}>Complete packing</Button>}
              {pick.status === "packed" && <Button variant="primary" onPress={() => setDialog("ship")}>Ship</Button>}
              {!["shipped", "cancelled"].includes(pick.status) && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel pick list</Button>}
            </div>
          )
        }
      >
        <div className="overflow-x-auto">
          <Table className="w-full text-left text-sm">
            <TableHead>
              <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                <TableHeaderCell className="px-2 py-2">Item</TableHeaderCell><TableHeaderCell className="px-2 py-2">Location</TableHeaderCell><TableHeaderCell className="px-2 py-2">Batch</TableHeaderCell><TableHeaderCell className="px-2 py-2">Requested</TableHeaderCell><TableHeaderCell className="px-2 py-2">Picked</TableHeaderCell><TableHeaderCell className="px-2 py-2">Packed</TableHeaderCell><TableHeaderCell className="px-2 py-2">Short reason</TableHeaderCell>{packing && <TableHeaderCell className="px-2 py-2">Pack now</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {pick.lines.map((line) => (
                <TableRow key={line.id} className="border-b border-border/60 align-top">
                  <TableCell className="px-2 py-2 font-medium text-text">{line.item_name} ({line.item_code})</TableCell>
                  <TableCell className="px-2 py-2">{line.location_code ?? "—"}</TableCell>
                  <TableCell className="px-2 py-2">{line.batch_number ?? "—"}</TableCell>
                  <TableCell className="px-2 py-2">{quantity(line.requested_quantity)}</TableCell>
                  <TableCell className="px-2 py-2">
                    {picking && canAct ? <NumberField aria-label={`Picked ${line.item_code}`} value={picks[line.id]?.qty ?? Number(line.picked_quantity)} minValue={0} step={0.001} onChange={(n) => setPicks((c) => ({ ...c, [line.id]: { ...c[line.id], qty: Number.isNaN(n) ? 0 : n } }))} /> : quantity(line.picked_quantity)}
                  </TableCell>
                  <TableCell className="px-2 py-2">{quantity(line.packed_quantity)}</TableCell>
                  <TableCell className="px-2 py-2">
                    {picking && canAct ? <TextField aria-label={`Short reason ${line.item_code}`} value={picks[line.id]?.reason ?? line.short_reason ?? ""} onChange={(text) => setPicks((c) => ({ ...c, [line.id]: { ...c[line.id], reason: text } }))} /> : (line.short_reason ?? "—")}
                  </TableCell>
                  {packing && (
                    <TableCell className="px-2 py-2">
                      {unpackedOf(line) > 0 && canAct ? <NumberField aria-label={`Pack ${line.item_code}`} value={packQty[line.id] ?? 0} minValue={0} maxValue={unpackedOf(line)} step={0.001} onChange={(n) => setPackQty((c) => ({ ...c, [line.id]: Number.isNaN(n) ? 0 : n }))} /> : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {packing && canAct && (
          <div className="flex flex-wrap items-end gap-3">
            <NumberField label="Package weight (kg)" value={weight} minValue={0} step={0.1} onChange={(n) => setWeight(Number.isNaN(n) ? 0 : n)} />
            <Button variant="secondary" onPress={() => run.mutate({ action: "pack-create", body: { listId: pick.id, lines: packLines, weightKg: weight || undefined }, success: "Package created." })} isDisabled={!packLines.length} isLoading={run.isPending}>Create package</Button>
          </div>
        )}
      </InvPanel>

      {pick.packages.length > 0 && (
        <InvPanel title="Packages">
          <ul className="flex flex-col gap-1 text-sm" aria-label="Packages">
            {pick.packages.map((p) => (
              <li key={p.id}><span className="font-medium text-text">{p.package_number}</span>{p.weight_kg ? ` · ${p.weight_kg} kg` : ""} — {(p.contents ?? []).map((c) => `${c.itemCode} × ${quantity(c.quantity)}`).join(", ")}</li>
            ))}
          </ul>
        </InvPanel>
      )}

      {dialog === "ship" && <ShipDialog error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(carrier, trackingNumber) => run.mutate({ action: "pick-ship", body: { id: pick.id, carrier, trackingNumber }, success: "Shipped. Stock has left the warehouse." })} />}
      {dialog === "cancel" && <CancelDialog error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(reason) => run.mutate({ action: "pick-cancel", body: { id: pick.id, reason }, success: "Pick list cancelled." })} />}
    </div>
  );
}

function ShipDialog({ onClose, onConfirm, isPending, error }: { onClose: () => void; onConfirm: (carrier: string, tracking: string) => void; isPending: boolean; error: string | null }) {
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Ship">
      <div className="flex flex-col gap-4">
        {error && <InvAlert>{error}</InvAlert>}
        <TextField label="Carrier" isRequired value={carrier} onChange={setCarrier} />
        <TextField label="Tracking number" value={tracking} onChange={setTracking} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(carrier.trim(), tracking.trim())} isLoading={isPending} isDisabled={!carrier.trim()}>Confirm shipment</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CancelDialog({ onClose, onConfirm, isPending, error }: { onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Cancel pick list">
      <div className="flex flex-col gap-4">
        {error && <InvAlert>{error}</InvAlert>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(reason.trim())} isLoading={isPending} isDisabled={!reason.trim()}>Cancel pick list</Button>
        </div>
      </div>
    </Dialog>
  );
}
