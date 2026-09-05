import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

export function FormSection({
  title,
  description,
  children,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.formSection} disabled={disabled} data-erp-ui="form-section">
      <legend>{title}</legend>
      {description ? <p className={styles.formSectionDescription}>{description}</p> : null}
      <div className={styles.formGrid}>{children}</div>
    </fieldset>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className={styles.formActions} data-erp-ui="form-actions">
      {children}
    </div>
  );
}
