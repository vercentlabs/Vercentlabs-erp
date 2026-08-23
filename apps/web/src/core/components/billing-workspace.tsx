"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import type { BillingPlanPrice, BillingSummary } from "@vercentlabs/shared-types";

import AppIcon from "@/shared/components/app-icon";

// The two usage dimensions this workspace actually meters today
// (confirmed by direct code inspection of incrementBillingUsage() call
// sites — see docs/implementation/ERP_GOVERNANCE_009.md Section 3). Every
// other BillingUsageMetric (storage_bytes, automation_actions_monthly,
// outbound_messages_monthly) is defined in the type/limits but never
// incremented anywhere, so it is deliberately NOT shown here — Part 5
// forbids fabricating a comprehensive usage dashboard out of unmeasured
// dimensions.
const METERED_USAGE_DIMENSIONS: Array<{ key: string; label: string; limitKey?: keyof BillingSummary["limits"] }> = [
  { key: "api_requests_monthly", label: "API requests this month", limitKey: "api_requests_monthly" },
  { key: "imports_rows_monthly", label: "Import rows this month" },
];

type PaymentRow = {
  provider_payment_id: string;
  amount_paise: string | number;
  currency: string;
  status: string;
  method: string | null;
  captured_at: string | null;
  created_at: string;
};

type InvoiceRow = {
  provider_invoice_id: string;
  amount_paise: string | number;
  amount_due_paise: string | number;
  amount_paid_paise: string | number;
  currency: string;
  status: string;
  invoice_url: string | null;
  issued_at: string | null;
  paid_at: string | null;
};

type BillingProfile = {
  legal_name?: string;
  billing_email?: string;
  phone?: string;
  gstin?: string;
  billing_address?: {
    line1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
} | null;

type CheckoutResponse = {
  ok: boolean;
  message?: string;
  checkoutSessionId: string;
  keyId: string;
  providerSubscriptionId: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact?: string };
};

type RazorpayResult = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => {
  open(): void;
  on(
    event: string,
    callback: (response: { error?: { description?: string } }) => void,
  ): void;
};

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

function money(amountPaise: string | number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amountPaise || 0) / 100);
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

async function jsonRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload.message || "The billing request failed."));
  }
  return payload;
}

async function loadRazorpay() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Razorpay Checkout could not load.")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Razorpay Checkout could not load."));
    document.head.appendChild(script);
  });
}

