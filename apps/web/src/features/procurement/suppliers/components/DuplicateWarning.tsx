"use client";

// Suppliers or companies that already exist, shown before a new supplier is
// created. A strong match (same name, legal name or PAN) needs a reason to
// create anyway; a company that already exists as a customer or CRM account
// gets the supplier role instead of a second identity; a GSTIN that belongs
// to a supplier can only lead to that supplier.
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import type { DuplicateMatch } from "../api/suppliers-api";

export function DuplicateWarning({ matches, refused, onUseOrganization, children }: {
  matches: DuplicateMatch[];
  // The save was refused: the matches must be answered before going on.
  refused?: boolean;
  onUseOrganization?: (match: DuplicateMatch) => void;
  children?: ReactNode;
}) {
  if (!matches.length) return null;
  const strong = matches.some((match) => match.strength === "strong");
  return (
    <section aria-label="Possible existing suppliers"
      className={`flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 ${strong ? "border-warning-emphasis/40 bg-warning-soft" : "border-info-emphasis/30 bg-info-soft"}`}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text">{refused ? "This supplier may already exist" : "Possible existing supplier found"}</h2>
        <p className="text-sm text-text-secondary">
          {strong ? "Use the existing record if it is the same business. Creating another needs a reason." : "Check these before you create a new supplier."}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li key={`${match.kind}:${match.partyId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                {match.number && <span className="tabular-nums text-text-muted">{match.number}</span>}
                {match.name}
                {match.kind === "organization" && <StatusBadge tone="info">{match.isCustomer ? "Customer" : "CRM account"}</StatusBadge>}
                {match.status && match.status !== "active" && <StatusBadge tone={match.status === "blocked" ? "danger" : "neutral"}>{match.status === "blocked" ? "Blocked" : "Inactive"}</StatusBadge>}
              </span>
              <span className="text-xs text-text-secondary">
                {[match.legalName && match.legalName !== match.name ? match.legalName : null, match.gstin ? `GSTIN ${match.gstin}` : null, match.city].filter(Boolean).join(" · ")}
              </span>
              <span className="text-xs text-text-muted">{match.reasons.map((reason) => reason.label).join(" · ")}</span>
            </span>
            <span className="flex flex-wrap gap-2">
              {match.kind === "supplier" && match.supplierId && match.canOpen && (
                <>
                  <Link className="text-sm text-brand underline-offset-2 hover:underline" href={`/procurement/suppliers/${match.supplierId}`} target="_blank">View supplier</Link>
                  <Link className="text-sm font-medium text-brand underline-offset-2 hover:underline" href={`/procurement/suppliers/${match.supplierId}`}>Use existing supplier</Link>
                </>
              )}
              {match.kind === "organization" && onUseOrganization && (
                <Button size="compact" variant="secondary" onPress={() => onUseOrganization(match)}>Add as supplier</Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}
