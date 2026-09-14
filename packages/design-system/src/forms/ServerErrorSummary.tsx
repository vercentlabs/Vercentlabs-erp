import { AlertCircle } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export interface ServerErrorSummaryProps {
  className?: string;
  /** Form-level errors the backend returned that aren't tied to one field
   * (a business-rule rejection, a conflict, an authorization failure).
   * Field-specific server errors should be set back onto the individual
   * field instead (`form.setFieldMeta(name, meta => ({...meta, errorMap: ...}))`)
   * so they render next to the field, not duplicated here. */
  errors: string[];
}

/**
 * Server errors are authoritative and distinct from client Zod validation
 * — per the form architecture principle, frontend validation improves
 * usability but never replaces backend rules. This renders what the
 * backend actually rejected, verbatim, not a generic "something went
 * wrong."
 */
export function ServerErrorSummary({ className, errors }: ServerErrorSummaryProps) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className={cn("flex flex-col gap-1 rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft p-3", className)}>
      {errors.map((error, i) => (
        <p key={i} className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ))}
    </div>
  );
}
