import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

export function FilterBar({
  children,
  actions,
  summary,
  label = "Filter records",
}: {
  children: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  label?: string;
}) {
  return (
    <div className={styles.filterBar} aria-label={label} data-erp-ui="filter-bar">
      <div className={styles.filterControls}>{children}</div>
      {summary || actions ? (
        <div className={styles.filterAside}>
          {summary ? <div className={styles.filterSummary}>{summary}</div> : null}
          {actions ? <div className={styles.filterActions}>{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
