"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, MetricStrip, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { InvApiError, readStock } from "@/features/inventory/shared/client";
import { calendarDate, dateTime, label, quantity } from "@/features/inventory/shared/format";
import { InvAlert, InvPanel } from "@/features/inventory/shared/InvUi";

type Movement = { id: string; movement_number: string; movement_type: string; quantity: string; reference_type: string | null; reference_id: string | null; reason: string | null; occurred_at: string; warehouse_name: string; location_code: string | null };
type Trace = {
  kind: "batch" | "serial";
  subject: { batch_number?: string; serial_number?: string; status: string; expires_on?: string | null; item_code: string; item_name: string };
  movements: Movement[];
  balances: Array<{ warehouse_name: string; location_code: string | null; quantity: string; reserved_quantity: string }>;
  holds: Array<{ hold_number: string; hold_type: string; status: string; reason: string | null }>;
  summary: { receivedQuantity: string; issuedQuantity: string; movements: number };
};

// Batch / serial genealogy (F141): where it came from, everything that touched it, what is left.
export function GenealogyScreen() {
  const [code, setCode] = useState("");
  const trace = useMutation({ mutationFn: () => readStock<{ trace: Trace }>("traceability", { code: code.trim() }).then((r) => r.trace) });
  const t = trace.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Genealogy" description="Trace a batch or serial number from the receipt that created it to every movement that touched it." />
      <InvPanel>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (code.trim()) trace.mutate(); }}>
          <TextField label="Batch or serial number" value={code} onChange={setCode} className="min-w-[280px]" />
          <Button type="submit" variant="primary" isLoading={trace.isPending} isDisabled={!code.trim()}>Trace</Button>
        </form>
        {trace.error && <InvAlert>{trace.error instanceof InvApiError ? trace.error.message : "Trace failed."}</InvAlert>}
      </InvPanel>
      {t && (
        <>
          <InvPanel title={`${label(t.kind)} ${t.subject.batch_number ?? t.subject.serial_number}`} description={`${t.subject.item_name} (${t.subject.item_code}) · ${label(t.subject.status)}${t.subject.expires_on ? ` · expires ${calendarDate(t.subject.expires_on)}` : ""}`}>
            <MetricStrip metrics={[{ label: "Received", value: quantity(t.summary.receivedQuantity) }, { label: "Issued", value: quantity(t.summary.issuedQuantity) }, { label: "Movements", value: String(t.summary.movements) }]} />
            {t.holds.length > 0 && <InvAlert tone="warning">Quality hold: {t.holds.map((h) => `${h.hold_number} (${label(h.status)})`).join(", ")}</InvAlert>}
          </InvPanel>
          {t.balances.length > 0 && (
            <InvPanel title="Where it is now">
              <ul className="text-sm">
                {t.balances.map((b, index) => (
                  <li key={index}>{b.warehouse_name}{b.location_code ? ` · ${b.location_code}` : ""} — {quantity(b.quantity)} on hand, {quantity(b.reserved_quantity)} reserved</li>
                ))}
              </ul>
            </InvPanel>
          )}
          <InvPanel title="History">
            <ol className="flex flex-col gap-2 text-sm" aria-label="Movement history">
              {t.movements.map((m) => (
                <li key={m.id} className="flex flex-wrap gap-x-3 border-b border-border/60 pb-2">
                  <span className="text-text-muted">{dateTime(m.occurred_at)}</span>
                  <span className="font-medium text-text">{m.movement_number}</span>
                  <span>{label(m.movement_type)} {quantity(m.quantity)}</span>
                  <span>{m.warehouse_name}{m.location_code ? ` · ${m.location_code}` : ""}</span>
                  <span className="text-text-secondary">{m.reference_type ? `${label(m.reference_type)}${m.reference_id ? ` ${m.reference_id.slice(0, 8)}` : ""}` : ""}</span>
                  {m.reason && <span className="text-text-muted">{m.reason}</span>}
                </li>
              ))}
            </ol>
          </InvPanel>
        </>
      )}
    </div>
  );
}

type Quarantine = { holds: Array<{ id: string; hold_number: string; hold_type: string; reason: string | null; item_code: string; item_name: string; warehouse_name: string | null; batch_number: string | null; serial_number: string | null; quantity: string; released_quantity: string }>; located: Array<{ id: string; item_code: string; item_name: string; warehouse_name: string; location_code: string; batch_number: string | null; quantity: string }> };

// Stock that cannot be sold: under an active Quality hold, or sitting in a quarantine (quality) location.
export function QuarantineScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "quarantine"), queryFn: () => readStock<Quarantine>("quarantine") });
  if (query.isError && query.error instanceof InvApiError && query.error.status === 403) return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant stock.view." />;
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Quarantine" description="Stock that is held back from sale. Holds are placed and released in Quality; damaged returns are received into a quarantine location." />
      <InvPanel title="Quality holds" description="Active holds reduce available stock until released.">
        {!data ? <p className="text-sm text-text-muted">Loading…</p> : data.holds.length === 0 ? <p className="text-sm text-text-muted">No active quality holds.</p> : (
          <ul className="flex flex-col gap-1 text-sm" aria-label="Quality holds">
            {data.holds.map((h) => (
              <li key={h.id}><span className="font-medium text-text">{h.hold_number}</span> · {h.item_name} ({h.item_code}){h.warehouse_name ? ` · ${h.warehouse_name}` : ""}{h.batch_number ? ` · batch ${h.batch_number}` : ""}{h.serial_number ? ` · serial ${h.serial_number}` : ""} · {Number(h.quantity) === 0 ? "whole scope held" : `${quantity(Number(h.quantity) - Number(h.released_quantity))} held`}{h.reason ? ` — ${h.reason}` : ""}</li>
            ))}
          </ul>
        )}
        <Link href="/quality" className="text-sm text-brand hover:underline">Open Quality</Link>
      </InvPanel>
      <InvPanel title="In quarantine locations" description="Stock in bins of type Quality.">
        {!data ? <p className="text-sm text-text-muted">Loading…</p> : data.located.length === 0 ? <p className="text-sm text-text-muted">Nothing is in a quarantine location.</p> : (
          <ul className="flex flex-col gap-1 text-sm" aria-label="Quarantine locations">
            {data.located.map((l) => (
              <li key={l.id}>{l.item_name} ({l.item_code}) · {l.warehouse_name} · {l.location_code}{l.batch_number ? ` · batch ${l.batch_number}` : ""} — {quantity(l.quantity)}</li>
            ))}
          </ul>
        )}
      </InvPanel>
    </div>
  );
}
