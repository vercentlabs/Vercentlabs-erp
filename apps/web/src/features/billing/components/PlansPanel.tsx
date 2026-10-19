"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import {
  AlertDialog,
  Button,
  NumberField,
  Radio,
  RadioGroup,
  StatusBadge,
} from "@vercentlabs/design-system";

import {
  cancelSubscription,
  changeSeats,
  startCheckout,
  type BillingPeriod,
  type Overview,
  type Plan,
} from "../api/billing-api";
import { formatDate, inr } from "../billing-labels";
import {
  CHECKOUT_MESSAGES,
  loadRazorpay,
  openRazorpay,
} from "../razorpay-checkout";
import { BillingNotice, BillingPanel } from "./BillingPanel";
import { SwitchToFreeButton } from "./TrialPanel";

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
  const trialing = Boolean(overview.subscription.trial);
  return (
    <div id="plans" className="scroll-mt-6">
      <BillingPanel
        title="Plans"
        description={trialing
          ? "Your trial includes everything in Standard. Subscribe to keep it, or move to Free (1 user, 1 app) at no charge."
          : "Free is 1 user and 1 app. Standard is every app for every user, billed monthly or yearly."}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {overview.plans.map((plan) =>
            plan.pricingModel === "per_seat" ? (
              <StandardCard
                key={plan.code}
                plan={plan}
                overview={overview}
                canCheckout={canCheckout}
                canManage={canManage}
                onResult={onResult}
              />
            ) : (
              <SimpleCard key={plan.code} plan={plan} overview={overview} canManage={canManage} onResult={onResult} />
            ),
          )}
        </div>
      </BillingPanel>
    </div>
  );
}

