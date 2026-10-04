import Link from "next/link";

import { MatchReasons, MatchStateBadge, MatchStrengthBadge } from "@/features/crm/duplicates/DuplicateParts";

import type { ContactDuplicateMatch } from "../api/contacts-api";

// Existing contacts that look like the person being saved. A match the user
// is not allowed to open is named without its details.
export function ContactDuplicateWarning({ matches, blocking, children }: { matches: ContactDuplicateMatch[]; blocking: boolean; children?: React.ReactNode }) {
  if (!matches.length) return null;
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm ${blocking ? "border-warning-emphasis/40 bg-warning-soft" : "border-border bg-surface-muted"}`}>
      <p className="font-medium">
        {blocking ? "This person already exists as a contact." : "Similar contacts already exist. Check that this is a different person."}
      </p>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center gap-2">
            <MatchStrengthBadge match={match} />
            {match.canOpen ? (
              <Link href={`/crm/contacts/${match.id}`} target="_blank" className="font-medium text-brand underline-offset-2 hover:underline">
                {match.name || match.code || "Open contact"}
              </Link>
            ) : (
              <span className="text-text-secondary">A contact you do not have access to</span>
            )}
            {match.canOpen && (
              <span className="text-text-secondary">
                {[match.code, match.jobTitle, match.accountName, match.email, match.mobile, match.ownerName ? `Owner: ${match.ownerName}` : null].filter(Boolean).join(" · ")}
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
