import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

export function RecordHeader({
  eyebrow,
  title,
  subtitle,
  status,
  metadata,
  actions,
  headingId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  headingId?: string;
}) {
  return (
    <header
      className={styles.recordHeader}
      aria-labelledby={headingId}
      data-erp-ui="record-header"
    >
      <div className={styles.recordHeaderMain}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <div className={styles.recordTitleRow}>
          <h1 id={headingId} className={styles.recordTitle}>
            {title}
          </h1>
          {status ? <div className={styles.recordStatus}>{status}</div> : null}
        </div>
        {subtitle ? <div className={styles.recordSubtitle}>{subtitle}</div> : null}
        {metadata ? <div className={styles.recordMetadata}>{metadata}</div> : null}
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}
