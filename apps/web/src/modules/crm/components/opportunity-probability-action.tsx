"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";

type Props = {
  id: string;
  probability: number;
  amount: number;
  expectedRevenue: number;
  currencyCode: string;
  updatedAt: string;
  stageProbability: number | null;
};

function money(value: number, currencyCode: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode || "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function CrmOpportunityProbabilityAction({
  id,
  probability,
  amount,
  expectedRevenue,
  currencyCode,
  updatedAt,
  stageProbability,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(String(probability));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 && Math.abs(parsed * 100 - Math.round(parsed * 100)) < 1e-8;
  const unchanged = valid && parsed === probability;
  const preview = valid ? Math.round(amount * parsed) / 100 : expectedRevenue;

  async function save() {
    if (!valid || unchanged || pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson(`/api/crm/opportunities/${id}/probability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          probability: parsed,
          note: note.trim() || null,
          expectedUpdatedAt: updatedAt,
          expectedProbability: probability,
        }),
      });
      if (!result.ok) throw new Error(result.message || "Probability could not be updated.");
      setMessage(result.message || "Probability updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Probability could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="crm-action-panel crm-opportunity-probability-action" aria-label="Opportunity probability action">
      <div className="crm-action-panel__heading">
        <div>
          <p className="eyebrow">Revenue probability</p>
          <h2>Expected revenue</h2>
        </div>
        <span className="status-badge neutral">{money(preview, currencyCode)}</span>
      </div>
      <div className="crm-opportunity-stage-action__fields">
        <label>
          Probability %
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            value={value}
            disabled={pending}
            onChange={(event) => { setValue(event.target.value); setMessage(""); }}
          />
        </label>
        <label className="crm-opportunity-stage-action__note">
          Change note
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            disabled={pending}
            placeholder="Optional context for this probability change…"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <div className="form-row">
        <button className="primary-button" type="button" disabled={pending || !valid || unchanged} onClick={() => void save()}>
          {pending ? "Updating…" : "Update probability"}
        </button>
      </div>
      {!valid ? <p className="field-help">Enter a probability from 0 to 100 with at most two decimal places.</p> : (
        <p className="field-help">
          Expected revenue is calculated automatically as amount × probability.
          {stageProbability == null ? "" : ` Current stage default: ${stageProbability}%.`}
          {" "}A later stage move adopts the destination stage&apos;s configured probability.
        </p>
      )}
      {message ? <p className="notice" role="status">{message}</p> : null}
    </section>
  );
}
