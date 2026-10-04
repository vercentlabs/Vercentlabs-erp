"use client";

// Every quotation raised from the opportunity: number and revision, status
// (Expired is derived), amount, validity, how it was sent, the customer's
// answer and any sales order it became. A deal can have many quotations; one
// is its primary quotation. None of them wins or loses the deal by itself.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge, Button, EmptyState, LinkButton, StatusBadge } from "@vercentlabs/design-system";

import { QuotationLifecycleActions } from "@/features/sales/quotations/components/QuotationLifecycleActions";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, listOpportunityQuotations, setPrimaryOpportunityQuotation, type OpportunityQuotation } from "../api/quotations-api";
import { CreateQuotationDialog } from "./CreateQuotationDialog";

const TONES: Record<string, "success" | "neutral" | "info" | "warning" | "danger"> = {
  accepted: "success", converted: "success", cancelled: "neutral", rejected: "danger", draft: "neutral", pending_approval: "warning",
};

export function OpportunityQuotationsPanel({ opportunity, canCreate, canEdit, onChanged, onMarkWon }: {
  opportunity: { id: string; status: string; archivedAt: string | null; estimatedValue: number; currencyCode: string | null };
  canCreate: boolean; canEdit: boolean; onChanged: () => void;
  // Starts Mark won with this quotation as the winning one (the deal is never won automatically).
  onMarkWon?: (quotationId: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "opportunity", opportunity.id, "quotations");
  const query = useQuery({ queryKey: key, queryFn: () => listOpportunityQuotations(opportunity.id) });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const primary = useMutation({
    mutationFn: (quotationId: string | null) => setPrimaryOpportunityQuotation(opportunity.id, quotationId),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const open = opportunity.status === "open" && !opportunity.archivedAt;
  const quotations = query.data?.quotations ?? [];
  const latest = quotations.find((entry) => entry.isLatest);

  if (query.data && !query.data.visible) return <EmptyState title="Quotations are Sales documents" description="You need access to Sales to see this opportunity's quotations." />;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          A deal can have several quotations. Creating, sending or accepting one does not win the deal; mark it won when it is closed.
          {latest?.total !== null && latest ? ` Estimated ${formatMoney(opportunity.currencyCode ?? undefined, opportunity.estimatedValue)} · latest quoted ${formatMoney(latest.currencyCode ?? undefined, latest.total ?? 0)}.` : ""}
        </p>
        {canCreate && open && <Button variant="primary" size="compact" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />Create quotation</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {query.isLoading ? <LoadingState label="Loading quotations" rows={2} /> : query.isError ? (
        <p role="alert" className="text-sm text-danger">{errorMessage(query.error, "The quotations could not be loaded.")}</p>
      ) : quotations.length === 0 ? (
        <EmptyState title="No quotations yet" description={canCreate && open ? "Create a quotation from this opportunity: the customer, contact and products are filled in." : undefined} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {quotations.map((entry) => <QuotationRow key={entry.id} entry={entry} can={can} canEdit={canEdit} onPrimary={(id) => primary.mutate(id)} onChanged={refresh} onMarkWon={open ? onMarkWon : undefined} />)}
        </ul>
      )}
      <CreateQuotationDialog opportunityId={opportunity.id} isOpen={creating} onOpenChange={setCreating} onCreated={refresh} />
    </section>
  );
}

function QuotationRow({ entry, can, canEdit, onPrimary, onChanged, onMarkWon }: {
  entry: OpportunityQuotation; can: (permission: string) => boolean; canEdit: boolean; onPrimary: (id: string) => void; onChanged: () => void; onMarkWon?: (quotationId: string) => void;
}) {
  const revisable = ["draft", "approved", "sent", "viewed", "rejected", "expired"].includes(entry.status) && can(entry.status === "draft" ? "sales.quotation.create" : "sales.quotation.revise");
  const facts = [
    entry.total !== null ? formatMoney(entry.currencyCode ?? undefined, entry.total) : null,
    entry.validUntil ? `Valid until ${formatDate(entry.validUntil)}` : null,
    entry.sentAt ? `Sent ${formatDateTime(entry.sentAt)}${entry.sentTo ? ` to ${entry.sentTo}` : ""}${entry.sentChannel === "manual" ? " (outside Vercentlabs)" : ""}` : null,
    entry.acceptedAt ? `Accepted ${formatDate(entry.acceptedAt)}${entry.decisionReference ? ` · ${entry.decisionReference}` : ""}` : null,
    entry.rejectedAt ? `Rejected ${formatDate(entry.rejectedAt)}${entry.decisionNotes ? `: ${entry.decisionNotes}` : ""}` : null,
    entry.cancelledAt ? `Cancelled${entry.cancelReason ? `: ${entry.cancelReason}` : ""}` : null,
    entry.ownerName,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/sales/quotations/${entry.id}`} className="font-medium text-brand underline-offset-2 hover:underline">{entry.number}{entry.revision > 1 ? ` · revision ${entry.revision}` : ""}</Link>
        <StatusBadge tone={entry.isExpired ? "warning" : TONES[entry.status] ?? "info"}>{entry.statusLabel}</StatusBadge>
        {entry.isPrimary && <Badge tone="brand">Primary</Badge>}
        {entry.isWinning && <Badge tone="success">Winning</Badge>}
        {entry.isLatest && !entry.isPrimary && <Badge tone="neutral">Latest</Badge>}
        {entry.salesOrderId && <Link href={`/sales/orders/${entry.salesOrderId}`} className="text-brand underline-offset-2 hover:underline">Sales order {entry.salesOrderNumber}</Link>}
      </div>
      <p className="text-text-secondary">{facts.join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <QuotationLifecycleActions size="compact" can={can} onChanged={onChanged}
          quotation={{ id: entry.id, number: entry.number, status: entry.status, isExpired: entry.isExpired, convertedOrderId: entry.salesOrderId }} />
        {onMarkWon && ["accepted", "converted"].includes(entry.status) && <Button variant="primary" size="compact" onPress={() => onMarkWon(entry.id)}>Mark opportunity won</Button>}
        {revisable && <LinkButton variant="secondary" size="compact" href={`/sales/quotations/${entry.id}/revise`}>{entry.status === "draft" ? "Edit draft" : "Revise"}</LinkButton>}
        {canEdit && !entry.isPrimary && entry.status !== "cancelled" && <Button variant="ghost" size="compact" onPress={() => onPrimary(entry.id)}>Make primary</Button>}
      </div>
    </li>
  );
}
