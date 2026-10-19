"use client";

// The 30-day Standard trial in the shell: a slim bar on every page while it runs (days left, no payment needed), and — once it has ended —
// a full-page notice in place of the apps until the company subscribes or moves to Free. Billing stays open so either can be done; the
// company's data is kept. The server enforces the same rule (the trial's apps and writes stop); this is what the person sees.
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Lock, Sparkles } from "lucide-react";
import { buttonVariants } from "@vercentlabs/design-system";

export type TrialState = { endsAt: string; ended: boolean } | null;

const BILLING_PATH = "/settings/billing";
const DAY = 86_400_000;
const formatDay = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function trialDaysLeft(endsAt: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / DAY));
}

export function TrialBanner({ trial, canManageBilling }: { trial: TrialState; canManageBilling: boolean }) {
  if (!trial || trial.ended) return null;
  const days = trialDaysLeft(trial.endsAt);
  const soon = days <= 7;
  return (
    <div role="status" className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-sm ${soon ? "border-warning-emphasis/30 bg-warning-soft text-warning" : "border-brand-border bg-brand-soft text-brand-active"}`}>
      {soon ? <Clock className="size-4 shrink-0" aria-hidden="true" /> : <Sparkles className="size-4 shrink-0" aria-hidden="true" />}
      <span>
        <span className="font-semibold">{days === 0 ? "Your free trial ends today." : `${days} day${days === 1 ? "" : "s"} left in your free trial.`}</span>
        {` Every app is included until ${formatDay(trial.endsAt)}; no payment is needed until then.`}
      </span>
      {canManageBilling && (
        <Link href={BILLING_PATH} className="font-semibold underline underline-offset-2 hover:no-underline">Choose a plan</Link>
      )}
    </div>
  );
}

// Once the trial has ended, every page but Billing shows this instead of the app.
export function TrialGate({ trial, canManageBilling, children }: { trial: TrialState; canManageBilling: boolean; children: ReactNode }) {
  const pathname = usePathname();
  if (!trial?.ended || pathname.startsWith(BILLING_PATH)) return <>{children}</>;
  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <section className="flex w-full max-w-lg flex-col items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-8 text-center shadow-sm">
        <span className="flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning"><Lock className="size-5" aria-hidden="true" /></span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold text-text">Your free trial has ended</h1>
          <p className="text-sm text-text-secondary">
            {`The 30-day trial ended on ${formatDay(trial.endsAt)}, so your apps are paused. Nothing has been deleted: everything you entered is kept and comes back as soon as you choose a plan.`}
          </p>
        </div>
        {canManageBilling ? (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`${BILLING_PATH}#plans`} className={buttonVariants({ variant: "primary" })}>Subscribe to Standard</Link>
              <Link href={`${BILLING_PATH}#plans`} className={buttonVariants({ variant: "outline" })}>Continue on Free</Link>
            </div>
            <p className="text-xs text-text-muted">Standard is every app for every user. Free is 1 user and 1 app of your choice, at no charge.</p>
          </>
        ) : (
          <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm text-text-secondary">Ask your company&apos;s owner or administrator to choose a plan in Billing.</p>
        )}
      </section>
    </div>
  );
}
