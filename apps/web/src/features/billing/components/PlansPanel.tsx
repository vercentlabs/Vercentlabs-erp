"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertDialog, Button, NumberField, StatusBadge } from "@vercentlabs/design-system";

import { cancelSubscription, changeSeats, startCheckout, type Overview, type Plan } from "../api/billing-api";
import { formatDate, inr } from "../billing-labels";
import { CHECKOUT_MESSAGES, loadRazorpay, openRazorpay } from "../razorpay-checkout";
import { BillingNotice, BillingPanel } from "./BillingPanel";

type Report = { tone: "success" | "info" | "warning" | "danger"; text: string };

export function PlansPanel({
  overview,
  canCheckout,
  canManage,
  onResult,
}: {
  overview: Overview;
  canCheckout: boolean;
  canManage: boolean;
  onResult: (report: Report) => void;
}) {
  return (
    <BillingPanel title="Plan and users" description="The first user is free. Each additional user on Standard is billed monthly.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {overview.plans.map((plan) =>
          plan.pricingModel === "per_seat" ? (
            <StandardCard key={plan.code} plan={plan} overview={overview} canCheckout={canCheckout} canManage={canManage} onResult={onResult} />
          ) : (
            <SimpleCard key={plan.code} plan={plan} />
          ),
        )}
      </div>
    </BillingPanel>
  );
}

