import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  context,
  headingId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  context?: ReactNode;
  headingId?: string;
}) {
  return (
    <header
      className={styles.pageHeader}
      aria-labelledby={headingId}
      data-erp-ui="page-header"
    >
      <div className={styles.pageHeaderCopy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 id={headingId} className={styles.pageTitle}>
          {title}
        </h1>
        {description ? (
          <div className={styles.pageDescription}>{description}</div>
        ) : null}
      </div>
      {actions || context ? (
        <div className={styles.pageHeaderAside}>
          {context ? <div className={styles.headerContext}>{context}</div> : null}
          {actions ? <div className={styles.headerActions}>{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
