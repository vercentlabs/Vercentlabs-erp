import { useId } from "react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../utils/cn";

export interface FormFieldRenderProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

// The shared field shell the TanStack Form field components (TextField,
// SelectField, ...) render into: owns the label<->control<->error/help-text
// association (SP032 -- "accessible descriptions/validation errors") so
// each field component doesn't re-derive its own ids. `children` is a
// render function so the field component can forward the generated
// id/aria-* props onto its actual input element.
export function FormField({
  label,
  htmlFor,
  required,
  error,
  description,
  disabled,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  children: (props: FormFieldRenderProps) => ReactElement;
  className?: string;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", disabled && "opacity-60", className)}>
      <label htmlFor={id} className="text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)]">
        {label}
        {required ? (
          <span className="ml-0.5 text-[var(--color-state-danger)]" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {description ? (
        <p id={descriptionId} className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[length:var(--text-xs)] text-[var(--color-state-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[var(--color-border-default)] p-4", className)}>
      {title ? (
        <legend className="px-1">
          <span className="text-[length:var(--text-md)] font-semibold text-[var(--color-text-primary)]">{title}</span>
          {description ? <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{description}</p> : null}
        </legend>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-3 border-t border-[var(--color-border-default)] pt-4", className)}>{children}</div>;
}
