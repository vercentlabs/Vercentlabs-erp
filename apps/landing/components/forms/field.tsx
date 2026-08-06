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
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-(--color-text-primary)">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-(--color-state-error)">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-(--color-text-muted)">Optional</span>
        )}
      </label>
      {description ? (
        <p id={descriptionId} className="text-xs text-(--color-text-muted)">
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
    <div role="alert" className={cx("rounded-(--radius-control) border px-4 py-3 text-sm", toneClasses)}>
      {children}
    </div>
  );
}
