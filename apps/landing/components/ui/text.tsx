import { forwardRef, type ElementType, type ReactNode, type Ref } from "react";
import { cx } from "@/lib/utils";

type HeadingLevel = "display" | "h1" | "h2" | "h3" | "h4";

const HEADING_TAG: Record<HeadingLevel, ElementType> = {
  display: "h1",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
};

const HEADING_CLASSES: Record<HeadingLevel, string> = {
  display: "text-4xl font-semibold tracking-[-0.045em] sm:text-5xl lg:text-6xl",
  h1: "text-3xl font-semibold tracking-[-0.045em] sm:text-4xl",
  h2: "text-2xl font-semibold tracking-[-0.04em] sm:text-3xl",
  h3: "text-xl font-semibold tracking-[-0.03em]",
  h4: "text-base font-semibold tracking-[-0.02em]",
};

interface HeadingProps {
  level: HeadingLevel;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Override the rendered tag without changing the visual style (e.g. a "display" styled h2). */
  as?: ElementType;
  tabIndex?: number;
}

export const Heading = forwardRef(function Heading(
  { level, children, className, id, as, tabIndex }: HeadingProps,
  ref: Ref<HTMLElement>,
) {
  const As = as ?? HEADING_TAG[level];
  // No hardcoded default color here: `body` already sets color: var(--color-text-primary)
  // globally (app/globals.css), so headings inherit it for free. Baking the same utility
  // class in here too would sit alongside any caller-supplied color override (e.g.
  // text-(--color-text-inverse) on dark sections) with identical specificity — which one
  // wins is then decided by Tailwind's generated stylesheet order, not by this component,
  // and was silently losing to the hardcoded default, making inverse-toned headings
  // invisible against dark backgrounds.
  return (
    <As ref={ref} id={id} tabIndex={tabIndex} className={cx(HEADING_CLASSES[level], className)}>
      {children}
    </As>
  );
});

type TextVariant =
  | "lead"
  | "bodyLarge"
  | "body"
  | "bodySmall"
  | "label"
  | "eyebrow"
  | "navigation"
  | "dataValue"
  | "dataLabel"
  | "caption";

const TEXT_CLASSES: Record<TextVariant, string> = {
  lead: "text-lg leading-relaxed text-(--color-text-secondary) sm:text-xl",
  bodyLarge: "text-lg leading-relaxed text-(--color-text-primary)",
  body: "text-base leading-relaxed text-(--color-text-primary)",
  bodySmall: "text-sm leading-relaxed text-(--color-text-secondary)",
  label: "text-sm font-medium text-(--color-text-primary)",
  eyebrow: "text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)",
  navigation: "text-sm font-medium text-(--color-text-primary)",
  dataValue: "tabular-data text-2xl font-semibold tracking-[-0.02em] text-(--color-text-primary)",
  dataLabel: "text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)",
  caption: "text-xs text-(--color-text-muted)",
};

interface TextProps {
  variant?: TextVariant;
  children: ReactNode;
  className?: string;
  as?: ElementType;
  role?: string;
}

export function Text({ variant = "body", children, className, as, role }: TextProps) {
  const As = as ?? (variant === "label" ? "span" : "p");
  return (
    <As role={role} className={cx(TEXT_CLASSES[variant], className)}>
      {children}
    </As>
  );
}

export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cx(
        "rounded-(--radius-control) bg-(--color-bg-subtle) px-1.5 py-0.5 font-mono text-[0.85em] text-(--color-text-brand)",
        className,
      )}
    >
      {children}
    </code>
  );
}

/** Long-form marketing/article copy — applies consistent spacing to nested block elements. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "max-w-[70ch] text-base leading-relaxed text-(--color-text-primary)",
        "[&>p]:mt-4 [&>p:first-child]:mt-0",
        "[&>h2]:mt-10 [&>h2]:text-2xl [&>h2]:font-semibold",
        "[&>h3]:mt-8 [&>h3]:text-xl [&>h3]:font-semibold",
        "[&>ul]:mt-4 [&>ul]:list-disc [&>ul]:pl-6",
        "[&_a]:text-(--color-text-link) [&_a]:underline [&_a]:underline-offset-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
