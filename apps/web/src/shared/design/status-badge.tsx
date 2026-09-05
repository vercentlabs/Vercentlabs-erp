import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import styles from "./experience-kernel.module.css";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function StatusBadge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      {...props}
      className={cx(styles.statusBadge, styles[`statusTone_${tone}`], className)}
      data-erp-ui="status-badge"
    >
      {children}
    </span>
  );
}
