import Image from "next/image";
import type { ReactNode } from "react";
import { cx } from "@/lib/utils";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { Reveal } from "@/components/motion/reveal";

/**
 * Thin, plain-chrome frame — deliberately NOT a fake browser/OS window (Control
 * Surface explicitly rejects "fake dashboard illustrations" and skeuomorphic
 * window furniture; see docs/landing-redesign/phase-1/creative-direction.md).
 * A single ProductFrame covers what the brief's "BrowserFrame"/"AppFrame" would
 * have been — there is no visual difference to justify two components.
 */
export function ProductFrame({
  children,
  moduleAccentColor,
  caption,
  className,
}: {
  children: ReactNode;
  moduleAccentColor?: string;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={cx("overflow-hidden rounded-(--radius-panel) border border-(--color-product-frame) bg-(--color-product-canvas) shadow-(--shadow-panel)", className)}>
      <div className="h-1" style={{ backgroundColor: moduleAccentColor ?? "var(--color-brand)" }} aria-hidden="true" />
      <div className="relative">{children}</div>
      {caption ? (
        <figcaption className="border-t border-(--color-product-frame) bg-(--color-product-chrome) px-4 py-2.5 text-xs text-(--color-text-muted)">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

interface ProductScreenshotProps {
  id: string;
  moduleAccentColor?: string;
  className?: string;
  /** Only true on the noindex /design-system route — see lib/product/screenshots.ts. */
  allowPlaceholder?: boolean;
  /**
   * Set only where a real Lighthouse run confirmed this exact screenshot is
   * the route's LCP element (see docs/landing-redesign/phase-7/
   * media-performance-audit.md) — currently just PlatformHero's hero
   * screenshot. Defaults to lazy-loading, which is correct everywhere else
   * (e.g. product-evidence-section.tsx's below-the-fold screenshots).
   */
  priority?: boolean;
}

/**
 * Renders a real, approved product screenshot. If none is approved for this id,
 * renders nothing on public pages (per the brief: "if no approved screenshot
 * exists, the public component should render nothing or an honest controlled
 * fallback"). The fallback itself is only shown when `allowPlaceholder` is set,
 * which only the /design-system review route does.
 */
export function ProductScreenshot({ id, moduleAccentColor, className, allowPlaceholder = false, priority = false }: ProductScreenshotProps) {
  const screenshot = getApprovedScreenshot(id);

  if (!screenshot) {
    if (!allowPlaceholder) return null;
    return (
      <ProductFrame moduleAccentColor={moduleAccentColor} caption="No approved screenshot yet — placeholder shown on /design-system only" className={className}>
        <div className="flex aspect-[16/10] items-center justify-center bg-(--color-product-chrome) text-sm text-(--color-text-muted)">
          Screenshot pending approval
        </div>
      </ProductFrame>
    );
  }

  return (
    <ProductFrame moduleAccentColor={moduleAccentColor} caption={screenshot.caption} className={className}>
      <Image
        src={screenshot.src}
        alt={screenshot.alt}
        width={screenshot.width}
        height={screenshot.height}
        className="h-auto w-full"
        sizes="(min-width: 1024px) 800px, 100vw"
        priority={priority}
      />
    </ProductFrame>
  );
}

interface CalloutProps {
  number: number;
  label: string;
  className?: string;
}

/** Numbered callout marker — always paired with a visible text label, never colour-only. */
export function ProductCallout({ number, label, className }: CalloutProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-(--radius-control) border border-(--color-border-brand) bg-(--color-bg-elevated) px-2.5 py-1.5 text-xs font-medium text-(--color-text-brand)",
        className,
      )}
    >
      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-(--color-bg-brand) text-[10px] font-semibold text-(--color-text-inverse)" aria-hidden="true">
        {number}
      </span>
      {label}
    </span>
  );
}

export interface WorkflowStep {
  label: string;
  accentColor: string;
  href?: string;
}

/**
 * Horizontal, module-coloured pipeline — the Control Surface way to show
 * cross-module workflows. Reveal remains the default, while callers rendering
 * the connector inside another structured surface can opt out for an always-
 * visible, motion-independent diagram.
 */
export function WorkflowConnector({ steps, className, reveal = true }: { steps: WorkflowStep[]; className?: string; reveal?: boolean }) {
  // Stays stacked through tablet width so a long workflow never gets cramped.
  const connector = (
    <ol className={cx("flex flex-col gap-3 md:flex-row md:items-stretch md:justify-between md:gap-0", className)}>
      {steps.map((step, index) => {
        const delay = `${Math.min(index, 4) * 60}ms`;
        return (
          <li
            key={step.label}
            data-reveal-item={reveal ? "" : undefined}
            style={reveal ? { transitionDelay: delay } : undefined}
            className="flex flex-1 items-center gap-3 md:flex-none md:flex-col md:items-stretch md:gap-0"
          >
            <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-2">
              <span
                className="flex h-8 w-8 flex-none items-center justify-center rounded-(--radius-control) text-xs font-semibold text-(--color-text-inverse)"
                style={{ backgroundColor: step.accentColor }}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="text-sm font-medium text-(--color-text-primary)">{step.label}</span>
            </div>
            {/* Renders for every step including the last: it's a per-item marker (a row
                divider below `md`, a small tick beside/under each node at `md` and up),
                not a literal line connecting to the next node — so omitting it only for
                the last step just made that one item look broken/inconsistent with its
                siblings rather than signalling "end of chain". `wf-connector-line`
                (globals.css) draws it in on the same delay as this item's own reveal,
                so the node and "its" segment of line arrive together. */}
            <span
              className="wf-connector-line mx-2 h-px flex-1 bg-(--color-border-default) md:my-3 md:ml-4 md:h-8 md:w-px md:flex-none"
              style={{ transitionDelay: reveal ? delay : undefined, transform: reveal ? undefined : "none" }}
              aria-hidden="true"
            />
          </li>
        );
      })}
    </ol>
  );

  return reveal ? <Reveal group>{connector}</Reveal> : connector;
}
