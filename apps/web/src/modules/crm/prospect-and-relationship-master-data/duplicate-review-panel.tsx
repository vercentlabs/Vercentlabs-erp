"use client";

// Canonical Account/Contact duplicate-review panel (F008 — CRM-VNEXT-045).
// The matching (findAccountDuplicates/findContactDuplicates) and merge
// (mergeAccountsGoverned/mergeContactsGoverned) domain logic already
// existed and was already correctly permission-gated/transactional — it
// simply had no UI anywhere in the product (confirmed by direct code
// audit during CRM vNext Prompt 3). This is that UI, deliberately mirrored
// on the shipped Lead "duplicates" tab pattern (lead-detail-workspace.tsx)
// for one consistent CRM interaction model rather than a new one.
import { useEffect, useState } from "react";
import Link from "next/link";

import { requestJson } from "@/shared/http/client-request";
import { useCrmCommandDialog } from "@/modules/crm/ui/crm-command-dialog-provider";
import { ActionButton, StatePanel } from "@/shared/design";
import MergeSurvivorshipDialog from "./merge-survivorship-dialog";

type DuplicateRow = Record<string, unknown>;

export type DuplicateReviewKind = "account" | "contact";

function str(row: DuplicateRow, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function candidateTitle(kind: DuplicateReviewKind, row: DuplicateRow) {
  if (kind === "account") return str(row, "display_name") || str(row, "code") || "Existing account";
  const name = [str(row, "first_name"), str(row, "last_name")].filter(Boolean).join(" ");
  return name || str(row, "email") || "Existing contact";
}

function candidateSubtitle(kind: DuplicateReviewKind, row: DuplicateRow) {
  if (kind === "account") {
    const parts = [str(row, "legal_name"), str(row, "party_type"), str(row, "status")].filter(Boolean);
    return parts.join(" · ");
  }
  const parts = [str(row, "designation"), str(row, "account_name") || "No company", str(row, "email") || str(row, "mobile")].filter(Boolean);
  return parts.join(" · ");
}

const SIGNAL_LABELS: Record<string, string> = {
  gstin: "GSTIN",
  pan: "PAN",
  legal_name: "company name",
  legal_name_similarity: "similar company name",
  email: "email",
  mobile: "mobile",
  name: "name",
  name_similarity: "similar name",
};

function matchedSignals(row: DuplicateRow) {
  const score = Number(row.match_score || 0);
  const raw = Array.isArray(row.matched_signals) ? (row.matched_signals as string[]) : [];
  const signals = raw.map((signal) => SIGNAL_LABELS[signal] || signal);
  return { score, signals, classification: str(row, "classification") || "probable" };
}

export default function DuplicateReviewPanel({
  kind,
  currentId,
  searchParams,
  canMerge,
  onMerged,
}: {
  kind: DuplicateReviewKind;
  currentId: string;
  /** Fields used to search for candidates — name/gstin/pan for accounts, email/mobile/firstName/lastName for contacts. */
  searchParams: Record<string, string | undefined>;
  canMerge: boolean;
  onMerged?: () => void;
}) {
  const [duplicates, setDuplicates] = useState<DuplicateRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const { prompt: promptAction } = useCrmCommandDialog();
  const [message, setMessage] = useState("");
  const [mergingSurvivorId, setMergingSurvivorId] = useState("");

  const duplicatesEndpoint = kind === "account" ? "/api/crm/accounts/duplicates" : "/api/crm/contacts/duplicates";
  const dismissEndpoint = kind === "account" ? `/api/crm/accounts/${currentId}/duplicates/dismiss` : `/api/crm/contacts/${currentId}/duplicates/dismiss`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(searchParams)) {
        if (value) query.set(key, value);
      }
      query.set("excludeId", currentId);
      const result = await requestJson<{ duplicates?: DuplicateRow[] }>(
        `${duplicatesEndpoint}?${query.toString()}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Duplicate candidates could not be loaded.");
        setDuplicates([]);
        return;
      }
      setDuplicates(Array.isArray(result.duplicates) ? result.duplicates : []);
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, kind, JSON.stringify(searchParams)]);

  async function dismiss(candidateId: string) {
    const reason = await promptAction({
      title: "Dismiss duplicate match",
      description: "Explain why these records are not duplicates. This reason is kept as permanent evidence.",
      label: "Reason",
      placeholder: "Enter at least 10 characters…",
      confirmLabel: "Dismiss match",
    });
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setMessage("Enter at least 10 characters explaining why this is not a duplicate.");
      return;
    }
    setPendingId(candidateId);
    setMessage("");
    const result = await requestJson<{ message?: string }>(dismissEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchedIds: [candidateId], reason: reason.trim() }),
    });
    setPendingId("");
    if (!result.ok) {
      setMessage(result.message || "Could not mark this as not a duplicate.");
      return;
    }
    setDuplicates((current) => (current || []).filter((row) => str(row, "id") !== candidateId));
    setMessage("Marked as not a duplicate.");
  }

  if (duplicates === null) {
    return <StatePanel title="Checking for duplicate candidates…" />;
  }
  if (loadError) {
    return <StatePanel title="Duplicate candidates could not be loaded." description={loadError} />;
  }

  return (
    <div className="crm-duplicate-compare">
      {message ? <p role="status">{message}</p> : null}
      {duplicates.map((row, index) => {
        const id = str(row, "id");
        const { classification, signals } = matchedSignals(row);
        return (
          <article key={id || `duplicate-${index}`}>
            <div>
              <strong>{candidateTitle(kind, row)}</strong>
              <small>{candidateSubtitle(kind, row)}</small>
              <span>
                {classification === "exact" ? "Likely duplicate" : "Possible duplicate"}
                {signals.length ? ` · matched on ${signals.join(", ")}` : ""}
              </span>
            </div>
            {id ? (
              <Link href={kind === "account" ? `/crm/accounts/${id}` : `/crm/contacts/${id}`}>Open</Link>
            ) : null}
            {canMerge && id ? (
              <ActionButton tone="danger" onClick={() => setMergingSurvivorId(id)}>
                Merge current into this
              </ActionButton>
            ) : null}
            {canMerge && id ? (
              <ActionButton tone="quiet" busy={pendingId === id} onClick={() => void dismiss(id)}>
                Not a duplicate
              </ActionButton>
            ) : null}
          </article>
        );
      })}
      {!duplicates.length ? <StatePanel title="No likely duplicate found." /> : null}
      {mergingSurvivorId ? (
        <MergeSurvivorshipDialog
          kind={kind}
          sourceId={currentId}
          survivorId={mergingSurvivorId}
          onClose={() => setMergingSurvivorId("")}
          onMerged={() => {
            setMergingSurvivorId("");
            onMerged?.();
          }}
        />
      ) : null}
    </div>
  );
}
