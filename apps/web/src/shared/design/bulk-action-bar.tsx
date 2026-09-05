import type { ReactNode } from "react";

import styles from "./experience-kernel.module.css";

export function BulkActionBar({
  selectedCount,
  children,
  clearAction,
}: {
  selectedCount: number;
  children: ReactNode;
  clearAction?: ReactNode;
}) {
  if (selectedCount <= 0) return null;

  return (
    <div
      className={styles.bulkActionBar}
      role="region"
      aria-label={`${selectedCount} selected record${selectedCount === 1 ? "" : "s"}`}
      data-erp-ui="bulk-action-bar"
    >
      <strong>
        {selectedCount} selected
      </strong>
      <div className={styles.bulkActions}>{children}</div>
      {clearAction ? <div className={styles.bulkClear}>{clearAction}</div> : null}
    </div>
  );
}
