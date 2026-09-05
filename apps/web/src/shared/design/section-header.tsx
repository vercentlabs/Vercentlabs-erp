import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  headingId,
  level = 2,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingId?: string;
  level?: 2 | 3;
}) {
  const heading =
    level === 3 ? (
      <h3 id={headingId} className={styles.sectionTitle}>
        {title}
      </h3>
    ) : (
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
    );

  return (
    <header className={styles.sectionHeader} data-erp-ui="section-header">
      <div>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        {heading}
        {description ? (
          <div className={styles.sectionDescription}>{description}</div>
        ) : null}
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}
