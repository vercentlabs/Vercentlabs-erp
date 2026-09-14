import { ProgressBar as AriaProgressBar, type ProgressBarProps as AriaProgressBarProps } from "react-aria-components";
import { cn } from "../utilities/cn.ts";

export interface ProgressBarProps extends Omit<AriaProgressBarProps, "className"> {
  className?: string;
  label?: string;
}

/** Determinate/indeterminate progress for a known-duration operation. For
 * a background job with retry/failure states, use BackgroundJobProgress
 * (enterprise/) instead — it composes this with job-status semantics. */
export function ProgressBar({ className, label, ...props }: ProgressBarProps) {
  return (
    <AriaProgressBar className={cn("flex flex-col gap-1.5", className)} {...props}>
      {({ percentage, valueText, isIndeterminate }) => (
        <>
          {label && (
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>{label}</span>
              {!isIndeterminate && <span className="tabular-nums">{valueText}</span>}
            </div>
          )}
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-canvas-strong">
            <div
              className={cn("h-full rounded-pill bg-brand transition-[width] duration-[var(--motion-standard)]", isIndeterminate && "w-1/3 animate-pulse")}
              style={isIndeterminate ? undefined : { width: `${percentage}%` }}
            />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}
