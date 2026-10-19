"use client";

// The Free plan's one app (Shared Platform plan 2): which app the company uses, choosing it, and switching (once every 30 days).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Select, StatusBadge } from "@vercentlabs/design-system";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { chooseApp, type Overview } from "../api/billing-api";
import { formatDate } from "../billing-labels";
import { BillingNotice, BillingPanel } from "./BillingPanel";

type Report = { tone: "success" | "info" | "warning" | "danger"; text: string };

const APPS = ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map((module) => ({ value: module.key, label: module.name }));
const appName = (key: string) => APPS.find((app) => app.value === key)?.label ?? key;

export function AppChoicePanel({ overview, canManage, onResult }: { overview: Overview; canManage: boolean; onResult: (report: Report) => void }) {
  const choice = overview.appChoice;
  const current = choice.selected?.[0] ?? null;
  const [picked, setPicked] = useState<string>(current ?? APPS[0]?.value ?? "");
  const save = useMutation({
    mutationFn: () => chooseApp(picked),
    onSuccess: (result) => onResult({ tone: "success", text: result.appChoice.changed ? `${appName(picked)} is your company's app now.` : `${appName(picked)} is already your app.` }),
    onError: (error) => onResult({ tone: "danger", text: error instanceof Error ? error.message : "The app could not be chosen." }),
  });
  if (choice.allowance === null) return null;
  if (choice.grandfathered) {
    return (
      <BillingPanel title="Your apps" description={`The ${choice.planName} plan now includes ${choice.allowance} app. Your company joined before that and keeps the apps it has.`}>
        <p className="text-sm text-text-secondary">Choosing an app here would limit the company to that one app. Upgrade to Standard for every app.</p>
      </BillingPanel>
    );
  }
  const switching = Boolean(current) && picked !== current;
  return (
    <BillingPanel
      title="Your app"
      description={`The ${choice.planName} plan includes ${choice.allowance} app. You can switch to another app once every ${choice.switchIntervalDays} days; the data of an app you leave is kept.`}
      testId="billing-app-choice"
    >
      {choice.needsChoice && <BillingNotice tone="warning">Choose the app your company will use. Until then no app is open.</BillingNotice>}
      {current && (
        <p className="flex items-center gap-2 text-sm">
          <span className="font-medium">{appName(current)}</span>
          <StatusBadge tone="success">In use</StatusBadge>
          {!choice.canSwitch && choice.nextSwitchAt && <span className="text-text-muted">{`You can switch again on ${formatDate(choice.nextSwitchAt)}.`}</span>}
        </p>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56">
            <Select label={current ? "Switch to" : "App"} selectedKey={picked} onSelectionChange={(key) => setPicked(String(key))} options={APPS} />
          </div>
          <Button
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!picked || picked === current || (switching && !choice.canSwitch)}
            onPress={() => save.mutate()}
          >
            {current ? "Switch app" : "Use this app"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">The owner or an administrator chooses the company&apos;s app.</p>
      )}
    </BillingPanel>
  );
}
