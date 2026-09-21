"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, PageHeader, PermissionState, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextField } from "@vercentlabs/design-system";

import { BillingApiError, cancelSubscription, changeSeats, getOverview, saveProfile, startCheckout, syncNow, verifyCheckout, type Checkout, type Overview, type Plan } from "../api/billing-api";

const QUERY_KEY = ["settings", "billing"];
const inr = (paise: number | string | null | undefined) => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const label = (value: string) => value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, handler: (response: { error?: { description?: string } }) => void): void };
  }
}

function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout is only available in the browser."));
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The payment window could not be loaded. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

function openRazorpay(session: Checkout): Promise<void> {
  return new Promise((resolve, reject) => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) return reject(new Error("The payment window is not available."));
    const instance = new Razorpay({
      key: session.keyId,
      subscription_id: session.providerSubscriptionId,
      name: session.name,
      description: session.description,
      prefill: session.prefill,
      theme: { color: "#4338ca" },
      handler: (response: RazorpayResponse) => {
        verifyCheckout({ checkoutSessionId: session.checkoutSessionId, ...response }).then(() => resolve(), reject);
      },
      modal: { ondismiss: () => reject(new Error("The payment window was closed before the payment finished. You have not been charged.")) },
    });
    instance.on("payment.failed", (r) => reject(new Error(r.error?.description || "The payment failed. You have not been charged.")));
    instance.open();
  });
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Notice({ tone, children }: { tone: "danger" | "warning" | "success" | "info"; children: React.ReactNode }) {
  const tones = {
    danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
    warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
    success: "border-success-emphasis/30 bg-success-soft text-success",
    info: "border-info-emphasis/30 bg-info-soft text-info",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function BillingScreen({ canManage, canCheckout }: { canManage: boolean; canCheckout: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getOverview });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (text: string) => {
    setMessage(text);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };
  const failed = (e: unknown) => {
    setError(e instanceof Error ? e.message : "This could not be completed.");
    setMessage(null);
  };

  const refresh = useMutation({ mutationFn: syncNow, onSuccess: (r) => done(r.synced ? "Status refreshed from the payment provider." : "Nothing to refresh yet."), onError: failed });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError || !query.data) {
    if (query.error instanceof BillingApiError && query.error.status === 403) return <PermissionState title="You don't have access to Billing" description="Ask an administrator to grant billing.view." />;
    return <ErrorState title="Could not load billing" description={query.error instanceof Error ? query.error.message : "Something went wrong."} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  const o = query.data;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Billing" description="Your plan, users and payments. The first 3 users are free; each additional user is billed monthly." />
      {error && <Notice tone="danger">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <CurrentPlan o={o} />
      {canManage && o.subscription.hasProviderSubscription && (
        <div className="flex justify-end">
          <Button variant="secondary" isLoading={refresh.isPending} onPress={() => refresh.mutate()}>Refresh status from Razorpay</Button>
        </div>
      )}
      <Panel title="Plans" description="Pick the plan that fits your team. You can change the number of users at any time.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {o.plans.map((plan) => (
            <PlanCard key={plan.code} plan={plan} o={o} canCheckout={canCheckout} canManage={canManage} onDone={done} onError={failed} />
          ))}
        </div>
      </Panel>
      {canManage && <ProfileForm o={o} onDone={done} onError={failed} />}
      <History o={o} />
    </div>
  );
}

