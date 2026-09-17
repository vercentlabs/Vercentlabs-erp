import type { ReactNode } from "react";
import { AlertTriangle, WifiOff, RotateCw } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { cn } from "../utilities/cn.ts";

interface BaseBannerProps {
  className?: string;
  icon: typeof AlertTriangle;
  tone: "warning" | "danger" | "neutral";
  message: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

const toneClasses = {
  warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
  danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
  neutral: "border-border-strong bg-canvas-strong text-text-secondary",
};

function BaseBanner({ className, icon: Icon, tone, message, actionLabel, onAction }: BaseBannerProps) {
  return (
    <div role="status" className={cn("flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-sm", toneClasses[tone], className)}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {actionLabel && onAction && (
        <Button variant="secondary" size="compact" onPress={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export interface ConflictBannerProps {
  className?: string;
  /** Who changed it and when, if known — e.g. "Priya Nair updated this 2 minutes ago." */
  message?: ReactNode;
  onReload: () => void;
}

/** Someone else changed this record since it was loaded — the
 * optimistic-concurrency conflict case. Always offer reload, never let the
 * user silently overwrite a change they haven't seen. */
export function ConflictBanner({ className, message, onReload }: ConflictBannerProps) {
  return (
    <BaseBanner
      className={className}
      icon={AlertTriangle}
      tone="warning"
      message={message ?? "This record changed since you opened it. Reload to see the latest version before saving."}
      actionLabel="Reload"
      onAction={onReload}
    />
  );
}

export interface OfflineBannerProps {
  className?: string;
  /** Number of changes queued to sync once back online — omit if nothing
   * is queued (pure connectivity notice). */
  pendingChangeCount?: number;
}

/** Connectivity lost. Never hide offline state — per the offline-UX
 * principle, this stays visible for the whole duration, not a toast that
 * disappears while the user is still offline. */
export function OfflineBanner({ className, pendingChangeCount }: OfflineBannerProps) {
  return (
    <BaseBanner
      className={className}
      icon={WifiOff}
      tone="neutral"
      message={
        pendingChangeCount
          ? `You're offline. ${pendingChangeCount} change${pendingChangeCount === 1 ? "" : "s"} will sync when you're back online.`
          : "You're offline. Some actions are unavailable until connection is restored."
      }
    />
  );
}

export interface StaleDataBannerProps {
  className?: string;
  /** Pre-formatted, e.g. "5 minutes ago". */
  lastUpdated: string;
  onRefresh: () => void;
}

/** Data on screen may be out of date (a dashboard, a report snapshot) —
 * distinct from ConflictBanner, which is about THIS record having
 * changed; this is about a read-only view generally aging. */
export function StaleDataBanner({ className, lastUpdated, onRefresh }: StaleDataBannerProps) {
  return (
    <BaseBanner
      className={className}
      icon={RotateCw}
      tone="neutral"
      message={`Data as of ${lastUpdated}.`}
      actionLabel="Refresh"
      onAction={onRefresh}
    />
  );
}