function CardShell({ plan, children }: { plan: Plan; children: React.ReactNode }) {
  return (
    <article className={`flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 ${plan.current ? "border-brand" : "border-border"} bg-surface`} data-testid={`plan-${plan.code}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{plan.name}</h3>
        {plan.current && <StatusBadge tone="success">Current</StatusBadge>}
      </div>
      {children}
      <ul className="flex flex-col gap-1 text-sm text-text-secondary">
        {plan.features.map((feature) => (
          <li key={feature}>• {feature}</li>
        ))}
      </ul>
    </article>
  );
}

function SimpleCard({ plan }: { plan: Plan }) {
  return (
    <CardShell plan={plan}>
      {plan.contactSales ? (
        <>
          <p className="text-lg font-semibold text-text">Custom pricing</p>
          <p className="text-sm text-text-muted">{plan.description}</p>
          {plan.salesContactUrl ? (
            <a className="text-sm font-medium text-brand hover:underline" href={plan.salesContactUrl} target="_blank" rel="noreferrer noopener">
              Contact us
            </a>
          ) : (
            <p className="text-sm text-text-secondary">Contact Vercentlabs support to discuss a Custom plan.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold text-text">
            ₹0<span className="text-sm font-normal text-text-muted"> / month</span>
          </p>
          <p className="text-sm text-text-muted">{plan.description}</p>
        </>
      )}
    </CardShell>
  );
}

function StandardCard({ plan, overview, canCheckout, canManage, onResult }: { plan: Plan; overview: Overview; canCheckout: boolean; canManage: boolean; onResult: (report: Report) => void }) {
  const s = overview.subscription;
  const included = plan.current ? overview.seats.includedUsers ?? 1 : plan.includedUsers ?? 1;
  const perUser = plan.current ? overview.seats.perUserPricePaise ?? plan.perUserPricePaise ?? 0 : plan.perUserPricePaise ?? 0;
  const paidNow = s.hasProviderSubscription && s.pricingModel === "per_seat";
  const currentTotal = included + overview.seats.paidSeats;
  const [users, setUsers] = useState<number>(paidNow ? currentTotal : Math.max(included + 1, overview.seats.used));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const billable = Math.max(0, users - included);
  const monthly = billable * perUser;
  const busyCheckout = overview.checkout && ["preparing", "verifying"].includes(overview.checkout.phase);

  const checkout = useMutation({
    mutationFn: async () => {
      const session = await startCheckout(plan.priceId, users);
      await loadRazorpay();
      return openRazorpay(session);
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "confirmed") {
        const state = outcome.result.state;
        onResult(
          state === "active"
            ? { tone: "success", text: CHECKOUT_MESSAGES.active }
            : state === "attention"
              ? { tone: "warning", text: CHECKOUT_MESSAGES.attention }
              : { tone: "info", text: CHECKOUT_MESSAGES.pending },
        );
      } else if (outcome.kind === "declined") onResult({ tone: "warning", text: CHECKOUT_MESSAGES.declined(outcome.reason) });
      else if (outcome.kind === "unconfirmed") onResult({ tone: "info", text: CHECKOUT_MESSAGES.unconfirmed });
      else onResult({ tone: "info", text: CHECKOUT_MESSAGES.closed });
    },
    onError: (error) => onResult({ tone: "danger", text: error instanceof Error ? error.message : "Checkout could not be started." }),
  });
  const seats = useMutation({
    mutationFn: () => changeSeats(users),
    onSuccess: (result) =>
      onResult(
        result.state === "applied" && result.effective === "now"
          ? { tone: "success", text: users === currentTotal ? "Your scheduled reduction was cancelled." : `You now have ${users} users. The payment provider charges the prorated amount for the rest of this cycle.` }
          : result.state === "scheduled"
            ? { tone: "info", text: `Your users reduce to ${users} at the next renewal.` }
            : { tone: "info", text: result.message ?? "We are confirming this change with the payment provider." },
      ),
    onError: (error) => onResult({ tone: "danger", text: error instanceof Error ? error.message : "The change could not be made." }),
  });
  const cancel = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: (result) => {
      setConfirmCancel(false);
      onResult(
        result.state === "scheduled"
          ? { tone: "info", text: `Your subscription ends on ${formatDate(result.endsAt ?? s.currentPeriodEndsAt)}. Nothing changes until then.` }
          : { tone: "info", text: "We are confirming your cancellation with the payment provider." },
      );
    },
    onError: (error) => {
      setConfirmCancel(false);
      onResult({ tone: "danger", text: error instanceof Error ? error.message : "The subscription could not be cancelled." });
    },
  });

  return (
    <CardShell plan={plan}>
      <p className="text-2xl font-semibold text-text">
        {inr(perUser)}
        <span className="text-sm font-normal text-text-muted"> / additional user / month</span>
      </p>
      {canCheckout || (paidNow && canManage) ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <NumberField label="Total users" value={users} onChange={(value) => setUsers(Math.max(1, Math.round(Number(value) || 0)))} minValue={1} maxValue={500} />
          <p className="text-sm text-text-secondary" data-testid="price-quote">
            {users <= included ? `${included} user${included === 1 ? " is" : "s are"} free.` : `${included} included + ${billable} additional × ${inr(perUser)} = `}
            {users > included && <strong data-testid="price-total">{`${inr(monthly)} / month`}</strong>}
          </p>
          {!overview.checkoutEnabled && <BillingNotice tone="info">Online payment is not switched on for this workspace yet. Contact support to upgrade.</BillingNotice>}
          {paidNow ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                isDisabled={!canManage || !overview.checkoutEnabled || s.cancelAtCycleEnd || Boolean(overview.pendingSeatChange) || (users === currentTotal && overview.seats.pendingPaidSeats === null)}
                isLoading={seats.isPending}
                onPress={() => seats.mutate()}
              >
                {users === currentTotal && overview.seats.pendingPaidSeats !== null ? "Keep current users" : "Update users"}
              </Button>
              {!s.cancelAtCycleEnd && !s.cancellationPending && (
                <Button variant="secondary" isDisabled={!canManage} onPress={() => setConfirmCancel(true)}>
                  Cancel subscription
                </Button>
              )}
            </div>
          ) : (
            <Button variant="primary" isDisabled={!canCheckout || !overview.checkoutEnabled || users <= included || Boolean(busyCheckout)} isLoading={checkout.isPending} onPress={() => checkout.mutate()}>
              {`Upgrade to ${plan.name}`}
            </Button>
          )}
          {busyCheckout && !paidNow && <p className="text-xs text-text-muted">A checkout is in progress. Billing updates automatically.</p>}
        </div>
      ) : null}
      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={(open) => !open && setConfirmCancel(false)}
        title="Cancel Standard at renewal?"
        description={`Your subscription stays active until ${formatDate(s.currentPeriodEndsAt)}. After that the workspace moves to the Free plan, which includes ${
          overview.plans.find((entry) => entry.code === "free")?.includedUsers ?? 1
        } user. If you have more users, you will need to remove users or subscribe again. No refund is issued for the current period.`}
        confirmLabel="Cancel at renewal"
        isConfirming={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </CardShell>
  );
}
