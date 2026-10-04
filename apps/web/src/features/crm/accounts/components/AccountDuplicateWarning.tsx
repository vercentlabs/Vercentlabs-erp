import Link from "next/link";

import { MatchReasons, MatchStateBadge, MatchStrengthBadge } from "@/features/crm/duplicates/DuplicateParts";

import type { AccountDuplicateMatch } from "../api/accounts-api";
import { TYPE_LABELS } from "../account-format";

// Existing accounts that look like the one being saved. A match the user is
// not allowed to open is named without its details.
export function AccountDuplicateWarning({ matches, blocking, children }: { matches: AccountDuplicateMatch[]; blocking: boolean; children?: React.ReactNode }) {
  if (!matches.length) return null;
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm ${blocking ? "border-warning-emphasis/40 bg-warning-soft" : "border-border bg-surface-muted"}`}>
      <p className="font-medium">
        {blocking ? "This company already exists as an account." : "Similar accounts already exist. Check that this is a different company."}
      </p>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center gap-2">
            <MatchStrengthBadge match={match} />
            {match.canOpen ? (
              <Link href={`/crm/accounts/${match.id}`} target="_blank" className="font-medium text-brand underline-offset-2 hover:underline">
                {match.name || match.code || "Open account"}
              </Link>
            ) : (
              <span className="text-text-secondary">An account you do not have access to</span>
            )}
            {match.canOpen && (
              <span className="text-text-secondary">
                {[match.code, match.accountType ? TYPE_LABELS[match.accountType] : null, match.city, match.website, match.ownerName ? `Owner: ${match.ownerName}` : null]
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
