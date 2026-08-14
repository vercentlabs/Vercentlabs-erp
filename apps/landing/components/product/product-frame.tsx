import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/utils";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { Reveal } from "@/components/motion/reveal";

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
    <figure className={cx("bg-(--color-product-canvas)", className)}>
      <div className="flex items-center justify-between border-y border-(--color-product-frame) py-2.5">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5" style={{ backgroundColor: moduleAccentColor ?? "var(--color-brand)" }} aria-hidden="true" />
          <span className="text-[0.61rem] font-bold uppercase tracking-[0.14em] text-(--color-text-muted)">Live product evidence</span>
        </div>
        <span className="vl-index">VERCENTLABS ERP</span>
      </div>
      <div className="relative mt-3 overflow-hidden border border-(--color-product-frame) bg-(--color-product-canvas)">{children}</div>
      {caption ? (
        <figcaption className="grid grid-cols-[auto_1fr] gap-4 border-b border-(--color-product-frame) py-3 text-[0.69rem] leading-relaxed text-(--color-text-muted)">
          <span className="font-bold uppercase tracking-[0.11em] text-(--color-text-brand)">Evidence</span>
          <span>{caption}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

interface ProductScreenshotProps {
  id: string;
  moduleAccentColor?: string;
  className?: string;
  allowPlaceholder?: boolean;
  priority?: boolean;
}

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
        sizes="(min-width: 1024px) 1100px, 100vw"
        priority={priority}
      />
    </ProductFrame>
  );
}

interface CalloutProps { number: number; label: string; className?: string; }

export function ProductCallout({ number, label, className }: CalloutProps) {
  return (
    <span className={cx("inline-grid grid-cols-[1.7rem_1fr] items-center border-y border-(--color-border-strong) bg-(--color-bg-elevated) text-xs font-semibold text-(--color-text-primary)", className)}>
      <span className="flex h-7 items-center justify-center border-r border-(--color-border-strong) bg-(--color-bg-brand) text-[0.65rem] font-bold text-white" aria-hidden="true">{String(number).padStart(2, "0")}</span>
      <span className="px-2.5">{label}</span>
    </span>
  );
}

export interface WorkflowStep { label: string; accentColor: string; href?: string; }

export function WorkflowConnector({ steps, className, reveal = true }: { steps: WorkflowStep[]; className?: string; reveal?: boolean }) {
  const connector = (
    <ol className={cx("grid grid-cols-1 border-y border-(--color-border-default) md:grid-cols-[repeat(var(--workflow-count),minmax(0,1fr))]", className)} style={{ "--workflow-count": steps.length } as CSSProperties}>
      {steps.map((step, index) => {
        const delay = `${Math.min(index, 4) * 60}ms`;
        return (
          <li key={step.label} data-reveal-item={reveal ? "" : undefined} style={reveal ? { transitionDelay: delay } : undefined} className="relative grid min-h-20 grid-cols-[2.4rem_1fr] items-center gap-3 border-b border-(--color-border-default) py-3 md:min-h-28 md:grid-cols-1 md:content-between md:border-b-0 md:border-r md:px-4 md:py-4 md:last:border-r-0">
            <span className="vl-index" style={{ color: step.accentColor }} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="text-sm font-semibold leading-snug text-(--color-text-primary)">{step.label}</span>
            <span className="absolute bottom-0 left-0 h-[3px] w-full md:w-1/3" style={{ backgroundColor: step.accentColor }} aria-hidden="true" />
          </li>
        );
      })}
    </ol>
  );

  return reveal ? <Reveal group>{connector}</Reveal> : connector;
}