export default function BillingWorkspace({
  plans,
  summary,
  payments,
  invoices,
  profile,
  canManage,
  canCheckout,
}: {
  plans: BillingPlanPrice[];
  summary: BillingSummary;
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  profile: BillingProfile;
  canManage: boolean;
  canCheckout: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<"monthly" | "yearly">("yearly");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const visiblePlans = useMemo(
    () => plans.filter((plan) => plan.billingPeriod === period),
    [period, plans],
  );

  async function beginCheckout(plan: BillingPlanPrice) {
    setPending(plan.id);
    setMessage("Preparing secure Razorpay Checkout…");
    try {
      await loadRazorpay();
      const checkout = (await jsonRequest("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planPriceId: plan.id }),
      })) as unknown as CheckoutResponse;
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const instance = new Razorpay({
        key: checkout.keyId,
        subscription_id: checkout.providerSubscriptionId,
        name: checkout.name,
        description: checkout.description,
        prefill: checkout.prefill,
        theme: { color: "#4f46e5" },
        modal: {
          ondismiss: () => {
            setPending("");
            setMessage("Checkout closed. No plan change was activated.");
          },
        },
        handler: async (result: RazorpayResult) => {
          try {
            await jsonRequest("/api/billing/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                checkoutSessionId: checkout.checkoutSessionId,
                ...result,
              }),
            });
            setMessage(
              "Payment authorisation verified. Subscription activation will be confirmed by webhook.",
            );
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Payment verification could not be completed.",
            );
          } finally {
            setPending("");
          }
        },
      });
      instance.on("payment.failed", (response) => {
        setPending("");
        setMessage(
          response.error?.description || "Payment authorisation failed.",
        );
      });
      instance.open();
    } catch (error) {
      setPending("");
      setMessage(
        error instanceof Error ? error.message : "Checkout could not start.",
      );
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("profile");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = Object.fromEntries(form.entries());
      const result = await jsonRequest("/api/billing/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMessage(String(result.message || "Billing profile updated."));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Billing profile could not be updated.",
      );
    } finally {
      setPending("");
    }
  }

  async function cancel() {
    if (
      !window.confirm(
        "Schedule cancellation at the end of the current billing cycle?",
      )
    )
      return;
    setPending("cancel");
    try {
      const result = await jsonRequest("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAtCycleEnd: true }),
      });
      setMessage(String(result.message || "Cancellation scheduled."));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Cancellation could not be scheduled.",
      );
    } finally {
      setPending("");
    }
  }

  return (
    <div className="billing-stack">
      <section className="billing-overview-grid">
        <article className="panel billing-current-card">
          <p className="eyebrow">Current subscription</p>
          <div className="billing-current-title">
            <div>
              <h2>{summary.planName}</h2>
              <p>
                {summary.billingPeriod === "custom"
                  ? "Internal access"
                  : `${summary.billingPeriod} billing`}
              </p>
            </div>
            <span
              className={`status-badge ${summary.writeAccess ? "" : "neutral"}`}
            >
              {summary.status.replaceAll("_", " ")}
            </span>
          </div>
          <dl className="billing-facts">
            <div>
              <dt>Unlimited users</dt>
              <dd>Included</dd>
            </div>
            <div>
              <dt>Trial ends</dt>
              <dd>{date(summary.trialEndsAt)}</dd>
            </div>
            <div>
              <dt>Current period ends</dt>
              <dd>{date(summary.currentPeriodEndsAt)}</dd>
            </div>
            <div>
              <dt>Write access</dt>
              <dd>{summary.writeAccess ? "Available" : "Restricted"}</dd>
            </div>
          </dl>
          {summary.enforcementMode === "observe" ? (
            <p className="notice" role="status">
              Billing enforcement is in observe mode. Production defaults to
              enforcement after the configured grace period.
            </p>
          ) : null}
          {summary.cancelAtCycleEnd ? (
            <p className="notice">
              Cancellation is scheduled for the end of the current billing
              cycle.
            </p>
          ) : null}
          {canManage &&
          summary.providerSubscriptionId &&
          !summary.cancelAtCycleEnd ? (
            <button
              className="link-button danger-link"
              type="button"
              disabled={pending === "cancel"}
              onClick={() => void cancel()}
            >
              {pending === "cancel" ? "Scheduling…" : "Schedule cancellation"}
            </button>
          ) : null}
        </article>

        <article className="panel">
          <p className="eyebrow">Included capacity</p>
          <h2>Plan limits, not seat charges</h2>
          <div className="billing-limit-grid">
            <div>
              <strong>{summary.limits.companies}</strong>
              <span>companies</span>
            </div>
            <div>
              <strong>{summary.limits.branches}</strong>
              <span>branches</span>
            </div>
            <div>
              <strong>{summary.limits.storage_gb} GB</strong>
              <span>attachments</span>
            </div>
            <div>
              <strong>
                {summary.limits.automation_actions_monthly.toLocaleString(
                  "en-IN",
                )}
              </strong>
              <span>automations / month</span>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Usage</p>
            <h2>What this workspace actually meters</h2>
          </div>
        </div>
        <div className="billing-limit-grid">
          {METERED_USAGE_DIMENSIONS.map((dimension) => {
            const used = Number(summary.usage[dimension.key] || 0);
            const limit = dimension.limitKey
              ? Number(summary.limits[dimension.limitKey] || 0)
              : 0;
            return (
              <div key={dimension.key}>
                <strong>
                  {used.toLocaleString("en-IN")}
                  {limit > 0 ? ` / ${limit.toLocaleString("en-IN")}` : ""}
                </strong>
                <span>{dimension.label}</span>
              </div>
            );
          })}
        </div>
        <p className="billing-commercial-note">
          Only usage this workspace measures today is shown here — no
          estimated or placeholder consumption figures.
        </p>
      </section>

      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Commercial plans</p>
            <h2>Unlimited users with controlled operating capacity</h2>
          </div>
          <div
            className="billing-period-toggle"
            role="group"
            aria-label="Billing period"
          >
            <button
              type="button"
              className={period === "monthly" ? "active" : ""}
              onClick={() => setPeriod("monthly")}
            >
              Monthly
            </button>
            <button
              type="button"
              className={period === "yearly" ? "active" : ""}
              onClick={() => setPeriod("yearly")}
            >
              Yearly · save about 2 months
            </button>
          </div>
        </div>
        <div className="billing-plan-grid">
          {visiblePlans.map((plan) => (
            <article
              className={`billing-plan-card ${plan.planCode === "growth" ? "featured" : ""}`}
              key={plan.id}
            >
              {plan.planCode === "growth" ? (
                <span className="billing-plan-label">Recommended</span>
              ) : null}
              <p className="eyebrow">{plan.planName}</p>
              <h3>
                {money(plan.amountPaise, plan.currency)}
                <small>
                  /{plan.billingPeriod === "yearly" ? "year" : "month"}
                </small>
              </h3>
              <p>{plan.description}</p>
              {plan.onboardingFeePaise ? (
                <p className="billing-onboarding">
                  One-time onboarding:{" "}
                  {money(plan.onboardingFeePaise, plan.currency)}
                </p>
              ) : null}
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <AppIcon name="check" size={16} />
                    {feature}
                  </li>
                ))}
              </ul>
              <details className="billing-plan-modules">
                <summary>
                  {plan.modules.includes("*")
                    ? "All 12 modules included"
                    : `${plan.modules.length} of 12 modules included`}
                </summary>
                <ul>
                  {ERP_MODULE_CATALOG.map((module) => {
                    const included =
                      plan.modules.includes("*") || plan.modules.includes(module.key);
                    return (
                      <li key={module.key} className={included ? "included" : "excluded"}>
                        {included ? <AppIcon name="check" size={13} /> : null}
                        {module.name}
                      </li>
                    );
                  })}
                </ul>
              </details>
              <button
                className={
                  plan.planCode === "growth"
                    ? "primary-button"
                    : "secondary-button"
                }
                type="button"
                disabled={
                  !canCheckout || pending === plan.id || !plan.providerPlanReady
                }
                onClick={() => void beginCheckout(plan)}
              >
                {pending === plan.id
                  ? "Preparing…"
                  : !plan.providerPlanReady
                    ? "Sync Razorpay plan first"
                    : `Choose ${plan.planName}`}
              </button>
            </article>
          ))}
        </div>
        <p className="billing-commercial-note">
          Prices exclude applicable taxes. Provider charges, high-volume
          messaging, AI usage, dedicated infrastructure, migration and custom
          implementation are not silently absorbed into the base subscription.
        </p>
      </section>

      {canManage ? (
        <section className="panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Tax and invoice profile</p>
              <h2>Billing details</h2>
            </div>
          </div>
          <form className="billing-profile-form" onSubmit={saveProfile}>
            <label>
              Legal name
              <input
                name="legalName"
                required
                defaultValue={profile?.legal_name || ""}
              />
            </label>
            <label>
              Billing email
              <input
                name="billingEmail"
                required
                type="email"
                defaultValue={profile?.billing_email || ""}
              />
            </label>
            <label>
              Phone
              <input name="phone" defaultValue={profile?.phone || ""} />
            </label>
            <label>
              GSTIN
              <input name="gstin" defaultValue={profile?.gstin || ""} />
            </label>
            <label className="wide">
              Address
              <input
                name="addressLine1"
                defaultValue={profile?.billing_address?.line1 || ""}
              />
            </label>
            <label>
              City
              <input
                name="city"
                defaultValue={profile?.billing_address?.city || ""}
              />
            </label>
            <label>
              State
              <input
                name="state"
                defaultValue={profile?.billing_address?.state || ""}
              />
            </label>
            <label>
              Postal code
              <input
                name="postalCode"
                defaultValue={profile?.billing_address?.postalCode || ""}
              />
            </label>
            <input name="country" type="hidden" value="IN" />
            <div className="wide">
              <button
                className="primary-button"
                type="submit"
                disabled={pending === "profile"}
              >
                {pending === "profile" ? "Saving…" : "Save billing profile"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="billing-history-grid">
        <article className="panel">
          <p className="eyebrow">Payments</p>
          <h2>Recent collections</h2>
          <div className="billing-history-list">
            {payments.map((payment) => (
              <div key={payment.provider_payment_id}>
                <span>
                  <strong>
                    {money(payment.amount_paise, payment.currency)}
                  </strong>
                  <small>
                    {payment.method || "Razorpay"} ·{" "}
                    {date(payment.captured_at || payment.created_at)}
                  </small>
                </span>
                <span className="status-badge neutral">{payment.status}</span>
              </div>
            ))}
            {!payments.length ? (
              <div className="empty-state">
                <strong>No payments yet</strong>
                <p>Verified payments will appear here.</p>
              </div>
            ) : null}
          </div>
        </article>
        <article className="panel">
          <p className="eyebrow">Invoices</p>
          <h2>Provider invoices</h2>
          <div className="billing-history-list">
            {invoices.map((invoice) => (
              <div key={invoice.provider_invoice_id}>
                <span>
                  <strong>
                    {money(invoice.amount_paise, invoice.currency)}
                  </strong>
                  <small>
                    {date(invoice.issued_at)} · {invoice.status}
                  </small>
                </span>
                {invoice.invoice_url ? (
                  <a
                    className="link-button"
                    href={invoice.invoice_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open invoice
                  </a>
                ) : (
                  <span className="status-badge neutral">{invoice.status}</span>
                )}
              </div>
            ))}
            {!invoices.length ? (
              <div className="empty-state">
                <strong>No invoices yet</strong>
                <p>
                  Razorpay subscription invoices will appear after billing
                  begins.
                </p>
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {message ? (
        <p
          className="notice billing-global-message"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
