
import { Children, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "@/lib/utils";

interface ContainerProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}

/** Standard content container — max-width matches CONTAINER_TOKENS.maxWidth (1600px). */
export function Container({ children, className, as: As = "div" }: ContainerProps) {
  return <As className={cx("mx-auto w-full max-w-[1480px] px-5 sm:px-7 lg:px-12 xl:px-14", className)}>{children}</As>;
}

/** Narrower container for long-form reading content (module/workflow body copy). */
export function NarrowContainer({ children, className, as: As = "div" }: ContainerProps) {
  return <As className={cx("mx-auto w-full max-w-[820px] px-5 sm:px-7", className)}>{children}</As>;
}

/**
 * Discrete Tailwind spacing values Section's padding props accept. Kept as a fixed
 * set (not an arbitrary number) so every class this component can emit is a
 * complete literal string somewhere below — Tailwind's build-time scanner can only
 * discover classes it can see spelled out in source, not ones assembled at runtime
 * via `pt-${n}` string interpolation.
 */
export type SectionSpacing = 0 | 6 | 7 | 8 | 9 | 10 | 12 | 14 | 16 | 18 | 20 | 24;

/** A padding value that can grow at wider breakpoints; unset tiers fall back to the previous one. */
export interface ResponsiveSpacing {
  base: SectionSpacing;
  sm?: SectionSpacing;
  lg?: SectionSpacing;
}

const PADDING_TOP_CLASSES: Record<SectionSpacing, string> = {
  0: "pt-0", 6: "pt-6", 7: "pt-7", 8: "pt-8", 9: "pt-9", 10: "pt-10", 12: "pt-12", 14: "pt-14", 16: "pt-16", 18: "pt-18", 20: "pt-20", 24: "pt-24",
};
const PADDING_TOP_SM_CLASSES: Record<SectionSpacing, string> = {
  0: "sm:pt-0", 6: "sm:pt-6", 7: "sm:pt-7", 8: "sm:pt-8", 9: "sm:pt-9", 10: "sm:pt-10", 12: "sm:pt-12", 14: "sm:pt-14", 16: "sm:pt-16", 18: "sm:pt-18", 20: "sm:pt-20", 24: "sm:pt-24",
};
const PADDING_TOP_LG_CLASSES: Record<SectionSpacing, string> = {
  0: "lg:pt-0", 6: "lg:pt-6", 7: "lg:pt-7", 8: "lg:pt-8", 9: "lg:pt-9", 10: "lg:pt-10", 12: "lg:pt-12", 14: "lg:pt-14", 16: "lg:pt-16", 18: "lg:pt-18", 20: "lg:pt-20", 24: "lg:pt-24",
};
const PADDING_BOTTOM_CLASSES: Record<SectionSpacing, string> = {
  0: "pb-0", 6: "pb-6", 7: "pb-7", 8: "pb-8", 9: "pb-9", 10: "pb-10", 12: "pb-12", 14: "pb-14", 16: "pb-16", 18: "pb-18", 20: "pb-20", 24: "pb-24",
};
const PADDING_BOTTOM_SM_CLASSES: Record<SectionSpacing, string> = {
  0: "sm:pb-0", 6: "sm:pb-6", 7: "sm:pb-7", 8: "sm:pb-8", 9: "sm:pb-9", 10: "sm:pb-10", 12: "sm:pb-12", 14: "sm:pb-14", 16: "sm:pb-16", 18: "sm:pb-18", 20: "sm:pb-20", 24: "sm:pb-24",
};
const PADDING_BOTTOM_LG_CLASSES: Record<SectionSpacing, string> = {
  0: "lg:pb-0", 6: "lg:pb-6", 7: "lg:pb-7", 8: "lg:pb-8", 9: "lg:pb-9", 10: "lg:pb-10", 12: "lg:pb-12", 14: "lg:pb-14", 16: "lg:pb-16", 18: "lg:pb-18", 20: "lg:pb-20", 24: "lg:pb-24",
};

const DEFAULT_SECTION_PADDING: ResponsiveSpacing = { base: 16, sm: 20, lg: 24 };

/**
 * Always emits all three breakpoint tiers explicitly (filling forward from the most
 * specific value given), so there's never a wider, unset breakpoint left pointing at
 * some other default class competing for the same CSS property. That's what caused
 * a real, confirmed bug: a plain `pt-8` override was silently losing to the
 * component's own `lg:py-24` default at desktop widths, because Tailwind places
 * `@media` breakpoint rules after plain utility rules in the generated stylesheet —
 * so the base class always won regardless of source/className order. See
 * docs/landing-redesign/phase-8/decision-log.md.
 */
