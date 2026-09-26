"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listSalesQuotations } from "@/features/sales";
import { formatDate, formatMoney, humanize } from "@/shared/format/human";

// F023 — the quotations raised from this Opportunity (sales_quotations.
// source_opportunity_id), so the deal shows its commercial follow-through
// instead of the link existing only on the Sales side.
export function OpportunityQuotationsPanel({ opportunityId }: { opportunityId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotations", "by-opportunity", opportunityId),
    queryFn: () => listSalesQuotations({ opportunityId, limit: 20 }),
  });

  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label="Quotations">
      <h3 className="text-sm font-semibold text-text">Quotations</h3>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading quotations…</p>
      ) : query.isError ? (
        <p className="text-sm text-text-muted">Quotations are not available to you.</p>
      ) : (query.data?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-text-muted">No quotations yet. Use Convert to Quotation to price this deal.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {query.data!.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <Link href={`/sales/quotations/${row.id}`} className="font-medium text-brand hover:underline">
                {`${row.quotation_number} · v${row.version_number}`}
              </Link>
              <span className="flex items-center gap-3 text-text-secondary">
                <span className="tabular-nums text-text">{formatMoney(row.currency_code, row.grand_total)}</span>
                {row.valid_until && <span>{`Valid until ${formatDate(row.valid_until)}`}</span>}
                <StatusBadge tone={row.lifecycle_status === "accepted" || row.lifecycle_status === "converted" ? "success" : row.lifecycle_status === "cancelled" ? "neutral" : "info"}>
                  {humanize(row.lifecycle_status)}
                </StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
