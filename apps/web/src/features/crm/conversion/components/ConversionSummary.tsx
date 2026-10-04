"use client";

import Link from "next/link";

import { formatDateTime, formatMoney } from "@/shared/format/human";
import type { Lead } from "@/features/crm/leads/api/leads-api";

// Shown at the top of a converted lead: the account, contact and opportunity
// it became, who converted it and when. The lead itself stays read-only.
export function ConversionSummary({ lead }: { lead: Lead }) {
  const opportunity = [
    [lead.convertedOpportunityCode, lead.convertedOpportunityName].filter(Boolean).join(" "),
    lead.convertedOpportunityAmount ? formatMoney(lead.currencyCode ?? undefined, lead.convertedOpportunityAmount) : null,
  ].filter(Boolean).join(" — ");
  const links = [
    lead.convertedPartyId && { label: "Account", name: lead.convertedAccountName, href: `/crm/accounts/${lead.convertedPartyId}` },
    lead.convertedContactId && { label: "Contact", name: lead.convertedContactName, href: `/crm/contacts/${lead.convertedContactId}` },
    lead.convertedOpportunityId && { label: "Opportunity", name: opportunity, href: `/crm/opportunities/${lead.convertedOpportunityId}` },
  ].filter((entry): entry is { label: string; name: string | null; href: string } => Boolean(entry));
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-success/40 bg-success-soft p-4" aria-label="Conversion">
      <div>
        <h2 className="text-base font-semibold">Converted</h2>
        <p className="text-sm text-text-secondary">This lead is kept as a read-only record. Continue the work on the opportunity.</p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <div key={link.href} className="flex flex-col">
            <dt className="text-text-secondary">{link.label}</dt>
            <dd><Link className="font-medium text-brand hover:underline" href={link.href}>{link.name || `Open ${link.label.toLowerCase()}`}</Link></dd>
          </div>
        ))}
        <div className="flex flex-col"><dt className="text-text-secondary">Converted by</dt><dd className="font-medium">{lead.convertedByName ?? "Unknown"}</dd></div>
        <div className="flex flex-col"><dt className="text-text-secondary">Converted at</dt><dd className="font-medium">{formatDateTime(lead.convertedAt)}</dd></div>
      </dl>
    </section>
  );
}
