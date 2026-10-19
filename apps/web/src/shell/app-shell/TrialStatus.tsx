"use client";

// The 30-day Standard trial in the shell: a slim bar on every page while it runs (days left, no payment needed), and — once it has ended —
// a full-page notice in place of the apps until the company subscribes or moves to Free. Billing stays open so either can be done; the
// company's data is kept. The server enforces the same rule (the trial's apps and writes stop); this is what the person sees.
import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Lock, Sparkles, X } from "lucide-react";
import { buttonVariants } from "@vercentlabs/design-system";

export type TrialState = { endsAt: string; ended: boolean } | null;

const BILLING_PATH = "/settings/billing";
const DAY = 86_400_000;
const formatDay = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function trialDaysLeft(endsAt: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / DAY));
}

// Closing the bar is remembered in this browser: until the trial's last 7 days, then (as a warning) for the rest of that day only, so
// an ending trial is never missed.
const DISMISS_EVENT = "vl-trial-bar-dismissed";
const dismissKey = (endsAt: string, soon: boolean) =>
  soon ? `vl_trial_bar_closed_final_${new Date().toDateString()}` : `vl_trial_bar_closed_${endsAt}`;
function readDismissed(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
}

export function TrialBanner({ trial, canManageBilling }: { trial: TrialState; canManageBilling: boolean }) {
  const days = trial ? trialDaysLeft(trial.endsAt) : 0;
  const soon = days <= 7;
  const key = trial ? dismissKey(trial.endsAt, soon) : "";
  // Hidden while the page is drawn on the server, so a closed bar never flashes before the browser's choice is read.
  const dismissed = useSyncExternalStore(subscribe, () => !key || readDismissed(key), () => true);
  if (!trial || trial.ended || dismissed) return null;
  const close = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: the bar simply closes for this page.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  };
  return (
    <div role="status" className={`relative flex min-h-10 shrink-0 items-center justify-center border-b py-2 pl-4 pr-12 text-sm ${soon ? "border-warning-emphasis/30 bg-warning-soft text-warning" : "border-brand-border bg-brand-soft text-brand-active"}`}>
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        {soon ? <Clock className="size-4 shrink-0" aria-hidden="true" /> : <Sparkles className="size-4 shrink-0" aria-hidden="true" />}
        <span>
          <span className="font-semibold">{days === 0 ? "Your free trial ends today." : `${days} day${days === 1 ? "" : "s"} left in your free trial.`}</span>
          <span className="max-sm:hidden">{` Every app is included until ${formatDay(trial.endsAt)}; no payment is needed until then.`}</span>
        </span>
        {canManageBilling && (
          <Link href={BILLING_PATH} className="font-semibold underline underline-offset-2 hover:no-underline">Choose a plan</Link>
        )}
      </p>
      <button type="button" onClick={close} aria-label="Close the trial message" title="Close"
        className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full opacity-70 outline-none transition hover:bg-black/5 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-brand">
        <X className="size-4" aria-hidden="true" />
      </button>
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
