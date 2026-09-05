import type { ReactNode } from "react";

import { cx } from "./cx";
import styles from "./experience-kernel.module.css";

export type StateTone = "neutral" | "info" | "warning" | "danger";

export function StatePanel({
  title,
  description,
  action,
  icon,
  tone = "neutral",
  role = "status",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: StateTone;
  role?: "status" | "alert";
}) {
  return (
    <div
      className={cx(styles.statePanel, styles[`stateTone_${tone}`])}
      role={role}
      data-erp-ui="state-panel"
    >
      {icon ? <div className={styles.stateIcon}>{icon}</div> : null}
      <div className={styles.stateCopy}>
        <strong>{title}</strong>
        {description ? <div>{description}</div> : null}
      </div>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}

export function EmptyState(props: Omit<Parameters<typeof StatePanel>[0], "tone">) {
  return <StatePanel {...props} tone="neutral" />;
}

export function ErrorState(props: Omit<Parameters<typeof StatePanel>[0], "tone" | "role">) {
  return <StatePanel {...props} tone="danger" role="alert" />;
}

export function PermissionState(props: Omit<Parameters<typeof StatePanel>[0], "tone">) {
  return <StatePanel {...props} tone="warning" />;
}

export function ConflictState(props: Omit<Parameters<typeof StatePanel>[0], "tone" | "role">) {
  return <StatePanel {...props} tone="warning" role="alert" />;
}

export function LoadingState({ label = "Loading…" }: { label?: ReactNode }) {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite" data-erp-ui="loading-state">
      <span className={styles.loadingPulse} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
