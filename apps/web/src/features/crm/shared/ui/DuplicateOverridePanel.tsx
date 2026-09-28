"use client";

import Link from "next/link";
import { TextArea } from "@vercentlabs/design-system";

// The server refuses to create an exact duplicate (Lead, Account, Contact)
// and returns the matches the caller may see. This panel shows them and, when
// the caller may create the record anyway, collects the reason the server
// records with it (at least 10 characters). A match the caller cannot open is
// only counted, never described.
export type DuplicateOverrideMatch =
  | { restricted: true }
  | {
      restricted?: false;
      id: string;
      label: string;
      href: string;
      detail?: string;
    };

export const DUPLICATE_OVERRIDE_REASON_MIN = 10;

export function DuplicateOverridePanel({
  noun,
  matches,
  canOverride,
  reason,
  onReasonChange,
}: {
  noun: string;
  matches: DuplicateOverrideMatch[];
  canOverride: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  const visible = matches.filter(
    (match): match is Extract<DuplicateOverrideMatch, { restricted?: false }> =>
      !match.restricted,
  );
  const hidden = matches.length - visible.length;
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-3"
    >
      <p className="text-sm font-semibold text-text">
        {`This ${noun} looks like one that already exists`}
      </p>
      {visible.length > 0 && (
        <ul
          className="flex flex-col gap-1 text-sm"
          aria-label={`Existing ${noun}s`}
        >
          {visible.map((match) => (
            <li key={match.id}>
              <Link
                href={match.href}
                className="font-medium text-brand hover:underline"
              >
                {match.label}
              </Link>
              {match.detail && (
                <span className="text-text-secondary">{` · ${match.detail}`}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="text-sm text-text-secondary">
          {`${hidden} matching ${noun}${hidden === 1 ? "" : "s"} you can't open ${hidden === 1 ? "also exists" : "also exist"}.`}
        </p>
      )}
      {canOverride ? (
        <TextArea
          label="Why create this anyway?"
          description={`At least ${DUPLICATE_OVERRIDE_REASON_MIN} characters. It is recorded with the new ${noun}.`}
          value={reason}
          onChange={onReasonChange}
        />
      ) : (
        <p className="text-sm text-text-secondary">
          {`Open the existing ${noun} instead. Only a data-quality administrator can create an exact duplicate.`}
        </p>
      )}
    </div>
  );
}

// The labels of the fields that matched, in plain words.
const SIGNAL_LABELS: Record<string, string> = {
  email: "same email",
  mobile: "same mobile",
  phone: "same phone",
  business_phone: "same phone",
  name: "same name",
  company: "same company",
  legal_name: "same legal name",
  display_name: "same name",
  gstin: "same GSTIN",
  pan: "same PAN",
};

export function matchedSignalsText(signals: unknown): string | undefined {
  if (!Array.isArray(signals) || !signals.length) return undefined;
  const labels = [
    ...new Set(
      signals.map(
        (signal) =>
          SIGNAL_LABELS[String(signal)] ?? String(signal).replace(/_/g, " "),
      ),
    ),
  ];
  return labels.join(", ");
}
