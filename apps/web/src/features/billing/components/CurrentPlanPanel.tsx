"use client";

import type { ReactNode } from "react";
import { CalendarClock, Gem, IndianRupee, Users } from "lucide-react";
import { StatusBadge } from "@vercentlabs/design-system";

import type { Overview } from "../api/billing-api";
import { formatDate, inr, stateLabel } from "../billing-labels";
import { BillingNotice } from "./BillingPanel";

export function CurrentPlanPanel({ overview }: { overview: Overview }) {
  const { subscription: s, seats } = overview;
  const state = stateLabel(s.state);
  const paid = s.pricingModel === "per_seat";
  const custom = s.pricingModel === "custom";
  return (
    <section aria-label="Current plan" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand"><Gem className="size-5" aria-hidden="true" /></span>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Current plan</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-text" data-testid="current-plan-name">{s.planName}</span>
              <span data-testid="billing-state"><StatusBadge tone={state.tone}>{state.label}</StatusBadge></span>
            </span>
          </div>
        </div>
        {s.planCode === "free" && <a href="#plans" className="text-sm font-semibold text-brand hover:underline">Compare plans →</a>}
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PlanFact tone="brand" icon={<Users className="size-4" aria-hidden="true" />} label="Users">
          <span className="text-xl font-semibold tabular-nums" data-testid="seat-usage">
            {seats.used}{seats.capacity !== null ? ` of ${seats.capacity}` : ""}
          </span>
          <span className="text-xs text-text-muted">
            {seats.pendingInvitations > 0
              ? `including ${seats.pendingInvitations} pending invitation${seats.pendingInvitations === 1 ? "" : "s"}`
              : seats.includedUsers === null ? "No user limit" : `${seats.includedUsers} included${seats.paidSeats ? ` + ${seats.paidSeats} paid` : ""}`}
          </span>
        </PlanFact>
        {!custom && (
          <PlanFact tone="success" icon={<IndianRupee className="size-4" aria-hidden="true" />} label={s.billingPeriod === "yearly" ? "Yearly amount" : "Monthly amount"}>
            <span className="text-xl font-semibold tabular-nums" data-testid="monthly-amount">{inr(s.monthlyPaise)}</span>
            <span className="text-xs text-text-muted">before GST</span>
          </PlanFact>
        )}
        <PlanFact tone="info" icon={<CalendarClock className="size-4" aria-hidden="true" />} label={custom ? "Contract ends" : s.cancelAtCycleEnd ? "Ends on" : paid ? "Next renewal" : "Renewal"}>
          <span className="text-base font-semibold">{paid || custom ? formatDate(s.currentPeriodEndsAt) : "None"}</span>
          <span className="text-xs text-text-muted">{paid || custom ? (s.billingPeriod === "yearly" ? "Billed yearly" : "Billed monthly") : "Free has no charges"}</span>
        </PlanFact>
      </dl>
      {state.detail && (
        <BillingNotice tone={state.tone === "danger" ? "danger" : "info"}>
          {state.detail}
        </BillingNotice>
      )}
      {s.legacyTerms && (
        <p className="text-xs text-text-muted">{`Your subscription keeps the terms it was bought on (${seats.includedUsers} users included). Contact support to move to current pricing.`}</p>
      )}
      {s.cancelAtCycleEnd && (
        <BillingNotice tone="warning">
          {`Your Standard subscription ends on ${formatDate(s.currentPeriodEndsAt)}. Until then nothing changes. Afterwards the workspace moves to the Free plan (${
            overview.plans.find((plan) => plan.code === "free")
              ?.includedUsers ?? 1
          } user included); remove users or subscribe again if you need more.`}
        </BillingNotice>
      )}
      {seats.pendingPaidSeats !== null && !s.cancelAtCycleEnd && (
        <BillingNotice tone="info">{`Your users reduce to ${seats.pendingPaidSeats + (seats.includedUsers ?? 0)} at the next renewal. Until then you keep what you have paid for.`}</BillingNotice>
      )}
      {overview.pendingSeatChange && (
        <BillingNotice tone="info">
          We are confirming a change to your users with the payment provider.
          This updates automatically.
        </BillingNotice>
      )}
      {s.cancellationPending && (
        <BillingNotice tone="info">
          We are confirming your cancellation with the payment provider.
        </BillingNotice>
      )}
      {seats.overCapacity && (
        <BillingNotice tone="warning" testId="overage-notice">
          {`You have ${seats.used} users (including pending invitations) but your plan covers ${seats.capacity}. ${
            overview.overageGraceEndsAt
              ? `Add users to your plan or remove users by ${formatDate(overview.overageGraceEndsAt)}; after that business changes pause until you do.`
              : "Add users to your plan or remove users."
          }`}
        </BillingNotice>
      )}
      {s.state === "past_due" && (
        <BillingNotice tone="warning" testId="past-due-notice">
          {`Your last payment did not go through. The payment provider is retrying. Business changes pause after ${formatDate(s.graceEndsAt)} if it still fails; update your payment method with your bank or card issuer.`}
        </BillingNotice>
      )}
    </section>
  );
}

const FACT_TONES = { brand: "bg-brand-soft text-brand", success: "bg-success-soft text-success", info: "bg-info-soft text-info" };

function PlanFact({ tone, icon, label, children }: { tone: keyof typeof FACT_TONES; icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-3">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${FACT_TONES[tone]}`}>{icon}</span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-text-muted">{label}</dt>
        <dd className="flex flex-col">{children}</dd>
      </div>
    </div>
  );
}
