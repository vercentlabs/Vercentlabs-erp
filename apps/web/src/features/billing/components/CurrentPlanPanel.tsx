"use client";

import { StatusBadge } from "@vercentlabs/design-system";

import type { Overview } from "../api/billing-api";
import { formatDate, inr, stateLabel } from "../billing-labels";
import { BillingNotice, BillingPanel } from "./BillingPanel";

export function CurrentPlanPanel({ overview }: { overview: Overview }) {
  const { subscription: s, seats } = overview;
  const state = stateLabel(s.state);
  const paid = s.pricingModel === "per_seat";
  const custom = s.pricingModel === "custom";
  return (
    <BillingPanel title="Current plan">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold text-text" data-testid="current-plan-name">
          {s.planName}
        </span>
        <span data-testid="billing-state">
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-text-muted">Users</dt>
          <dd className="text-xl font-semibold tabular-nums" data-testid="seat-usage">
            {seats.used}
            {seats.capacity !== null ? ` of ${seats.capacity}` : ""}
          </dd>
          {seats.pendingInvitations > 0 && <dd className="text-xs text-text-muted">{`including ${seats.pendingInvitations} pending invitation${seats.pendingInvitations === 1 ? "" : "s"}`}</dd>}
        </div>
        <div>
          <dt className="text-xs text-text-muted">Included users</dt>
          <dd className="text-xl font-semibold tabular-nums">{seats.includedUsers ?? "Unlimited"}</dd>
        </div>
        {!custom && (
          <div>
            <dt className="text-xs text-text-muted">Monthly amount</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="monthly-amount">
              {inr(s.monthlyPaise)}
            </dd>
          </div>
        )}
        {(paid || custom) && (
          <div>
            <dt className="text-xs text-text-muted">{custom ? "Contract ends" : s.cancelAtCycleEnd ? "Ends on" : "Next renewal"}</dt>
            <dd className="text-sm font-medium">{formatDate(s.currentPeriodEndsAt)}</dd>
          </div>
        )}
      </dl>
      {state.detail && <BillingNotice tone={state.tone === "danger" ? "danger" : "info"}>{state.detail}</BillingNotice>}
      {s.legacyTerms && (
        <p className="text-xs text-text-muted">{`Your subscription keeps the terms it was bought on (${seats.includedUsers} users included). Contact support to move to current pricing.`}</p>
      )}
      {s.cancelAtCycleEnd && (
        <BillingNotice tone="warning">
          {`Your Standard subscription ends on ${formatDate(s.currentPeriodEndsAt)}. Until then nothing changes. Afterwards the workspace moves to the Free plan (${
            overview.plans.find((plan) => plan.code === "free")?.includedUsers ?? 1
          } user included); remove users or subscribe again if you need more.`}
        </BillingNotice>
      )}
      {seats.pendingPaidSeats !== null && !s.cancelAtCycleEnd && (
        <BillingNotice tone="info">{`Your users reduce to ${seats.pendingPaidSeats + (seats.includedUsers ?? 0)} at the next renewal. Until then you keep what you have paid for.`}</BillingNotice>
      )}
      {overview.pendingSeatChange && <BillingNotice tone="info">We are confirming a change to your users with the payment provider. This updates automatically.</BillingNotice>}
      {s.cancellationPending && <BillingNotice tone="info">We are confirming your cancellation with the payment provider.</BillingNotice>}
      {seats.overCapacity && (
        <BillingNotice tone="warning" testId="overage-notice">
          {`You have ${seats.used} users (including pending invitations) but your plan covers ${seats.capacity}. ${
            overview.overageGraceEndsAt ? `Add users to your plan or remove users by ${formatDate(overview.overageGraceEndsAt)}; after that business changes pause until you do.` : "Add users to your plan or remove users."
          }`}
        </BillingNotice>
      )}
      {s.state === "past_due" && (
        <BillingNotice tone="warning" testId="past-due-notice">
          {`Your last payment did not go through. The payment provider is retrying. Business changes pause after ${formatDate(s.graceEndsAt)} if it still fails; update your payment method with your bank or card issuer.`}
        </BillingNotice>
      )}
    </BillingPanel>
  );
}
