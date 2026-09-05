import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

import { cx } from "./cx";
import styles from "./experience-kernel.module.css";

export type ActionTone = "primary" | "secondary" | "quiet" | "danger";
export type ActionSize = "compact" | "standard";

function actionClassName(
  tone: ActionTone,
  size: ActionSize,
  className?: string,
) {
  return cx(
    styles.action,
    styles[`actionTone_${tone}`],
    styles[`actionSize_${size}`],
    className,
  );
}

export function ActionButton({
  tone = "secondary",
  size = "standard",
  busy = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  size?: ActionSize;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={actionClassName(tone, size, className)}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-erp-ui="action-button"
    >
      {children}
    </button>
  );
}

export function ActionLink({
  href,
  tone = "secondary",
  size = "standard",
  className,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  tone?: ActionTone;
  size?: ActionSize;
  children: ReactNode;
}) {
  return (
    <Link
      {...props}
      href={href}
      className={actionClassName(tone, size, className)}
      data-erp-ui="action-link"
    >
      {children}
    </Link>
  );
}