function CurrentPlan({ o }: { o: Overview }) {
  const { subscription: s, seats } = o;
  const paid = s.pricingModel === "per_seat";
  return (
    <Panel title="Current plan">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold text-text" data-testid="current-plan-name">{s.planName}</span>
        <StatusBadge tone={["active", "authenticated", "internal"].includes(s.status) ? "success" : "warning"}>{label(s.status)}</StatusBadge>
        {s.cancelAtCycleEnd && <StatusBadge tone="warning">{`Cancels ${date(s.currentPeriodEndsAt)}`}</StatusBadge>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt className="text-xs text-text-muted">Users</dt><dd className="text-xl font-semibold tabular-nums" data-testid="seat-usage">{seats.activeMembers}{seats.capacity !== null ? ` of ${seats.capacity}` : ""}</dd></div>
        <div><dt className="text-xs text-text-muted">Pending invitations</dt><dd className="text-xl font-semibold tabular-nums">{seats.pendingInvitations}</dd></div>
        <div><dt className="text-xs text-text-muted">Free users included</dt><dd className="text-xl font-semibold tabular-nums">{seats.includedUsers ?? "Unlimited"}</dd></div>
        <div><dt className="text-xs text-text-muted">Monthly charge</dt><dd className="text-xl font-semibold tabular-nums">{inr(s.monthlyPaise)}</dd></div>
        {paid && <div><dt className="text-xs text-text-muted">Paid users</dt><dd className="text-xl font-semibold tabular-nums">{seats.paidSeats}</dd></div>}
        {paid && <div><dt className="text-xs text-text-muted">Next renewal</dt><dd className="text-sm font-medium">{date(s.currentPeriodEndsAt)}</dd></div>}
      </dl>
      {seats.pendingPaidSeats !== null && <Notice tone="info">{`Your user count reduces to ${seats.pendingPaidSeats + (seats.includedUsers ?? 0)} at the next renewal. Until then you keep what you have paid for.`}</Notice>}
      {seats.overCapacity && (
        <Notice tone="warning">{`You have more users (${seats.activeMembers}) than your plan covers (${seats.capacity}). ${o.overageGraceEndsAt ? `Add seats or remove users by ${date(o.overageGraceEndsAt)}; after that the organisation becomes read-only.` : "Add seats or remove users."}`}</Notice>
      )}
      {s.status === "past_due" && <Notice tone="warning">{`The last payment failed. Writes pause after ${date(s.graceEndsAt)} unless the payment goes through.`}</Notice>}
    </Panel>
  );
}

function PlanCard({ plan, o, canCheckout, canManage, onDone, onError }: { plan: Plan; o: Overview; canCheckout: boolean; canManage: boolean; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const included = plan.includedUsers ?? 3;
  const paidNow = o.subscription.hasProviderSubscription && o.subscription.pricingModel === "per_seat";
  const floor = Math.max(included + 1, o.seats.used);
  const [users, setUsers] = useState<number>(paidNow ? included + o.seats.paidSeats : floor);
  const billable = Math.max(0, users - included);
  const monthly = billable * (plan.perUserPricePaise ?? 0);
  const [confirming, setConfirming] = useState(false);

  const checkout = useMutation({
    mutationFn: async () => {
      const session = await startCheckout(plan.priceId, users);
      await loadRazorpay();
      await openRazorpay(session as unknown as Checkout);
    },
    onSuccess: () => onDone("Your subscription is active. Thank you."),
    onError,
  });
  const seats = useMutation({
    mutationFn: () => changeSeats(users),
    onSuccess: (r) => onDone(r.effective === "now" ? "Users added. The prorated charge for the rest of this cycle is billed now." : "Your user count will reduce at the next renewal."),
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => cancelSubscription(true),
    onSuccess: (r) => onDone(r.effective === "cycle_end" ? `Your subscription ends on ${date(r.endsAt)} and you move to Free.` : "You are now on the Free plan."),
    onError,
  });

  return (
    <article className={`flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 ${plan.current ? "border-brand" : "border-border"} bg-surface`} data-testid={`plan-${plan.code}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text">{plan.name}</h3>
        {plan.current && <StatusBadge tone="success">Current</StatusBadge>}
        {plan.availability === "coming_soon" && <StatusBadge tone="neutral">Coming soon</StatusBadge>}
      </div>
      {plan.availability === "coming_soon" ? (
        <p className="text-sm text-text-muted">{plan.description}</p>
      ) : plan.pricingModel === "free" ? (
        <p className="text-2xl font-semibold text-text">₹0<span className="text-sm font-normal text-text-muted"> / month</span></p>
      ) : (
        <p className="text-2xl font-semibold text-text">{inr(plan.perUserPricePaise)}<span className="text-sm font-normal text-text-muted"> / additional user / month</span></p>
      )}
      {plan.availability === "available" && (
        <ul className="flex flex-col gap-1 text-sm text-text-secondary">
          {plan.features.map((f) => <li key={f}>• {f}</li>)}
        </ul>
      )}

      {plan.availability === "available" && plan.pricingModel === "per_seat" && canCheckout && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <NumberField label="Total users" value={users} onChange={(v) => setUsers(Math.max(1, Math.round(Number(v) || 0)))} minValue={1} maxValue={500} />
          <p className="text-sm text-text-secondary" data-testid="price-quote">
            {users <= included ? `Up to ${included} users is free.` : `${included} users included + ${billable} additional × ${inr(plan.perUserPricePaise)} = `}
            {users > included && <strong data-testid="price-total">{inr(monthly)} / month</strong>}
          </p>
          {!o.checkoutEnabled && <Notice tone="info">Online payment is not switched on for this workspace yet. Contact support to upgrade.</Notice>}
          {paidNow ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" isDisabled={!canManage || !o.checkoutEnabled || users === included + o.seats.paidSeats} isLoading={seats.isPending} onPress={() => seats.mutate()}>Update users</Button>
              {!o.subscription.cancelAtCycleEnd &&
                (confirming ? (
                  <>
                    <Button variant="danger" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Confirm: cancel at renewal</Button>
                    <Button variant="secondary" onPress={() => setConfirming(false)}>Keep plan</Button>
                  </>
                ) : (
                  <Button variant="secondary" isDisabled={!canManage} onPress={() => setConfirming(true)}>Cancel subscription</Button>
                ))}
            </div>
          ) : (
            <Button variant="primary" isDisabled={!o.checkoutEnabled || users <= included} isLoading={checkout.isPending} onPress={() => checkout.mutate()}>{`Upgrade to ${plan.name}`}</Button>
          )}
        </div>
      )}
      {plan.availability === "coming_soon" && <Button variant="secondary" isDisabled>Coming soon</Button>}
    </article>
  );
}

function ProfileForm({ o, onDone, onError }: { o: Overview; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const p = o.profile;
  const a = p?.billing_address ?? {};
  const [form, setForm] = useState({ legalName: p?.legal_name ?? "", billingEmail: p?.billing_email ?? "", phone: p?.phone ?? "", gstin: p?.gstin ?? "", addressLine1: a.line1 ?? "", city: a.city ?? "", state: a.state ?? "", postalCode: a.postalCode ?? "", country: a.country ?? "IN" });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({ mutationFn: () => saveProfile(form), onSuccess: () => onDone("Billing details saved."), onError });
  return (
    <Panel title="Billing details" description="Shown on your invoices. Add a GSTIN to receive GST invoices.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Legal name" value={form.legalName} onChange={set("legalName")} />
        <TextField label="Billing email" value={form.billingEmail} onChange={set("billingEmail")} />
        <TextField label="Phone" value={form.phone} onChange={set("phone")} />
        <TextField label="GSTIN" value={form.gstin} onChange={set("gstin")} />
        <TextField label="Address" value={form.addressLine1} onChange={set("addressLine1")} />
        <TextField label="City" value={form.city} onChange={set("city")} />
        <TextField label="State" value={form.state} onChange={set("state")} />
        <TextField label="Postal code" value={form.postalCode} onChange={set("postalCode")} />
      </div>
      <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save billing details</Button></div>
    </Panel>
  );
}

function History({ o }: { o: Overview }) {
  return (
    <>
      <Panel title="Invoices">
        {o.invoices.length === 0 ? (
          <p className="text-sm text-text-muted">No invoices yet. Invoices appear after your first paid renewal.</p>
        ) : (
          <Table className="w-full text-sm">
            <TableHead><TableRow className="border-b border-border text-left text-text-muted"><TableHeaderCell className="px-2 py-1 font-medium">Invoice</TableHeaderCell><TableHeaderCell className="px-2 py-1 font-medium">Issued</TableHeaderCell><TableHeaderCell className="px-2 py-1 text-right font-medium">Amount</TableHeaderCell><TableHeaderCell className="px-2 py-1 font-medium">Status</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
            <TableBody>
              {o.invoices.map((i) => (
                <TableRow key={i.id} className="border-b border-border/50">
                  <TableCell className="px-2 py-1">{i.provider_invoice_id}</TableCell><TableCell className="px-2 py-1">{date(i.issued_at)}</TableCell><TableCell className="px-2 py-1 text-right tabular-nums">{inr(i.amount_paise)}</TableCell><TableCell className="px-2 py-1">{label(i.status)}</TableCell>
                  <TableCell className="px-2 py-1">{i.invoice_url && <a className="text-brand hover:underline" href={i.invoice_url} target="_blank" rel="noreferrer">View</a>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <Panel title="Payments">
        {o.payments.length === 0 ? (
          <p className="text-sm text-text-muted">No payments yet.</p>
        ) : (
          <Table className="w-full text-sm">
            <TableHead><TableRow className="border-b border-border text-left text-text-muted"><TableHeaderCell className="px-2 py-1 font-medium">Payment</TableHeaderCell><TableHeaderCell className="px-2 py-1 font-medium">Date</TableHeaderCell><TableHeaderCell className="px-2 py-1 font-medium">Method</TableHeaderCell><TableHeaderCell className="px-2 py-1 text-right font-medium">Amount</TableHeaderCell><TableHeaderCell className="px-2 py-1 font-medium">Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {o.payments.map((p) => (
                <TableRow key={p.id} className="border-b border-border/50">
                  <TableCell className="px-2 py-1">{p.provider_payment_id}</TableCell><TableCell className="px-2 py-1">{date(p.captured_at ?? p.created_at)}</TableCell><TableCell className="px-2 py-1">{p.method ? label(p.method) : "—"}</TableCell><TableCell className="px-2 py-1 text-right tabular-nums">{inr(p.amount_paise)}</TableCell><TableCell className="px-2 py-1">{label(p.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {o.seatChanges.length > 0 && (
        <Panel title="User changes" description="Every change to the number of paid users.">
          <ul className="text-sm">
            {o.seatChanges.map((c) => (
              <li key={c.id} className="flex justify-between border-b border-border/50 py-1">
                <span>{`${c.reason}: ${c.from_paid_seats} → ${c.to_paid_seats} paid users (${c.effective === "now" ? "immediate" : "at renewal"}, ${c.status})`}</span>
                <span className="text-text-muted">{date(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