function paddingClassName(side: "top" | "bottom", spacing: ResponsiveSpacing): string {
  const sm = spacing.sm ?? spacing.base;
  const lg = spacing.lg ?? sm;
  const [BASE, SM, LG] =
    side === "top"
      ? [PADDING_TOP_CLASSES, PADDING_TOP_SM_CLASSES, PADDING_TOP_LG_CLASSES]
      : [PADDING_BOTTOM_CLASSES, PADDING_BOTTOM_SM_CLASSES, PADDING_BOTTOM_LG_CLASSES];
  return cx(BASE[spacing.base], SM[sm], LG[lg]);
}

interface SectionProps {
  children: ReactNode;
  className?: string;
  /** Renders the section background band; "page" is transparent (inherits page canvas). */
  tone?: "page" | "subtle" | "inverse" | "elevated" | "brand";
  as?: ElementType;
  id?: string;
  /** Overrides the default `{ base: 16, sm: 20, lg: 24 }` vertical rhythm for this edge only. */
  paddingTop?: ResponsiveSpacing;
  paddingBottom?: ResponsiveSpacing;
}

const TONE_CLASSES: Record<NonNullable<SectionProps["tone"]>, string> = {
  page: "bg-transparent",
  subtle: "bg-(--color-bg-subtle)",
  inverse: "vl-night-grid bg-(--color-bg-inverse) text-(--color-text-inverse)",
  elevated: "bg-(--color-bg-elevated)",
  brand: "bg-(--color-bg-brand) text-white",
};

/** Full-bleed section band with standard vertical rhythm. */
export function Section({ children, className, tone = "page", as: As = "section", id, paddingTop, paddingBottom }: SectionProps) {
  return (
    <As
      id={id}
      className={cx(
        paddingClassName("top", paddingTop ?? DEFAULT_SECTION_PADDING),
        paddingClassName("bottom", paddingBottom ?? DEFAULT_SECTION_PADDING),
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </As>
  );
}

interface SectionHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  /** Use inside split-column layouts where the full-width editorial grid would be too wide. */
  compact?: boolean;
  className?: string;
}

export function SectionHeader({ eyebrow, title, description, align = "left", compact = false, className }: SectionHeaderProps) {
  if (align === "center") {
    return (
      <div className={cx("mx-auto max-w-[900px] text-center", className)}>
        {eyebrow ? <p className="vl-kicker justify-center before:hidden">{eyebrow}</p> : null}
        <h2 className="mt-5 text-[clamp(2rem,4vw,4rem)] font-semibold leading-[1] tracking-[-0.06em] text-(--color-text-primary)">{title}</h2>
        {description ? <p className="mx-auto mt-5 max-w-[68ch] text-base leading-[1.75] text-(--color-text-secondary)">{description}</p> : null}
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cx("border-t border-(--color-border-strong) pt-4", className)}>
        {eyebrow ? <p className="vl-kicker">{eyebrow}</p> : null}
        <h2 className="mt-5 max-w-[16ch] text-[clamp(2.1rem,3vw,3.25rem)] font-semibold leading-[1] tracking-[-0.055em] text-(--color-text-primary)">{title}</h2>
        {description ? <p className="mt-5 max-w-[52ch] text-[0.98rem] leading-[1.72] text-(--color-text-secondary)">{description}</p> : null}
      </div>
    );
  }

  return (
    <div className={cx("grid grid-cols-1 gap-5 border-t border-(--color-border-strong) pt-4 lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-12", className)}>
      <div>{eyebrow ? <p className="vl-kicker">{eyebrow}</p> : null}</div>
      <div className={cx("grid min-w-0 gap-5", description ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)] xl:gap-12" : "max-w-[900px]")}>
        <h2 className="max-w-[18ch] text-[clamp(2.1rem,4vw,4.15rem)] font-semibold leading-[0.99] tracking-[-0.061em] text-(--color-text-primary)">{title}</h2>
        {description ? <p className="max-w-[64ch] self-end text-[0.98rem] leading-[1.72] text-(--color-text-secondary)">{description}</p> : null}
      </div>
    </div>
  );
}

interface StackProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
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
export function Stack({ children, className, gap = 4, as: As = "div", ...rest }: StackProps) {
  return (
    <As className={cx("flex flex-col", GAP_CLASSES[gap], className)} {...rest}>
      {children}
    </As>
  );
}

/** Horizontal layout primitive that wraps at narrow widths. */
export function Inline({ children, className, gap = 3, as: As = "div", ...rest }: StackProps) {
  return (
    <As className={cx("flex flex-row flex-wrap items-center", GAP_CLASSES[gap], className)} {...rest}>
      {children}
    </As>
  );
}

