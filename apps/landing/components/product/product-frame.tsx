import Image from "next/image";
import type { ReactNode } from "react";
import { cx } from "@/lib/utils";
import { getApprovedScreenshot } from "@/lib/product/screenshots";

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
}

/**
 * Renders a real, approved product screenshot. If none is approved for this id,
 * renders nothing on public pages (per the brief: "if no approved screenshot
 * exists, the public component should render nothing or an honest controlled
 * fallback"). The fallback itself is only shown when `allowPlaceholder` is set,
 * which only the /design-system review route does.
 */
export function ProductScreenshot({ id, moduleAccentColor, className, allowPlaceholder = false }: ProductScreenshotProps) {
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
        "inline-flex items-center gap-1.5 rounded-(--radius-control) border border-(--color-border-brand) bg-(--color-bg-elevated) px-2 py-1 text-xs font-medium text-(--color-text-brand)",
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

/** Horizontal, module-coloured pipeline — the Control Surface way to show cross-module workflows. */
export function WorkflowConnector({ steps, className }: { steps: WorkflowStep[]; className?: string }) {
  return (
    <ol className={cx("flex flex-col gap-0 sm:flex-row sm:items-stretch", className)}>
      {steps.map((step, index) => (
        <li key={step.label} className="flex flex-1 items-center gap-3 sm:flex-col sm:items-stretch sm:gap-0">
          <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-(--radius-control) text-xs font-semibold text-(--color-text-inverse)"
              style={{ backgroundColor: step.accentColor }}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="text-sm font-medium text-(--color-text-primary)">{step.label}</span>
          </div>
          {index < steps.length - 1 ? (
            <span className="mx-2 h-px flex-1 bg-(--color-border-default) sm:my-3 sm:ml-4 sm:h-8 sm:w-px sm:flex-none" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
