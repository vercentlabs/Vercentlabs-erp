import type { ReactNode } from "react";

import { cx } from "./cx";
import styles from "./experience-kernel.module.css";

export type MetricTone = "neutral" | "info" | "success" | "warning" | "danger";

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  action,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: MetricTone;
  action?: ReactNode;
}) {
  return (
    <article
      className={cx(styles.metricCard, styles[`metricTone_${tone}`])}
      data-erp-ui="metric-card"
    >
      <div className={styles.metricTopline}>
        <span className={styles.metricLabel}>{label}</span>
        {icon ? <span className={styles.metricIcon}>{icon}</span> : null}
      </div>
      <strong className={styles.metricValue}>{value}</strong>
      {hint ? <div className={styles.metricHint}>{hint}</div> : null}
      {action ? <div className={styles.metricAction}>{action}</div> : null}
    </article>
  );
}
