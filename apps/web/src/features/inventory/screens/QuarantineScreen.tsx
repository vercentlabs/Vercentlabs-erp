"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { InvApiError, readStock } from "@/features/inventory/shared/client";
import { quantity } from "@/features/inventory/shared/format";
import { InvPanel } from "@/features/inventory/shared/InvUi";

type Quarantine = {
  holds: Array<{
    id: string;
    hold_number: string;
    hold_type: string;
    reason: string | null;
    item_code: string;
    item_name: string;
    warehouse_name: string | null;
    batch_number: string | null;
    serial_number: string | null;
    quantity: string;
    released_quantity: string;
  }>;
  located: Array<{
    id: string;
    item_code: string;
    item_name: string;
    warehouse_name: string;
    location_code: string;
    batch_number: string | null;
    quantity: string;
  }>;
};

// Stock that cannot be sold: under an active Quality hold, or sitting in a quarantine (quality) location.
export function QuarantineScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "inventory", "quarantine"),
    queryFn: () => readStock<Quarantine>("quarantine"),
  });
  if (
    query.isError &&
    query.error instanceof InvApiError &&
    query.error.status === 403
  )
    return (
      <PermissionState
        title="You don't have access to Inventory"
        description="Ask an administrator to grant stock.view."
      />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Quarantine"
        description="Stock that is held back from sale. Holds are placed and released in Quality; damaged returns are received into a quarantine location."
      />
      <InvPanel
        title="Quality holds"
        description="Active holds reduce available stock until released."
      >
        {!data ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : data.holds.length === 0 ? (
          <p className="text-sm text-text-muted">No active quality holds.</p>
        ) : (
          <ul
            className="flex flex-col gap-1 text-sm"
            aria-label="Quality holds"
          >
            {data.holds.map((h) => (
              <li key={h.id}>
                <span className="font-medium text-text">{h.hold_number}</span> ·{" "}
                {h.item_name} ({h.item_code})
                {h.warehouse_name ? ` · ${h.warehouse_name}` : ""}
                {h.batch_number ? ` · batch ${h.batch_number}` : ""}
                {h.serial_number ? ` · serial ${h.serial_number}` : ""} ·{" "}
                {Number(h.quantity) === 0
                  ? "whole scope held"
                  : `${quantity(Number(h.quantity) - Number(h.released_quantity))} held`}
                {h.reason ? ` — ${h.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
        <Link href="/quality" className="text-sm text-brand hover:underline">
          Open Quality
        </Link>
      </InvPanel>
      <InvPanel
        title="In quarantine locations"
        description="Stock in bins of type Quality."
      >
        {!data ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : data.located.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing is in a quarantine location.
          </p>
        ) : (
          <ul
            className="flex flex-col gap-1 text-sm"
            aria-label="Quarantine locations"
          >
            {data.located.map((l) => (
              <li key={l.id}>
                {l.item_name} ({l.item_code}) · {l.warehouse_name} ·{" "}
                {l.location_code}
                {l.batch_number ? ` · batch ${l.batch_number}` : ""} —{" "}
                {quantity(l.quantity)}
              </li>
            ))}
          </ul>
        )}
      </InvPanel>
    </div>
  );
}
