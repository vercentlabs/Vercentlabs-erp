import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

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
        <div className={styles.formFieldError} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className={styles.formFieldHint}>{hint}</div>
      ) : null}
    </div>
  );
}