function CardShell({
  plan,
  overview,
  children,
}: {
  plan: Plan;
  overview: Overview;
  children: React.ReactNode;
}) {
  const trialing = Boolean(overview.subscription.trial);
  const onTrial = plan.current && trialing;
  const paidStandard = overview.subscription.hasProviderSubscription;
  const recommended = plan.pricingModel === "per_seat" && !paidStandard;
  return (
    <article
      className={`relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-card)] border bg-surface p-5 pt-6 ${plan.current || recommended ? "border-brand shadow-sm" : "border-border"}`}
      data-testid={`plan-${plan.code}`}
    >
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${plan.pricingModel === "per_seat" ? "bg-brand" : plan.contactSales ? "bg-warning" : "bg-success"}`} />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{plan.name}</h3>
        {onTrial ? <StatusBadge tone="info">On trial</StatusBadge>
          : plan.current ? <StatusBadge tone="success">Current</StatusBadge>
          : recommended ? <StatusBadge tone="info">Recommended</StatusBadge> : null}
      </div>
      {children}
      <ul className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3 text-sm text-text-secondary">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />{feature}</li>
        ))}
      </ul>
    </article>
  );
}

function SimpleCard({ plan, overview, canManage, onResult }: { plan: Plan; overview: Overview; canManage: boolean; onResult: (report: Report) => void }) {
  const offerFree = !plan.contactSales && Boolean(overview.subscription.trial) && canManage;
  return (
    <CardShell plan={plan} overview={overview}>
      {plan.contactSales ? (
        <>
          <p className="text-lg font-semibold text-text">Custom pricing</p>
          <p className="text-sm text-text-muted">{plan.description}</p>
          {plan.salesContactUrl ? (
            <a
              className="text-sm font-medium text-brand hover:underline"
              href={plan.salesContactUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Contact us
            </a>
          ) : (
            <p className="text-sm text-text-secondary">
              Contact Vercentlabs support to discuss a Custom plan.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold text-text">
            ₹0
            <span className="text-sm font-normal text-text-muted">
              {" "}
              / month
            </span>
          </p>
          <p className="text-sm text-text-muted">{plan.description}</p>
          {offerFree && <div><SwitchToFreeButton overview={overview} onResult={onResult} /></div>}
        </>
      )}
    </CardShell>
  );
}

function StandardCard({
  plan,
  overview,
  canCheckout,
  canManage,
  onResult,
}: {
  plan: Plan;
  overview: Overview;
  canCheckout: boolean;
  canManage: boolean;
  onResult: (report: Report) => void;
}) {
  const s = overview.subscription;
  const paidNow = s.hasProviderSubscription && s.pricingModel === "per_seat";
  const [period, setPeriod] = useState<BillingPeriod>(
    paidNow && s.billingPeriod === "yearly" ? "yearly" : plan.prices.monthly ? "monthly" : "yearly",
  );
  const shownPeriod: BillingPeriod = paidNow && s.billingPeriod === "yearly" ? "yearly" : paidNow ? "monthly" : period;
  const price = plan.prices[shownPeriod] ?? plan.prices.monthly ?? plan.prices.yearly;
  const included = plan.current
    ? (overview.seats.includedUsers ?? 0)
    : (plan.includedUsers ?? 0);
  const perUser = paidNow
    ? (overview.seats.perUserPricePaise ?? price?.perUserPaise ?? 0)
    : (price?.perUserPaise ?? 0);
  const currentTotal = included + overview.seats.paidSeats;
  const [users, setUsers] = useState<number>(
    paidNow ? currentTotal : Math.max(included + 1, overview.seats.used),
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const billable = Math.max(0, users - included);
  const monthly = billable * perUser;
  const gstOnTop = !plan.pricesIncludeGst;
  const gst = gstOnTop ? Math.round((monthly * plan.gstRatePercent) / 100) : 0;
  const unit = shownPeriod === "yearly" ? "year" : "month";
  const busyCheckout =
    overview.checkout &&
    ["preparing", "verifying"].includes(overview.checkout.phase);

  const checkout = useMutation({
    mutationFn: async () => {
      const session = await startCheckout(price?.priceId ?? plan.priceId, users, period);
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
      } else if (outcome.kind === "declined")
        onResult({
          tone: "warning",
          text: CHECKOUT_MESSAGES.declined(outcome.reason),
        });
      else if (outcome.kind === "unconfirmed")
        onResult({ tone: "info", text: CHECKOUT_MESSAGES.unconfirmed });
      else onResult({ tone: "info", text: CHECKOUT_MESSAGES.closed });
    },
    onError: (error) =>
      onResult({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Checkout could not be started.",
      }),
  });
  const seats = useMutation({
    mutationFn: () => changeSeats(users),
    onSuccess: (result) =>
      onResult(
        result.state === "applied" && result.effective === "now"
          ? {
              tone: "success",
              text:
                users === currentTotal
                  ? "Your scheduled reduction was cancelled."
                  : `You now have ${users} users. The payment provider charges the prorated amount for the rest of this cycle.`,
            }
          : result.state === "scheduled"
            ? {
                tone: "info",
                text: `Your users reduce to ${users} at the next renewal.`,
              }
            : {
                tone: "info",
                text:
                  result.message ??
                  "We are confirming this change with the payment provider.",
              },
      ),
    onError: (error) =>
      onResult({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "The change could not be made.",
      }),
  });
  const cancel = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: (result) => {
      setConfirmCancel(false);
      onResult(
        result.state === "scheduled"
          ? {
              tone: "info",
              text: `Your subscription ends on ${formatDate(result.endsAt ?? s.currentPeriodEndsAt)}. Nothing changes until then.`,
            }
          : {
              tone: "info",
              text: "We are confirming your cancellation with the payment provider.",
            },
      );
    },
    onError: (error) => {
      setConfirmCancel(false);
      onResult({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "The subscription could not be cancelled.",
      });
    },
  });

  const trial = s.trial;
  return (
    <CardShell plan={plan} overview={overview}>
      {!paidNow && plan.prices.monthly && plan.prices.yearly && (
        <RadioGroup label="Billing" orientation="horizontal" value={period} onChange={(value) => setPeriod(value as BillingPeriod)}>
          <Radio value="monthly">Monthly</Radio>
          <Radio value="yearly">{`Yearly (save ${Math.round((1 - plan.prices.yearly.perUserMonthlyPaise / plan.prices.monthly.perUserPaise) * 100)}%)`}</Radio>
        </RadioGroup>
      )}
      <p className="text-2xl font-semibold text-text">
        {inr(shownPeriod === "yearly" ? Math.round(perUser / 12) : perUser)}
        <span className="text-sm font-normal text-text-muted">
          {" "}
          / user / month{shownPeriod === "yearly" ? `, billed yearly (${inr(perUser)} / user / year)` : ""}
          {gstOnTop ? " + GST" : ""}
        </span>
      </p>
      {canCheckout || (paidNow && canManage) ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <NumberField
            label="Total users"
            value={users}
            onChange={(value) =>
              setUsers(Math.max(1, Math.round(Number(value) || 0)))
            }
            minValue={1}
            maxValue={500}
          />
          <p className="text-sm text-text-secondary" data-testid="price-quote">
            {users <= included
              ? `${included} user${included === 1 ? " is" : "s are"} included.`
              : `${included ? `${included} included + ` : ""}${billable} user${billable === 1 ? "" : "s"} × ${inr(perUser)} = `}
            {users > included && (
              <strong data-testid="price-total">{`${inr(monthly)} / ${unit}`}</strong>
            )}
            {users > included && gstOnTop && (
              <span className="block text-xs text-text-muted">{`+ ${plan.gstRatePercent}% GST ${inr(gst)} = ${inr(monthly + gst)} charged per ${unit}. A GST tax invoice is issued for every charge.`}</span>
            )}
          </p>
          {!overview.checkoutEnabled && (
            <BillingNotice tone="info">
              Online payment is not switched on for this workspace yet. Contact
              support to upgrade.
            </BillingNotice>
          )}
          {paidNow ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                isDisabled={
                  !canManage ||
                  !overview.checkoutEnabled ||
                  s.cancelAtCycleEnd ||
                  Boolean(overview.pendingSeatChange) ||
                  (users === currentTotal &&
                    overview.seats.pendingPaidSeats === null)
                }
                isLoading={seats.isPending}
                onPress={() => seats.mutate()}
              >
                {users === currentTotal &&
                overview.seats.pendingPaidSeats !== null
                  ? "Keep current users"
                  : "Update users"}
              </Button>
              {!s.cancelAtCycleEnd && !s.cancellationPending && (
                <Button
                  variant="secondary"
                  isDisabled={!canManage}
                  onPress={() => setConfirmCancel(true)}
                >
                  Cancel subscription
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="primary"
              isDisabled={
                !canCheckout ||
                !overview.checkoutEnabled ||
                users <= included ||
                Boolean(busyCheckout)
              }
              isLoading={checkout.isPending}
              onPress={() => checkout.mutate()}
            >
              {trial ? `Subscribe to ${plan.name}` : `Upgrade to ${plan.name}`}
            </Button>
          )}
          {trial && !paidNow && !trial.ended && (
            <p className="text-xs text-text-muted">{`Nothing is charged during your trial. Subscribing now starts the paid plan today; otherwise subscribe any time before ${formatDate(trial.endsAt)}.`}</p>
          )}
          {busyCheckout && !paidNow && (
            <p className="text-xs text-text-muted">
              A checkout is in progress. Billing updates automatically.
            </p>
          )}
        </div>
      ) : null}
      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={(open) => !open && setConfirmCancel(false)}
        title="Cancel Standard at renewal?"
        description={`Your subscription stays active until ${formatDate(s.currentPeriodEndsAt)}. After that the workspace moves to the Free plan, which includes ${
          overview.plans.find((entry) => entry.code === "free")
            ?.includedUsers ?? 1
        } user and 1 app you choose. If you have more users, you will need to remove users or subscribe again. No refund is issued for the current period.`}
        confirmLabel="Cancel at renewal"
        isConfirming={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </CardShell>
  );
}
