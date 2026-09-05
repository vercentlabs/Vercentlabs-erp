import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import styles from "./experience-kernel.module.css";

export type SurfaceTone = "default" | "subtle" | "raised";
export type SurfacePadding = "none" | "compact" | "standard" | "spacious";

export function Surface({
  as = "section",
  tone = "default",
  padding = "standard",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  children?: ReactNode;
}) {
  const classNames = cx(
    styles.surface,
    styles[`surfaceTone_${tone}`],
    styles[`surfacePadding_${padding}`],
    className,
  );

  if (as === "article") {
    return (
      <article
        {...props}
        className={classNames}
        data-erp-ui="surface"
      >
        {children}
      </article>
    );
  }

  if (as === "div") {
    return (
      <div {...props} className={classNames} data-erp-ui="surface">
        {children}
      </div>
    );
  }

  return (
    <section {...props} className={classNames} data-erp-ui="surface">
      {children}
    </section>
  );
}
