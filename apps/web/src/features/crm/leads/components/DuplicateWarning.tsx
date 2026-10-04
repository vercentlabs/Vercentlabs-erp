import Link from "next/link";
import { Badge } from "@vercentlabs/design-system";

import { MatchReasons, MatchStateBadge, MatchStrengthBadge } from "@/features/crm/duplicates/DuplicateParts";

import type { LeadDuplicateMatch } from "../api/leads-api";
import { STATUS_LABELS } from "../lead-format";

const KIND = { lead: { label: "Lead", path: "leads" }, contact: { label: "Contact", path: "contacts" }, account: { label: "Account", path: "accounts" } } as const;

function matchHref(match: LeadDuplicateMatch) {
  return `/crm/${KIND[match.kind].path}/${match.id}`;
}

// Existing leads, contacts and accounts that look like the lead being saved,
// each with the reason it matched. A match the user is not allowed to open is
// named without its details.
export function DuplicateWarning({ matches, blocking, children }: { matches: LeadDuplicateMatch[]; blocking: boolean; children?: React.ReactNode }) {
  if (!matches.length) return null;
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm ${blocking ? "border-warning-emphasis/40 bg-warning-soft" : "border-border bg-surface-muted"}`}>
      <p className="font-medium">
        {blocking ? "This looks like a duplicate of a record you already have." : "Similar records already exist. Check that this is a different person, and use the existing account if the company is already there."}
      </p>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li key={`${match.kind}-${match.id}`} className="flex flex-wrap items-center gap-2">
            <Badge tone={match.kind === "lead" ? "info" : "brand"}>{KIND[match.kind].label}</Badge>
            <MatchStrengthBadge match={match} />
            {match.canOpen ? (
              <Link href={matchHref(match)} target="_blank" className="font-medium text-brand underline-offset-2 hover:underline">
                {match.name || match.companyName || match.code || "Open record"}
              </Link>
            ) : (
              <span className="text-text-secondary">A record you do not have access to</span>
            )}
            {match.canOpen && (
              <span className="text-text-secondary">
                {[match.code, match.companyName, match.email, match.phone, match.status ? STATUS_LABELS[match.status] : null, match.ownerName ? `Owner: ${match.ownerName}` : null]
                  .filter(Boolean).join(" · ")}
              </span>
            )}
            <MatchStateBadge match={match} />
            <span className="basis-full"><MatchReasons match={match} /></span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
