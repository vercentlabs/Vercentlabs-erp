"use client";

import { useEffect, useState } from "react";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, Dialog, EnterpriseDataGrid, StatePanel } from "@/shared/design";
import type { DuplicateReviewKind } from "./duplicate-review-panel";

type FieldComparison = {
  field: string;
  sourceValue: unknown;
  survivorValue: unknown;
  conflict: boolean;
  sensitive: boolean;
  selectable: boolean;
};
type Comparison = {
  source: Record<string, unknown>;
  survivor: Record<string, unknown>;
  fieldComparison: FieldComparison[];
};

const FIELD_LABELS: Record<string, string> = {
  display_name: "Name",
  legal_name: "Legal name",
  industry: "Industry",
  website: "Website",
  phone: "Phone",
  email: "Email",
  currency_code: "Currency",
  gstin: "GSTIN",
  pan: "PAN",
  msme_number: "MSME registration",
  first_name: "First name",
  last_name: "Last name",
  designation: "Job title",
  mobile: "Mobile",
  preferred_language: "Preferred language",
  timezone: "Time zone",
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function candidateName(kind: DuplicateReviewKind, record: Record<string, unknown>) {
  if (kind === "account") return String(record.display_name || record.code || "Account");
  return [record.first_name, record.last_name].filter(Boolean).join(" ") || String(record.email || "Contact");
}

export default function MergeSurvivorshipDialog({
  kind,
  sourceId,
  survivorId,
  onClose,
  onMerged,
}: {
  kind: DuplicateReviewKind;
  sourceId: string;
  survivorId: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selections, setSelections] = useState<Record<string, "source" | "survivor">>({});
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);

  const compareEndpoint = kind === "account" ? `/api/crm/accounts/${sourceId}/merge` : `/api/crm/contacts/${sourceId}/merge`;
  const mergeEndpoint = compareEndpoint;

  async function loadComparison() {
    setComparison(null);
    setLoadError("");
    setStale(false);
    const result = await requestJson<{ comparison?: Comparison }>(
      `${compareEndpoint}?survivorId=${encodeURIComponent(survivorId)}`,
    );
    if (!result.ok) {
      setLoadError(result.message || "The merge comparison could not be loaded.");
      return;
    }
    if (result.comparison) {
      setComparison(result.comparison);
      setSelections({});
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<{ comparison?: Comparison }>(
        `${compareEndpoint}?survivorId=${encodeURIComponent(survivorId)}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "The merge comparison could not be loaded.");
        return;
      }
      if (result.comparison) {
        setComparison(result.comparison);
        setSelections({});
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, survivorId]);

  async function confirmMerge() {
    if (!comparison) return;
    setPending(true);
    setMessage("");
    setStale(false);
    const result = await requestJson<{ message?: string; code?: string }>(mergeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        survivorId,
        reason: reason.trim() || "Merged from the duplicate review panel with reviewed survivorship.",
        fieldSelections: selections,
        expectedSourceUpdatedAt: comparison.source.updated_at,
        expectedSurvivorUpdatedAt: comparison.survivor.updated_at,
      }),
    });
    setPending(false);
    if (!result.ok) {
      if (result.code === "CRM_MERGE_COMPARISON_STALE") {
        setStale(true);
        setMessage(result.message || "This record changed while you were reviewing the merge. Refresh the comparison before continuing.");
        return;
      }
      setMessage(result.message || "The records could not be merged.");
      return;
    }
    onMerged();
  }

  return (
    <Dialog onClose={onClose} title="Compare and merge" canDismiss={!pending}>
      {loadError ? (
        <StatePanel title="Merge comparison could not be loaded." description={loadError} />
      ) : !comparison ? (
        <StatePanel title="Loading comparison…" />
      ) : (
        <div className="crm-merge-survivorship">
          <p>
            Merging <strong>{candidateName(kind, comparison.source)}</strong> into{" "}
            <strong>{candidateName(kind, comparison.survivor)}</strong>. The record on the left will be archived; its
            history is preserved but this action cannot be undone from the product.
          </p>
          {message ? (
            <div className="notice error" role="alert">
              {message}
              {stale ? (
                <ActionButton tone="quiet" onClick={() => void loadComparison()}>
                  Refresh comparison
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          <EnterpriseDataGrid<FieldComparison>
            rows={comparison.fieldComparison}
            rowKey={(row) => row.field}
            caption="Field-by-field merge comparison"
            emptyState={<StatePanel title="No conflicting or comparable fields — the survivor's existing values will be kept." />}
            columns={[
              { id: "field", header: "Field", cell: (row) => FIELD_LABELS[row.field] || row.field },
              { id: "source", header: "Losing record", cell: (row) => displayValue(row.sourceValue) },
              { id: "survivor", header: "Surviving record", cell: (row) => displayValue(row.survivorValue) },
              {
                id: "keep",
                header: "Keep",
                cell: (row) => {
                  if (!row.conflict) return "Survivor (no conflict)";
                  const current = selections[row.field] || "survivor";
                  return (
                    <fieldset>
                      <legend className="visually-hidden">Keep value for {FIELD_LABELS[row.field] || row.field}</legend>
                      <label>
                        <input
                          type="radio"
                          name={`keep-${row.field}`}
                          checked={current === "survivor"}
                          onChange={() => setSelections((prev) => ({ ...prev, [row.field]: "survivor" }))}
                        />
                        Survivor
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`keep-${row.field}`}
                          checked={current === "source"}
                          onChange={() => setSelections((prev) => ({ ...prev, [row.field]: "source" }))}
                        />
                        Losing record
                      </label>
                    </fieldset>
                  );
                },
              },
            ]}
          />
          <label>
            <span>Merge reason (optional)</span>
            <textarea rows={2} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
          </label>
          <footer className="crm-merge-survivorship-actions">
            <ActionButton onClick={onClose} disabled={pending}>
              Cancel
            </ActionButton>
            <ActionButton tone="danger" busy={pending} onClick={() => void confirmMerge()}>
              Confirm merge
            </ActionButton>
          </footer>
        </div>
      )}
    </Dialog>
  );
}
