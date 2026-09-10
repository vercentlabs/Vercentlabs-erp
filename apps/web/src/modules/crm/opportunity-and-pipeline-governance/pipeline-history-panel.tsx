"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, SectionHeader, StatePanel, Surface } from "@/shared/design";

type SnapshotRow = {
  snapshot_date: string;
  stage_id: string;
  currency_code: string;
  opportunity_count: number;
  amount: string | number;
  weighted_amount: string | number;
  source: "scheduled" | "manual";
  captured_at: string;
};

type StageTotals = Record<string, { opportunityCount: number; byCurrency: Record<string, { opportunityCount: number; amount: number; weightedAmount: number }> }>;

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(value);
}

function currentTotalValue(currentTotals: StageTotals, currency: string) {
  let total = 0;
  for (const stage of Object.values(currentTotals)) {
    total += stage.byCurrency[currency]?.amount ?? 0;
  }
  return total;
}

// F010 integrity closeout: a modest historical-snapshot panel for
// authorized managers — date, pipeline (implicit, this page is already
// scoped to one), per-stage totals and a lightweight "vs current" delta.
// Deliberately not a full analytics surface: Prompt 9 (F024/F025/F030)
// still owns Forecast-grade analytics.
export default function PipelineHistoryPanel({
  pipelineId,
  stages,
  snapshots,
  currentTotals,
}: {
  pipelineId: string;
  stages: Array<{ id: string; name: string }>;
  snapshots: SnapshotRow[];
  currentTotals: StageTotals;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const stageName = useMemo(() => {
    const byId = new Map(stages.map((stage) => [stage.id, stage.name]));
    return (stageId: string) => byId.get(stageId) || "Stage";
  }, [stages]);

  const byDate = useMemo(() => {
    const grouped = new Map<string, SnapshotRow[]>();
    for (const row of snapshots) {
      const key = `${row.snapshot_date}__${row.source}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    return [...grouped.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 10);
  }, [snapshots]);

  async function captureNow() {
    setPending(true);
    setMessage("");
    const result = await requestJson("/api/crm/pipeline/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineId }),
    });
    setMessage(result.message || (result.ok ? "Snapshot captured." : "Snapshot could not be captured."));
    setPending(false);
    if (result.ok) router.refresh();
  }

  return (
    <Surface as="section" className="crm-suite-surface" aria-label="Pipeline history">
      <SectionHeader
        eyebrow="Historical pipeline baseline"
        title="Pipeline history"
        description="A daily snapshot of this pipeline's per-stage totals, captured automatically. Managers can also capture one on demand."
        actions={
          <ActionButton tone="secondary" type="button" busy={pending} disabled={pending} onClick={() => void captureNow()}>
            Capture snapshot now
          </ActionButton>
        }
      />
      {message ? <p className="notice" role="status">{message}</p> : null}
      {!byDate.length ? (
        <StatePanel title="No snapshots captured yet." description="The daily baseline runs automatically; you can also capture one immediately above." />
      ) : (
        <div className="crm-stage-summary" role="table" aria-label="Historical pipeline snapshots">
          {byDate.map(([key, rows]) => {
            const [date, source] = key.split("__");
            const byCurrency = new Map<string, { count: number; amount: number; weighted: number }>();
            for (const row of rows) {
              const entry = byCurrency.get(row.currency_code) || { count: 0, amount: 0, weighted: 0 };
              entry.count += Number(row.opportunity_count || 0);
              entry.amount += Number(row.amount || 0);
              entry.weighted += Number(row.weighted_amount || 0);
              byCurrency.set(row.currency_code, entry);
            }
            return (
              <div key={key} role="row">
                <span role="cell">
                  <strong>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(date))}</strong>
                  <small>{source === "manual" ? "Manual capture" : "Daily baseline"}</small>
                  <ul className="crm-inline-list">
                    {rows.map((row) => (
                      <li key={`${row.stage_id}-${row.currency_code}`}>
                        {stageName(row.stage_id)}: {row.opportunity_count} · {money(Number(row.amount || 0), row.currency_code)}
                      </li>
                    ))}
                  </ul>
                </span>
                <span role="cell">
                  {[...byCurrency.entries()].map(([currency, totals]) => {
                    const currentValue = currentTotalValue(currentTotals, currency);
                    const delta = currentValue - totals.amount;
                    return (
                      <div key={currency}>
                        Total: {totals.count} open · {money(totals.amount, currency)} · weighted {money(totals.weighted, currency)}
                        {source === "scheduled" ? (
                          <small>
                            {" "}vs current: {delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${money(delta, currency)}`}
                          </small>
                        ) : null}
                      </div>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Surface>
  );
}
