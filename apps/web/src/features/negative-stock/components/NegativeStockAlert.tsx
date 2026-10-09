"use client";

// The in-app negative-stock alert: shown wherever inventory is looked at when negative positions are open (and the company keeps alerts on),
// for those who may see negative-stock warnings. Links to the report.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { NEGATIVE_STOCK_BASE, getNegativeSummary } from "../api/negative-stock-api";

export function NegativeStockAlert() {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "negative-stock", "summary"), queryFn: getNegativeSummary, retry: false, staleTime: 30_000 });
  const open = summary.data?.open ?? 0;
  if (!summary.data?.alertsEnabled || !open) return null;
  return (
    <Link href={NEGATIVE_STOCK_BASE} role="status"
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger hover:underline">
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span><span className="font-semibold">Inventory exceptions · Negative stock: {open}</span> position{open === 1 ? " is" : "s are"} below zero and need a receipt, return or transfer.</span>
    </Link>
  );
}
