import type { ReactNode } from "react";
import { Label, Text, FieldError } from "react-aria-components";
import { cva } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";

/** Shared input chrome (border/background/focus/invalid/disabled) reused by
 * every text-like field (TextField, NumberField, SearchField, DateField,
 * Select trigger, ComboBox input) so they read as one visual family. */
// This chrome is applied to a plain wrapper <div>, not a React Aria
// component instance, so hover/focus use native CSS pseudo-classes
// (:hover, :focus-within) rather than RAC's data-hovered/data-focus-within
// render props. Invalid/disabled/required DO come from RAC, but from the
// ancestor field component's root, not this div — so those use
// group-data-[*]: and expect the field component to put `className="group"`
// on its Aria*Field root.
export const inputChrome = cva(
  [
    "w-full rounded-[var(--radius-control)] border bg-surface px-3 text-sm text-text",
    "outline-none transition-colors duration-[var(--motion-fast)]",
    "placeholder:text-text-muted",
    "border-border hover:border-border-strong",
    "focus-within:border-brand focus-within:ring-2 focus-within:ring-focus",
    "group-data-[invalid]:border-danger group-data-[invalid]:focus-within:ring-danger-soft",
    "group-data-[disabled]:pointer-events-none group-data-[disabled]:opacity-50",
  ].join(" "),
  {
    variants: {
      size: {
        compact: "h-[var(--control-height-compact)]",
        standard: "h-[var(--control-height-standard)]",
      },
    },
    defaultVariants: { size: "standard" },
  },
);

export const fieldLabel = "text-sm font-medium text-text data-[disabled]:opacity-50";
export const fieldDescription = "text-xs text-text-muted";
export const fieldError = "text-xs text-danger";

export interface FieldChromeProps {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode | ((validation: { validationErrors: string[] }) => ReactNode);
  isRequired?: boolean;
  children: ReactNode;
  className?: string;
}

/** Consistent label + control + description/error stack for field
 * components. The control itself (`children`) is field-specific; this only
 * owns the surrounding chrome and vertical rhythm. */
export function FieldChrome({ label, description, errorMessage, isRequired, children, className }: FieldChromeProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label className={fieldLabel}>
          {label}
          {isRequired && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      {children}
      {description && <Text slot="description" className={fieldDescription}>{description}</Text>}
      <FieldError className={fieldError}>{errorMessage}</FieldError>
    </div>
  );
}
