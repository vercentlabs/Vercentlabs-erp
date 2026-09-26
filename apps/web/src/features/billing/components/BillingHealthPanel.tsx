"use client";

import { useQuery } from "@tanstack/react-query";

import { getHealth } from "../api/billing-api";
import { formatDate } from "../billing-labels";
import { BillingNotice, BillingPanel } from "./BillingPanel";

// billing.audit only, and only shown when something needs attention.
// Technical details stay behind a disclosure.
export function BillingHealthPanel() {
  const query = useQuery({ queryKey: ["settings", "billing", "health"], queryFn: getHealth, refetchInterval: 60_000 });
  const health = query.data;
  if (!health?.needsAttention) return null;
  const at = (value: string | null) => (value ? `${formatDate(value)} ${new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "never");
  return (
    <BillingPanel title="Billing health" description="Visible to billing auditors." testId="billing-health">
      <BillingNotice tone="warning">Needs billing support attention.</BillingNotice>
      {health.subscription.reconciliationNote && <p className="text-sm text-text-secondary">{health.subscription.reconciliationNote}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-text-secondary">Technical details</summary>
        <dl className="mt-2 grid grid-cols-[12rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-text-muted">Local status</dt>
          <dd>{health.subscription.status}</dd>
          <dt className="text-text-muted">Provider status</dt>
          <dd>{health.subscription.providerStatus ?? "—"}</dd>
          <dt className="text-text-muted">Last provider sync</dt>
          <dd>{at(health.subscription.lastProviderSyncAt)}</dd>
          <dt className="text-text-muted">Last provider event</dt>
          <dd>{health.webhooks.lastEvent ? `${health.webhooks.lastEvent.type} (${health.webhooks.lastEvent.status}) ${at(health.webhooks.lastEvent.at)}` : "none"}</dd>
          <dt className="text-text-muted">Webhooks failed / dead-lettered / queued</dt>
          <dd>{`${health.webhooks.failed} / ${health.webhooks.deadLettered} / ${health.webhooks.queued}`}</dd>
          <dt className="text-text-muted">Checkout recovery</dt>
          <dd>{health.checkouts.length ? health.checkouts.map((row) => `${row.status}: ${row.count}${row.attention ? " (attention)" : ""}`).join(", ") : "none"}</dd>
          <dt className="text-text-muted">Seat operations</dt>
          <dd>{health.seatOperations.length ? health.seatOperations.map((row) => `${row.operation} → ${row.to_paid_seats} (${row.status}, ${row.attempts} attempts)`).join(", ") : "none"}</dd>
          <dt className="text-text-muted">Cancellation</dt>
          <dd>{health.subscription.cancellationState ?? "none"}</dd>
        </dl>
        {health.recentAudit.length > 0 && (
          <ul className="mt-2 text-xs text-text-muted">
            {health.recentAudit.map((event) => (
              <li key={`${event.eventType}-${event.at}`}>{`${at(event.at)} — ${event.eventType}${event.byUser ? "" : " (system)"}`}</li>
            ))}
          </ul>
        )}
      </details>
    </BillingPanel>
  );
}
