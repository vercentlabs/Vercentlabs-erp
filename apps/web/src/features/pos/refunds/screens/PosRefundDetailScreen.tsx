"use client";

// One refund: its source, the refund panel (tenders, statuses, actions) and every attempt made — each provider call or cash payout on record.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState, PageHeader } from "@vercentlabs/design-system";

import { SOURCE_LABEL, getRefund } from "@/features/pos/refunds/api/refunds-api";
import { RefundPanel } from "@/features/pos/refunds/components/RefundPanel";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosBackLink, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function PosRefundDetailScreen({ refundId }: { refundId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "refund", refundId);
  const query = useQuery({ queryKey: key, queryFn: () => getRefund(refundId) });
  if (query.isLoading) return <PosLoading label="Loading refund…" />;
  if (query.isError || !query.data) return <ErrorState title="Could not load this refund" description={query.error instanceof PosApiError ? query.error.message : undefined} />;
  const refund = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PosBackLink href="/pos/returns?tab=refunds">Back to refunds</PosBackLink>
      <PageHeader title={`Refund ${refund.refundNumber}`}
        description={`${SOURCE_LABEL[refund.sourceType] ?? refund.sourceType}${refund.returnNumber ? ` ${refund.returnNumber}` : ""}${refund.invoiceNumber || refund.receiptNumber ? ` · original sale ${refund.invoiceNumber ?? refund.receiptNumber}` : ""}${refund.creditNoteNumber ? ` · credit note ${refund.creditNoteNumber}` : ""}`} />
      <RefundPanel refund={refund} onChange={(next) => queryClient.setQueryData(key, next)} />
      <PosPanel title="Attempts" description="Every payout and provider call made for this refund.">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">When</th><th className="pb-1 text-left">Route</th><th className="pb-1 text-left">#</th>
            <th className="pb-1 text-right">Amount</th><th className="pb-1 text-left">Outcome</th></tr></thead>
          <tbody>{refund.attempts.map((attempt) => (
            <tr key={attempt.id} className="border-t border-border">
              <td className="py-1.5">{dateTime(attempt.requestedAt)}</td><td>{attempt.route}</td><td>{attempt.attempt}</td>
              <td className="text-right tabular-nums">{money(refund.currency, attempt.amount)}</td>
              <td>{attempt.status.toLowerCase()}{attempt.providerReference ? ` · ${attempt.providerReference}` : ""}{attempt.error ? ` — ${attempt.error}` : ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </PosPanel>
    </div>
  );
}