/** Horizontal group of small, related items (tags, badges) — never wraps mid-item. */
export function Cluster({ children, className, gap = 2, as: As = "div", ...rest }: StackProps) {
  return (
    <As className={cx("flex flex-row flex-wrap items-center content-start", GAP_CLASSES[gap], className)} {...rest}>
      {children}
    </As>
  );
}

interface GridProps {
  children: ReactNode;
  className?: string;
  columns?: 1 | 2 | 3 | 4 | 12;
  gap?: 1 | 2 | 3 | 4 | 6 | 8 | 10;
  /** Arms each item as a `data-reveal-item` (capped, staggered transitionDelay)
   *  for a `<Reveal group>` ancestor to trigger — see components/motion/reveal.tsx.
   *  Default false: every existing call site is visually unchanged until opted in. */
  reveal?: boolean;
}

/**
 * Every Grid sits on one persistent 12-column track (grid-cols-12), at every
 * breakpoint — "columns" no longer changes the number of tracks, it just changes how
 * many of the 12 each child spans. That's what makes a 2-column Grid on one page and
 * a 4-column Grid elsewhere on the same page (or a different page entirely, since
 * Container's width is identical everywhere) share the exact same underlying column
 * boundaries, instead of each independently computing its own equal-width fractions
 * that only coincidentally lined up. The responsive progression (1 col on mobile, 2
 * on tablet, N on desktop) is preserved — it's just expressed as a span that changes
 * per breakpoint instead of a track count that changes.
 */
const GRID_ITEM_SPAN_CLASSES: Record<NonNullable<GridProps["columns"]>, string> = {
  1: "col-span-12",
  2: "col-span-12 sm:col-span-6",
  // md: tier added so 3- and 4-up grids don't stay stuck 2-across from 480px
  // all the way to 1024px ("2-column purgatory" spanning tablet width) —
  // see tests/e2e/mobile-conversion.spec.ts for the overflow regression test
  // this must keep passing.
  3: "col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-4",
  4: "col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-3",
  12: "col-span-12 sm:col-span-1",
};

/**
 * Grid-only gap scale (not GAP_CLASSES, which Stack/Inline/Cluster also use and
 * doesn't have this failure mode). A grid item spanning N tracks has a hard
 * minimum width of (N-1) x gap, because minmax(0,1fr) lets the tracks
 * themselves shrink to 0 but the fixed-px gaps between them cannot — at
 * gap-10 a col-span-12 item has an unshrinkable 11 x 40px = 440px floor,
 * which is wider than every phone viewport this site supports and forces
 * real, confirmed horizontal body overflow (see
 * tests/e2e/mobile-conversion.spec.ts and the Prompt 16 UI/UX audit, bug
 * LAND-001). Scaling the gap down until there's room for the full value
 * keeps that floor under the viewport at every tier.
 */
const GRID_GAP_CLASSES: Record<NonNullable<GridProps["gap"]>, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  6: "gap-4 sm:gap-6",
  8: "gap-4 sm:gap-6 lg:gap-8",
  10: "gap-4 sm:gap-6 lg:gap-10",
};

export function Grid({ children, className, columns = 3, gap = 6, reveal = false }: GridProps) {
  return (
    <div className={cx("grid grid-cols-12", GRID_GAP_CLASSES[gap], className)}>
      {Children.map(children, (child, index) => (
        <div
          className={GRID_ITEM_SPAN_CLASSES[columns]}
          data-reveal-item={reveal ? "" : undefined}
          style={reveal ? { transitionDelay: `${Math.min(index, 4) * 60}ms` } : undefined}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

interface SplitLayoutProps {
  primary: ReactNode;
  secondary: ReactNode;
  className?: string;
  /** Which side gets more width when the layout is not 50/50. */
  ratio?: "even" | "primary-wide";
}

/**
 * Two-column layout (e.g. hero copy + product screenshot) that stacks on mobile —
 * on the same persistent 12-column track as Grid (see its comment), so a hero split
 * 7/5 lines up with a 2-column Grid's 6/6 boundary and a 4-column Grid's 3/3/3/3
 * boundaries elsewhere on the page, instead of each computing independent fractions.
 */
export function SplitLayout({ primary, secondary, className, ratio = "even" }: SplitLayoutProps) {
  const [primarySpan, secondarySpan] = ratio === "primary-wide" ? ["lg:col-span-7", "lg:col-span-5"] : ["lg:col-span-6", "lg:col-span-6"];
  return (
    <div className={cx("grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14 xl:gap-20", className)}>
      <div className={primarySpan}>{primary}</div>
      <div className={secondarySpan}>{secondary}</div>
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
    <div className={cx("grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-16", className)}>
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
