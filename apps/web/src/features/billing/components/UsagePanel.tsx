"use client";

// What the plan's allowances are used for (Shared Platform plan 2): file storage, and this month's emails, SMS and WhatsApp messages.
import type { Overview } from "../api/billing-api";
import { BillingNotice, BillingPanel } from "./BillingPanel";

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;

function Meter({ label, used, limit, percent, warning, testId }: { label: string; used: string; limit: string; percent: number; warning: number; testId: string }) {
  const tone = percent >= 100 ? "bg-danger" : percent >= warning ? "bg-warning" : "bg-brand";
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-text-secondary">{`${used} of ${limit}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

export function UsagePanel({ overview }: { overview: Overview }) {
  const usage = overview.usage;
  if (!usage.storage.limitBytes && !usage.messages.limit) return null;
  const full = usage.storage.percent >= 100 || usage.messages.percent >= 100;
  return (
    <BillingPanel title="Usage" description="Messages are the emails, SMS and WhatsApp messages your apps send to customers and suppliers; they reset each month.">
      <div className="grid gap-4 sm:grid-cols-2">
        {usage.storage.limitBytes > 0 && (
          <Meter label="File storage" used={gb(usage.storage.usedBytes)} limit={gb(usage.storage.limitBytes)} percent={usage.storage.percent} warning={usage.warningPercent} testId="usage-storage" />
        )}
        {usage.messages.limit > 0 && (
          <Meter label="Messages this month" used={usage.messages.used.toLocaleString("en-IN")} limit={usage.messages.limit.toLocaleString("en-IN")} percent={usage.messages.percent} warning={usage.warningPercent} testId="usage-messages" />
        )}
      </div>
      {full && (
        <BillingNotice tone={usage.enforced ? "danger" : "warning"}>
          {usage.enforced ? "An allowance is used up: uploads or messages stop until you free space, the month turns, or you upgrade." : "An allowance is used up. Nothing is blocked yet in this workspace."}
        </BillingNotice>
      )}
    </BillingPanel>
  );
}
