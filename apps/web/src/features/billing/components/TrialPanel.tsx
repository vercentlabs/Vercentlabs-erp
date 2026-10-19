"use client";

// The 30-day Standard trial (migration 0193) at the top of Billing: how far through it the company is, that nothing is charged during it,
// and the two ways on — subscribe to Standard, or move to Free. Once it has ended the same panel says the apps are paused until one is chosen.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertDialog, Button, buttonVariants } from "@vercentlabs/design-system";
import { CalendarClock, Lock, Sparkles, Users } from "lucide-react";

import { switchToFree, type Overview } from "../api/billing-api";
import { formatDate } from "../billing-labels";

type Report = { tone: "success" | "info" | "warning" | "danger"; text: string };
const DAY = 86_400_000;

// Moving to Free, behind a confirmation (used here and on the Free plan card).
export function SwitchToFreeButton({ overview, onResult, variant = "outline" }: { overview: Overview; onResult: (report: Report) => void; variant?: "outline" | "secondary" | "primary" }) {
  const [confirming, setConfirming] = useState(false);
  const free = overview.plans.find((plan) => plan.code === "free");
  const users = overview.seats.used;
  const move = useMutation({
    mutationFn: switchToFree,
    onSuccess: () => { setConfirming(false); onResult({ tone: "success", text: "You are on the Free plan now. Choose the one app your company will use below." }); },
    onError: (error) => { setConfirming(false); onResult({ tone: "danger", text: error instanceof Error ? error.message : "The plan could not be changed." }); },
  });
  return (
    <>
      <Button variant={variant} onPress={() => setConfirming(true)}>Switch to Free</Button>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title="Move to the Free plan?"
        description={`Free is ${free?.includedUsers ?? 1} user and 1 app of your choice, at no charge. You will choose the app next; the data in every other app is kept and comes back if you subscribe to Standard later.${
          users > (free?.includedUsers ?? 1) ? ` You have ${users} users: remove the extra users within the grace period, or business changes pause.` : ""}`}
        confirmLabel="Move to Free"
        isConfirming={move.isPending}
        onConfirm={() => move.mutate()}
      />
    </>
  );
}

export function TrialPanel({ overview, canManage, onResult }: { overview: Overview; canManage: boolean; onResult: (report: Report) => void }) {
  const trial = overview.subscription.trial;
  // The moment the page opened: days left are counted from it.
  const [now] = useState(() => Date.now());
  if (!trial?.endsAt) return null;
  const ends = new Date(trial.endsAt).getTime();
  const starts = trial.startedAt ? new Date(trial.startedAt).getTime() : ends - 30 * DAY;
  const totalDays = Math.max(1, Math.round((ends - starts) / DAY));
  const daysLeft = Math.max(0, Math.ceil((ends - now) / DAY));
  const usedPercent = Math.min(100, Math.max(0, ((totalDays - daysLeft) / totalDays) * 100));
  const ended = trial.ended;
  const soon = !ended && daysLeft <= 7;
  return (
    <section aria-label="Free trial" data-testid="billing-trial"
      className={`flex flex-col gap-4 rounded-[var(--radius-card)] border p-5 ${ended ? "border-danger-emphasis/30 bg-danger-soft" : "border-brand-border bg-brand-soft"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${ended ? "bg-danger text-white" : "bg-brand text-white"}`}>
            {ended ? <Lock className="size-5" aria-hidden="true" /> : <Sparkles className="size-5" aria-hidden="true" />}
          </span>
          <div className="flex flex-col gap-1">
            <h2 className={`text-lg font-semibold ${ended ? "text-danger" : "text-text"}`}>
              {ended ? "Your free trial has ended" : `Standard free trial · ${daysLeft === 0 ? "ends today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}`}
            </h2>
            <p className="max-w-2xl text-sm text-text-secondary">
              {ended
                ? `The trial ended on ${formatDate(trial.endsAt)} and your apps are paused. Nothing has been deleted: subscribe to Standard to carry on with every app, or move to Free (1 user, 1 app) at no charge.`
                : `Every app, for every user, until ${formatDate(trial.endsAt)}. No payment is needed during the trial. When it ends, subscribe to keep going, or move to the Free plan.`}
            </p>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <a href="#plans" className={buttonVariants({ variant: "primary" })}>
              {ended ? "Subscribe to Standard" : "Choose a plan"}
            </a>
            <SwitchToFreeButton overview={overview} onResult={onResult} variant="outline" />
          </div>
        )}
      </div>
      {!ended && (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-surface" role="meter" aria-label="Trial used" aria-valuenow={Math.round(usedPercent)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${soon ? "bg-warning" : "bg-brand"}`} style={{ width: `${usedPercent}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-text-secondary">
            <span>{`Started ${formatDate(trial.startedAt)}`}</span>
            <span>{`Ends ${formatDate(trial.endsAt)}`}</span>
          </div>
        </div>
      )}
      <dl className="grid gap-3 sm:grid-cols-3">
        <TrialFact icon={<Users className="size-4" aria-hidden="true" />} label="Users" value={`${overview.seats.used}`} note={ended ? "Kept" : "No limit during the trial"} />
        <TrialFact icon={<Sparkles className="size-4" aria-hidden="true" />} label="Apps" value={ended ? "Paused" : "Every app"} note={ended ? "Until you choose a plan" : "All Standard features"} />
        <TrialFact icon={<CalendarClock className="size-4" aria-hidden="true" />} label="Charged so far" value="₹0" note="No payment details asked" />
      </dl>
    </section>
  );
}

function TrialFact({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-surface px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">{icon}</span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-text-muted">{label}</dt>
        <dd className="text-sm font-semibold text-text">{value} <span className="font-normal text-text-muted">· {note}</span></dd>
      </div>
    </div>
  );
}
