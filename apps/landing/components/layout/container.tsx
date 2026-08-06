import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/utils";

interface ContainerProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}

/** Standard content container — max-width matches CONTAINER_TOKENS.maxWidth (1600px). */
export function Container({ children, className, as: As = "div" }: ContainerProps) {
  return <As className={cx("mx-auto w-full max-w-[1600px] px-5 sm:px-6 lg:px-10", className)}>{children}</As>;
}

/** Narrower container for long-form reading content (module/workflow body copy). */
export function NarrowContainer({ children, className, as: As = "div" }: ContainerProps) {
  return <As className={cx("mx-auto w-full max-w-[760px] px-5 sm:px-6", className)}>{children}</As>;
}

interface SectionProps {
  children: ReactNode;
  className?: string;
  /** Renders the section background band; "page" is transparent (inherits page canvas). */
  tone?: "page" | "subtle" | "inverse" | "elevated";
  as?: ElementType;
  id?: string;
}

const TONE_CLASSES: Record<NonNullable<SectionProps["tone"]>, string> = {
  page: "bg-transparent",
  subtle: "bg-(--color-bg-subtle)",
  inverse: "bg-(--color-bg-inverse) text-(--color-text-inverse)",
  elevated: "bg-(--color-bg-elevated) border-y border-(--color-border-default)",
};

/** Full-bleed section band with standard vertical rhythm. */
export function Section({ children, className, tone = "page", as: As = "section", id }: SectionProps) {
  return (
    <As id={id} className={cx("py-16 sm:py-20 lg:py-24", TONE_CLASSES[tone], className)}>
      {children}
    </As>
  );
}

interface SectionHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}

export function SectionHeader({ eyebrow, title, description, align = "left", className }: SectionHeaderProps) {
  return (
    <div className={cx("max-w-[720px]", align === "center" && "mx-auto text-center", className)}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">{eyebrow}</p>
      ) : null}
      <h2 className="mt-3 text-2xl font-semibold text-(--color-text-primary) sm:text-3xl">{title}</h2>
      {description ? <p className="mt-4 text-base leading-relaxed text-(--color-text-secondary)">{description}</p> : null}
    </div>
  );
}

interface StackProps {
  children: ReactNode;
  className?: string;
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10;
  as?: ElementType;
}

const GAP_CLASSES: Record<NonNullable<StackProps["gap"]>, string> = {
  0: "gap-0",
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
};

/** Vertical layout primitive. */
export function Stack({ children, className, gap = 4, as: As = "div" }: StackProps) {
  return <As className={cx("flex flex-col", GAP_CLASSES[gap], className)}>{children}</As>;
}

/** Horizontal layout primitive that wraps at narrow widths. */
export function Inline({ children, className, gap = 3, as: As = "div" }: StackProps) {
  return <As className={cx("flex flex-row flex-wrap items-center", GAP_CLASSES[gap], className)}>{children}</As>;
}

/** Horizontal group of small, related items (tags, badges) — never wraps mid-item. */
export function Cluster({ children, className, gap = 2, as: As = "div" }: StackProps) {
  return <As className={cx("flex flex-row flex-wrap items-center content-start", GAP_CLASSES[gap], className)}>{children}</As>;
}

interface GridProps {
  children: ReactNode;
  className?: string;
  columns?: 1 | 2 | 3 | 4 | 12;
  gap?: 1 | 2 | 3 | 4 | 6 | 8 | 10;
}

const GRID_COLUMN_CLASSES: Record<NonNullable<GridProps["columns"]>, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  12: "grid-cols-12",
};

export function Grid({ children, className, columns = 3, gap = 6 }: GridProps) {
  return <div className={cx("grid", GRID_COLUMN_CLASSES[columns], GAP_CLASSES[gap], className)}>{children}</div>;
}

interface SplitLayoutProps {
  primary: ReactNode;
  secondary: ReactNode;
  className?: string;
  /** Which side gets more width when the layout is not 50/50. */
  ratio?: "even" | "primary-wide";
}

/** Two-column layout (e.g. hero copy + product screenshot) that stacks on mobile. */
export function SplitLayout({ primary, secondary, className, ratio = "even" }: SplitLayoutProps) {
  return (
    <div
      className={cx(
        "grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16",
        ratio === "primary-wide" && "lg:grid-cols-[1.2fr_1fr]",
        className,
      )}
    >
      <div>{primary}</div>
      <div>{secondary}</div>
    </div>
  );
}

interface SidebarLayoutProps {
  content: ReactNode;
  sidebar: ReactNode;
  className?: string;
}

/** Content + narrow rail layout (e.g. resource article + related-links rail). */
export function SidebarLayout({ content, sidebar, className }: SidebarLayoutProps) {
  return (
    <div className={cx("grid grid-cols-1 gap-10 lg:grid-cols-[1fr_280px]", className)}>
      <div>{content}</div>
      <aside>{sidebar}</aside>
    </div>
  );
}

/** Escapes the standard container width — for full-width product screenshots/diagrams. */
export function Bleed({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("relative left-1/2 w-screen -translate-x-1/2", className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx("border-t border-(--color-border-default)", className)} />;
}

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col bg-(--color-bg-page)">{children}</div>;
}
