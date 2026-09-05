import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import { Surface } from "./surface";
import styles from "./convergence-boundary.module.css";

export type ConvergenceArea = "module" | "platform";

export function ConvergenceBoundary({
  area,
  className,
  children,
}: {
  area: ConvergenceArea;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Surface
      as="div"
      tone="subtle"
      padding="none"
      className={cx(styles.boundary, styles[area], className)}
      data-erp-convergence={area}
    >
      {children}
    </Surface>
  );
}

export function ShellBoundary({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...props}
      className={cx(styles.shell, className)}
      data-erp-convergence="shell"
    >
      {children}
    </div>
  );
}
