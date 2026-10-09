"use client";

// The Replenishment tab of an item: its reorder rule per warehouse, where each stands now (current and projected position against the
// reorder level and target, what to order) and the rule's page. Rules are created and changed in Replenishment.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { REPLENISHMENT_BASE, STATUS_TONE, listRules } from "../api/replenishment-api";

const quantity = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 6 });

export function ItemReplenishmentPanel({ itemId }: { itemId: string }) {
  const workspace = useWorkspaceContext();
  const rules = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "list", { view: "all", itemId }), queryFn: () => listRules({ view: "all", itemId }) });
  if (rules.isLoading) return <LoadingState label="Loading reorder rules" />;
  if (rules.isError)
    return <ErrorState title="Could not load reorder rules" description={rules.error instanceof Error ? rules.error.message : undefined} action={{ label: "Retry", onPress: () => rules.refetch() }} />;
  const rows = rules.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">Static Min/Max per warehouse: a requirement counts eligible stock, firm demand and confirmed incoming.</p>
        <Link className="text-sm text-brand hover:underline" href={`${REPLENISHMENT_BASE}?tab=rules&itemId=${itemId}`}>Open in Replenishment</Link>
      </div>
      {!rows.length ? <p className="text-sm text-text-muted">No reorder rule for this item yet.{rules.data?.capabilities.create ? " Add one in Replenishment." : ""}</p> : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-text-muted">
              <th className="px-3 py-2 font-normal">Warehouse</th><th className="px-3 py-2 font-normal">Status</th>
              {["Reorder level", "Target", "Current", "Projected", "Suggested"].map((label) => <th key={label} className="px-3 py-2 text-right font-normal">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-3 py-2"><Link className="font-medium text-brand hover:underline" href={`${REPLENISHMENT_BASE}/${rule.id}`}>{rule.warehouse}</Link>
                    <span className="block text-xs text-text-muted">{rule.warehouseName}</span></td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[rule.status]}>{rule.statusLabel}</Badge></td>
                  <td className="px-3 py-2 text-right tabular-nums">{quantity(rule.reorderLevel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{quantity(rule.targetLevel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{quantity(rule.currentPosition)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{quantity(rule.projectedPosition)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rule.suggested > 0 ? quantity(rule.suggested) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
