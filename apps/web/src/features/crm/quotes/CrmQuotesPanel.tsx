"use client";

// The deal's CRM quotes (CRM audit M1): for an organization without the Sales app, the deal makes its own quotation or proforma — new
// ones open in the quote screen to edit, then download, email or share on WhatsApp. With Sales on, older CRM quotes stay listed with
// "In Sales" once moved there; new quotations are made in Sales.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { Button, EmptyState, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createDealQuote, listDealQuotes, QUOTE_STATUS, quoteErrorMessage } from "./quotes-api";

export function CrmQuotesPanel({ opportunityId, open, hasCompany, hideWhenEmpty = false }: {
  opportunityId: string; open: boolean; hasCompany: boolean; hideWhenEmpty?: boolean;
}) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunityId, "crm-quotes"), queryFn: () => listDealQuotes(opportunityId) });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (kind: "quotation" | "proforma") => createDealQuote(opportunityId, kind),
    onSuccess: (view) => router.push(`/crm/quotes/${view.quote.id}`),
    onError: (failure) => setError(quoteErrorMessage(failure, "The quote could not be created.")),
  });
  if (query.isLoading) return <LoadingState label="Loading quotes" rows={2} />;
  const quotes = query.data?.quotes ?? [];
  const canCreate = Boolean(query.data?.capabilities.create) && open;
  if (hideWhenEmpty && !quotes.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Quotes made in CRM">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          {canCreate ? "Make a quotation or proforma for this deal, then download it, email it or send the link on WhatsApp. Sending or accepting one does not win the deal."
            : "Quotes made in CRM before Sales was switched on."}
        </p>
        {canCreate && (
          <span className="flex gap-2">
            <Button variant="secondary" size="compact" isDisabled={!hasCompany} isLoading={create.isPending && create.variables === "proforma"} onPress={() => create.mutate("proforma")}>
              <FileText className="size-4" aria-hidden="true" />New proforma
            </Button>
            <Button variant="primary" size="compact" isDisabled={!hasCompany} isLoading={create.isPending && create.variables === "quotation"} onPress={() => create.mutate("quotation")}>
              <Plus className="size-4" aria-hidden="true" />New quotation
            </Button>
          </span>
        )}
      </div>
      {canCreate && !hasCompany && <Notice tone="warning">Add the customer&apos;s company to this deal before making a quote.</Notice>}
      {error && <Notice>{error}</Notice>}
      {!quotes.length ? <EmptyState title="No quotes yet" description={canCreate ? "Your first quotation starts with this deal's products and value." : "None was made in CRM."} />
        : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
            {quotes.map((quote) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-col">
                  <Link href={`/crm/quotes/${quote.id}`} className="text-sm font-medium text-brand hover:underline">{quote.kindLabel} {quote.number}</Link>
                  <span className="text-xs text-text-muted">
                    {formatDate(quote.quoteDate)}{quote.validUntil ? ` · valid until ${formatDate(quote.validUntil)}` : ""}
                    {quote.salesQuotationNumber ? ` · now Sales quotation ${quote.salesQuotationNumber}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums text-text">{formatMoney(quote.currencyCode, Number(quote.grandTotal))}</span>
                  <StatusBadge tone={QUOTE_STATUS[quote.status].tone}>{QUOTE_STATUS[quote.status].label}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
