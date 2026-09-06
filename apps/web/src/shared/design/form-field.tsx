import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

/**
 * Derives FormField's error/hint element id from a field's htmlFor so a
 * caller's own input can be wired up with aria-describedby (FormField
 * receives the input as an opaque `children` node and so cannot inject the
 * attribute itself): `aria-describedby={error ? describedById(htmlFor, "error") : hint ? describedById(htmlFor, "hint") : undefined}`.
 */
export function describedById(htmlFor: string, kind: "error" | "hint") {
  return `${htmlFor}-${kind}`;
}

export function FormField({
  label,
  htmlFor,
  children,
  hint,
  error,
  required,
}: {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}) {
  return (
    <div className={styles.formField} data-erp-ui="form-field">
      <label htmlFor={htmlFor} className={styles.formFieldLabel}>
        <span>{label}</span>
        {required ? <span className={styles.requiredMark} aria-hidden="true">Required</span> : null}
      </label>
      {children}
      {error ? (
        <div
          id={describedById(htmlFor, "error")}
          className={styles.formFieldError}
          role="alert"
        >
          {error}
        </div>
      ) : hint ? (
        <div id={describedById(htmlFor, "hint")} className={styles.formFieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
