import Link from "next/link";
import { Badge } from "@vercentlabs/design-system";

import type { AccountDuplicateMatch } from "../api/accounts-api";
import { TYPE_LABELS } from "../account-format";

const SIGNAL_LABELS: Record<string, string> = {
  website: "same website",
  gstin: "same GSTIN",
  name: "same company name",
  similar_name: "similar name",
  name_city: "similar name in the same city",
  name_phone: "similar name and same phone",
  name_email_domain: "similar name and same email domain",
};

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
            <Badge tone={match.strength === "exact" ? "warning" : "neutral"}>{match.strength === "exact" ? "Match" : "Possible"}</Badge>
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
            <span className="text-xs text-text-muted">({match.signals.map((signal) => SIGNAL_LABELS[signal] ?? signal).join(", ")})</span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
