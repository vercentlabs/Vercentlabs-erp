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
  display: "text-[clamp(3.35rem,7vw,6.9rem)] font-semibold leading-[0.91] tracking-[-0.068em] text-balance",
  h1: "text-[clamp(2.6rem,5vw,4.9rem)] font-semibold leading-[0.95] tracking-[-0.062em] text-balance",
  h2: "text-[clamp(2.05rem,3.5vw,3.6rem)] font-semibold leading-[0.99] tracking-[-0.058em] text-balance",
  h3: "text-[clamp(1.35rem,2vw,2rem)] font-semibold leading-[1.1] tracking-[-0.04em] text-balance",
  h4: "text-base font-semibold leading-tight tracking-[-0.025em]",
};

interface HeadingProps {
  level: HeadingLevel;
  children: ReactNode;
  className?: string;
  id?: string;
  as?: ElementType;
  tabIndex?: number;
}

export const Heading = forwardRef(function Heading(
  { level, children, className, id, as, tabIndex }: HeadingProps,
  ref: Ref<HTMLElement>,
) {
  const As = as ?? HEADING_TAG[level];
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
  lead: "max-w-[66ch] text-[1.08rem] leading-[1.72] text-(--color-text-secondary) sm:text-xl sm:leading-[1.68]",
  bodyLarge: "text-lg leading-[1.72] text-(--color-text-primary)",
  body: "text-base leading-[1.72] text-(--color-text-primary)",
  bodySmall: "text-sm leading-[1.68] text-(--color-text-secondary)",
  label: "text-sm font-semibold tracking-[-0.01em] text-(--color-text-primary)",
  eyebrow: "vl-kicker",
  navigation: "text-sm font-semibold tracking-[-0.01em] text-(--color-text-primary)",
  dataValue: "tabular-data text-3xl font-semibold leading-none tracking-[-0.055em] text-(--color-text-primary)",
  dataLabel: "text-[0.67rem] font-bold uppercase tracking-[0.14em] text-(--color-text-muted)",
  caption: "text-[0.72rem] leading-relaxed tracking-[0.015em] text-(--color-text-muted)",
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
        "rounded-[3px] border border-(--color-border-default) bg-(--color-bg-elevated) px-1.5 py-0.5 font-mono text-[0.85em] text-(--color-text-brand)",
        className,
      )}
    >
      {children}
    </code>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "max-w-[72ch] text-[1.02rem] leading-[1.82] text-(--color-text-primary)",
        "[&>p]:mt-5 [&>p:first-child]:mt-0",
        "[&>h2]:mt-14 [&>h2]:border-t [&>h2]:border-(--color-border-default) [&>h2]:pt-8 [&>h2]:text-3xl [&>h2]:font-semibold [&>h2]:tracking-[-0.05em]",
        "[&>h3]:mt-10 [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:tracking-[-0.035em]",
        "[&>ul]:mt-5 [&>ul]:list-disc [&>ul]:space-y-2 [&>ul]:pl-6",
        "[&_a]:text-(--color-text-link) [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
