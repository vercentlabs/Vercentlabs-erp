"use client";

// CRM › Quotations (CRM audit navigation): every quotation and proforma made from the deals you can see. With the Sales app on, new
// quotations are made in Sales — the page links there, and lists the CRM quotes made before.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, EnterpriseListPage, ErrorState, LinkButton, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

import { QUOTE_STATUS, type CrmQuote } from "./quotes-api";

class QuotesListError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(QuotesListError, "body");
type Row = { id: string; number: string; kind: "quotation" | "proforma"; status: CrmQuote["status"]; grandTotal: string; currencyCode: string; quoteDate: string;
  validUntil: string | null; dealId: string; dealName: string; companyName: string | null };
const FILTERS = [{ key: "", label: "All" }, { key: "draft", label: "Drafts" }, { key: "sent", label: "Sent" }, { key: "accepted", label: "Accepted" }, { key: "declined", label: "Declined" }];

export function QuotesListScreen() {
  const workspace = useWorkspaceContext();
  const [status, setStatus] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "quotes", status),
    queryFn: () => request<{ total: number; salesOn: boolean; quotes: Row[] }>(`/api/crm/quotes${status ? `?status=${status}` : ""}`),
  });
  return (
    <EnterpriseListPage
      header={{
        title: "Quotations",
        description: query.data?.salesOn ? "Quotations are made in Sales now; these are the ones made in CRM before." : "Quotations and proformas made from your deals. Open a deal to make a new one.",
        primaryAction: query.data?.salesOn ? <LinkButton variant="primary" href="/sales/quotations">Open Sales quotations</LinkButton> : undefined,
      }}
      actionBar={{ start: <span className="flex flex-wrap gap-2">{FILTERS.map((entry) => (
        <Button key={entry.key} size="compact" variant={entry.key === status ? "primary" : "ghost"} onPress={() => setStatus(entry.key)}>{entry.label}</Button>
      ))}</span> }}
    >
      {query.isLoading ? <LoadingState label="Loading quotations" rows={5} />
        : query.isError ? <ErrorState title="Quotations could not be loaded" description={query.error instanceof Error ? query.error.message : "Try again."} />
          : !query.data?.quotes.length ? <EmptyState title="No quotations yet" description="Open a deal and use New quotation or New proforma on its Quotes tab." />
            : (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                {query.data.quotes.map((quote) => (
                  <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <Link href={`/crm/quotes/${quote.id}`} className="font-medium text-brand hover:underline">{quote.kind === "proforma" ? "Proforma" : "Quotation"} {quote.number}</Link>
                      <span className="text-xs text-text-muted">
                        {[quote.companyName, quote.dealName, formatDate(quote.quoteDate), quote.validUntil ? `valid until ${formatDate(quote.validUntil)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-medium tabular-nums">{formatMoney(quote.currencyCode, Number(quote.grandTotal))}</span>
                      <StatusBadge tone={QUOTE_STATUS[quote.status].tone}>{QUOTE_STATUS[quote.status].label}</StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
    </EnterpriseListPage>
  );
}
