import { Clock, Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { ProgressBar } from "../data-display/ProgressBar.tsx";
import { cn } from "../utilities/cn.ts";

export type BackgroundJobStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed";

export interface BackgroundJobProgressProps {
  className?: string;
  /** e.g. "Importing 2,400 leads" */
  label: string;
  status: BackgroundJobStatus;
  /** 0-100, only meaningful while status is "running". */
  progress?: number;
  /** e.g. "1,204 of 2,400 processed" */
  detail?: string;
  onRetry?: () => void;
  onViewErrors?: () => void;
}

const statusMeta: Record<BackgroundJobStatus, { icon: typeof Clock; className: string; label: string }> = {
  queued: { icon: Clock, className: "text-text-muted", label: "Queued" },
  running: { icon: Loader2, className: "text-brand", label: "Running" },
  completed: { icon: CheckCircle2, className: "text-success", label: "Completed" },
  completed_with_errors: { icon: AlertTriangle, className: "text-warning", label: "Completed with errors" },
  failed: { icon: XCircle, className: "text-danger", label: "Failed" },
};

/**
 * Status for a long-running async operation (import, export, payroll run,
 * mass update, integration sync). Never render a synchronous "Success"
 * message for work that's actually still queued/running — that's exactly
 * the fake-completion pattern this component exists to prevent.
 */
export function BackgroundJobProgress({ className, label, status, progress, detail, onRetry, onViewErrors }: BackgroundJobProgressProps) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <div className={cn("flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("size-4 shrink-0", meta.className, status === "running" && "animate-spin")} aria-hidden="true" />
          <span className="truncate text-sm font-medium text-text">{label}</span>
        </div>
        <span className={cn("shrink-0 text-xs font-medium", meta.className)}>{meta.label}</span>
      </div>
      {status === "running" && progress !== undefined && <ProgressBar value={progress} aria-label={`${label} progress`} />}
      {detail && <p className="text-xs text-text-muted">{detail}</p>}
      {(onRetry || onViewErrors) && (
        <div className="flex gap-2">
          {status === "failed" && onRetry && (
            <Button variant="secondary" size="compact" onPress={onRetry}>
              Retry
            </Button>
          )}
          {status === "completed_with_errors" && onViewErrors && (
            <Button variant="secondary" size="compact" onPress={onViewErrors}>
              View errors
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
