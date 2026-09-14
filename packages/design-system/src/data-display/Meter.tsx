import { Meter as AriaMeter, type MeterProps as AriaMeterProps } from "react-aria-components";
import { cn } from "../utilities/cn.ts";

export interface MeterProps extends Omit<AriaMeterProps, "className"> {
  className?: string;
  label?: string;
}

/** Meter differs from ProgressBar semantically: it's a capacity/level
 * reading (storage used, budget consumed, stock level against reorder
 * point), not a task's completion progress. Screen readers announce them
 * differently — don't substitute one for the other. */
export function Meter({ className, label, ...props }: MeterProps) {
  return (
    <AriaMeter className={cn("flex flex-col gap-1.5", className)} {...props}>
      {({ percentage, valueText }) => (
        <>
          {label && (
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>{label}</span>
              <span className="tabular-nums">{valueText}</span>
            </div>
          )}
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-canvas-strong">
            <div
              className={cn(
                "h-full rounded-pill transition-[width] duration-[var(--motion-standard)]",
                percentage >= 90 ? "bg-danger" : percentage >= 75 ? "bg-warning" : "bg-success",
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </>
      )}
    </AriaMeter>
  );
}
