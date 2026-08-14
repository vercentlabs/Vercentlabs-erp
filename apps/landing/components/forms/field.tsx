
import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

interface FieldWrapperProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: (describedBy: string | undefined) => ReactNode;
  className?: string;
}

/**
 * Wires label/description/error together with the correct `aria-describedby` chain
 * so screen readers announce help text and validation errors, not just the label.
 */
export function FieldWrapper({ id, label, description, error, required, children, className }: FieldWrapperProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-(--color-text-primary)">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-(--color-state-error)">
            *
          </span>
        ) : (
          <span className="ml-2 text-[0.63rem] font-semibold normal-case tracking-normal text-(--color-text-muted)">Optional</span>
        )}
      </label>
      {description ? (
        <p id={descriptionId} className="text-xs leading-relaxed text-(--color-text-muted)">
          {description}
        </p>
      ) : null}
      {children(describedBy)}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-(--color-state-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Page-level or form-level status message (e.g. submission failure) — not a per-field error. */
export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  const toneClasses =
    tone === "error"
      ? "border-(--color-state-error) bg-(--color-state-error-soft) text-(--color-state-error)"
      : "border-(--color-state-success) bg-(--color-state-success-soft) text-(--color-state-success)";
  return (
    <div role="alert" className={cx("border-l-[3px] border-y border-r px-4 py-3 text-sm", toneClasses)}>
      {children}
    </div>
  );
}
