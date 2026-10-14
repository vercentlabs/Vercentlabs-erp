"use client";

// An order's material availability on its Materials tab: readiness, the largest output the materials cover, the limiting materials and, per
// material, what is used, in production, reserved, available now, short and coming — never counting incoming supply as stock. It watches
// Inventory's change cursor and offers a refresh when stock moves; reserving previews first and reserves a shortfall only when confirmed.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, newKey, orderAction, qty } from "@/features/manufacturing/orders/api/mo-api";
import type { Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { EXCLUDED_LABEL, LINE_TONE, READINESS_TONE, SOURCE_LABEL, getAvailability, previewReservation, requestShortages } from "../api/availability-api";

type Perform = (work: () => Promise<unknown>, text: string) => Promise<void>;

// Reserve after a preview: everything available reserves at once; a shortfall asks first, then reserves exactly what is there.
export async function reserveWithPreview(orderId: string, onAsk: (ask: Ask) => void, perform: Perform) {
  const preview = await previewReservation(orderId);
  const reserve = (allowPartial: boolean) => perform(() => orderAction(orderId, "reserve-materials", { idempotencyKey: newKey(), allowPartial }),
    allowPartial ? "Available materials reserved; the rest stays short." : "Materials reserved.");
  if (preview.complete) return reserve(false);
  const short = preview.lines.filter((row) => Number(row.short) > 0 && !row.note);
  onAsk({
    title: "Reserve what is available?", confirm: "Reserve available",
    description: `Not everything can be reserved now — ${short.map((row) => `${row.code}: ${qty(row.reservable)} of ${qty(row.wanted)} ${row.uom}`).join("; ")}. `
      + "Reserving holds what is there for this order; the remainder stays short and can be requested from Procurement.",
    fields: [], run: () => reserve(true),
  });
}

export function MaterialAvailabilityPanel({ orderId, onAsk, perform }: { orderId: string; onAsk: (ask: Ask) => void; perform: Perform }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "material-availability", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => getAvailability(orderId), retry: false });
  const cursor = query.data?.inventory.cursor;
  // A light check against Inventory's cursor: has any of these materials moved since this view was calculated?
  const watch = useQuery({
    queryKey: [...key, "since", cursor], queryFn: () => getAvailability(orderId, cursor), enabled: cursor !== undefined && query.data?.availabilityAuthoritative === true,
    refetchInterval: 30_000, refetchIntervalInBackground: false, retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isLoading) return <LoadingState label="Checking material availability" rows={4} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return null;
    return <ErrorState title="Could not check material availability" description={errorMessage(query.error)} />;
  }
  const view = query.data;
  const stale = watch.data?.changedSince === true;
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); await refresh(); } catch { /* shown by perform */ } finally { setBusy(false); } };
  const request = () => run(async () => {
    let result: Awaited<ReturnType<typeof requestShortages>> | undefined;
    await perform(async () => { result = await requestShortages(orderId, { idempotencyKey: newKey() }); }, "Missing materials requested from Procurement.");
    if (result) setNotice(result.created.length ? `Requested: ${result.created.map((row) => `${row.number} · ${row.code} ${qty(row.quantity)}${Number(row.alreadyRequested) ? ` (beyond ${qty(row.alreadyRequested)} already requested)` : ""}`).join(", ")}.`
      : result.message ?? "Nothing new to request.");
  });
  return (
    <Panel title="Material availability" description={`From ${view.warehouse.code} · checked ${formatDateTime(view.calculatedAt)}. Usable stock only; incoming supply is shown but never counted as stock.`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={READINESS_TONE[view.readiness]}>{view.readinessLabel}</StatusBadge>
        <span className="text-sm">{view.nextAction}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {view.can.reserve && view.materials.some((row) => Number(row.newlyAvailable) > 0) && (
            <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => reserveWithPreview(orderId, onAsk, perform))}>Reserve materials</Button>
          )}
          {view.can.requestShortages && <Button size="compact" variant="secondary" isLoading={busy} onPress={request}>Request missing materials</Button>}
          <Button size="compact" variant="ghost" isLoading={query.isFetching} onPress={refresh}>Refresh</Button>
        </span>
      </div>
      {stale && <Notice tone="warning">Stock for these materials changed since this was calculated. <Button size="compact" variant="ghost" onPress={refresh}>Refresh now</Button></Notice>}
      {!view.availabilityAuthoritative && <Notice tone="warning">Stock cannot be verified right now{view.failure ? ` (${view.failure})` : ""}. Nothing here is a promise; refresh before reserving or issuing.</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      <FactList items={[
        ["Remaining to make", qty(view.remainingOutput)],
        ["Materials cover", qty(view.maximumFeasibleOutput)],
        ["Already allocated cover", qty(view.allocatedFeasibleOutput)],
        ["Cannot be made yet", qty(view.unfeasibleOutput)],
        ["Limited by", view.limiting.length ? view.limiting.join(", ") : "—"],
      ]} />
      {Number(view.maximumFeasibleOutput) > 0 && Number(view.unfeasibleOutput) > 0 && (
        <p className="text-xs text-text-muted">A smaller batch of {qty(view.maximumFeasibleOutput)} could go ahead. {view.partialProduction.note}</p>
      )}
      <LinesTable columns={["Material", { label: "Required", numeric: true }, { label: "Used", numeric: true }, { label: "In production", numeric: true }, { label: "Reserved", numeric: true },
        { label: "Available now", numeric: true }, { label: "Short", numeric: true }, "Coming", "Requested", "Status"]}>
        {view.materials.map((row) => (
          <tr key={row.materialId}>
            <Cell><span className="flex flex-col"><span>{row.code} · {row.name}</span>
              <span className="text-xs text-text-muted">{row.uom}{row.kind === "SUBASSEMBLY" ? " · subassembly" : ""}{row.origin === "EXTRA" ? " · extra" : ""}
                {row.eligibility.excluded.length ? ` · not usable: ${row.eligibility.excluded.map((part) => `${qty(part.quantity)} ${EXCLUDED_LABEL[part.reason] ?? part.reason.replace(/_/g, " ")}`).join(", ")}` : ""}
                {row.alternates?.length ? ` · elsewhere: ${row.alternates.map((part) => `${part.warehouse} ${qty(part.available)}`).join(", ")}` : ""}</span>
              {row.blockers.map((blocker) => <span key={blocker} className="text-xs text-danger">{blocker}</span>)}</span></Cell>
            <Cell numeric>{qty(row.required)}</Cell><Cell numeric>{qty(row.consumed)}</Cell><Cell numeric>{qty(row.inProduction)}</Cell><Cell numeric>{qty(row.reserved)}</Cell>
            <Cell numeric>{qty(row.newlyAvailable)}</Cell><Cell numeric>{Number(row.shortage) ? qty(row.shortage) : ""}</Cell>
            <Cell>{row.incomingSources.length ? (
              <span className="flex flex-col text-xs">{row.incomingSources.map((source) => (
                <span key={`${source.source}-${source.id}`}>{source.source === "CHILD_ORDER" ? <Link className="text-brand underline" href={`${MO_BASE}/${source.id}`}>{source.reference}</Link> : source.reference}
                  {" "}{qty(source.quantity)} · {SOURCE_LABEL[source.source]}{source.expected ? `, due ${formatDate(source.expected)}` : ""}</span>
              ))}</span>
            ) : ""}</Cell>
            <Cell>{row.requested.map((demand) => `${demand.number} (${qty(demand.quantity)})`).join(", ")}</Cell>
            <Cell><StatusBadge tone={LINE_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
          </tr>
        ))}
      </LinesTable>
      <p className="text-xs text-text-muted">
        Used is gone; in production is issued and not yet used; reserved is held for this order; available now is free usable stock no other order holds. Short is what none of these cover.
        {!view.can.seeAlternates ? "" : " Other warehouses are shown for information — move stock there with a transfer."}
      </p>
    </Panel>
  );
}
