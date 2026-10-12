"use client";

// The POS sidebar's header: where the person is selling — outlet, counter and whether their shift is open — always in view while they work
// in POS. Shares the "current shift" query with the POS screens, so opening or closing a shift updates it at once.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type CurrentShift = { shiftNumber: string; status: string; storeName: string; terminalCode: string; terminalName: string } | null;

async function readCurrentShift(): Promise<CurrentShift> {
  const response = await fetch("/api/pos/shifts/current", { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return (payload?.shift ?? null) as CurrentShift;
}

export function PosCounterStatus({ tabIndex }: { tabIndex: number }) {
  const workspace = useWorkspaceContext();
  // Only for people who sell; Finance and managers without a counter see the plain workspace list.
  const sells = workspace.roleSlugs.includes("organization_owner") || ["pos.sale.create", "pos.operate", "pos.shift.open"].some((key) => workspace.permissions.includes(key));
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shifts", "current"), queryFn: readCurrentShift, staleTime: 30_000, enabled: sells });
  if (!sells || query.isLoading) return null;
  const shift = query.data ?? null;
  return (
    <Link href="/pos/shifts?tab=current" tabIndex={tabIndex}
      className="mx-2 flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-xs hover:border-brand">
      {shift ? (
        <>
          <span className="font-medium text-text">{shift.storeName}</span>
          <span className="text-text-secondary">{shift.terminalCode} · {shift.terminalName}</span>
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span aria-hidden="true" className={`size-2 rounded-full ${shift.status === "CLOSING" ? "bg-warning" : "bg-success"}`} />
            {shift.status === "CLOSING" ? "Shift closing" : "Shift open"} · {shift.shiftNumber}
          </span>
        </>
      ) : (
        <>
          <span className="font-medium text-text">No shift open</span>
          <span className="text-text-secondary">Open a shift to start selling</span>
        </>
      )}
    </Link>
  );
}
