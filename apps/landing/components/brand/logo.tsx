import Link from "next/link";
import { cx } from "@/lib/utils";

/**
 * Placeholder brand mark — see public/brand/README.md. Reuses the same "V"
 * letterform as the product's own mark, rendered flat (no gradient) per the
 * Control Surface direction, since no exported brand asset file exists to reuse
 * verbatim.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" width="28" height="28" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="var(--color-brand)" />
      <path d="M10 12h5.2l4.8 14.2L24.8 12H30l-8.1 20h-3.8L10 12Z" fill="white" />
    </svg>
  );
}

export function Logo({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      className={cx(
        "inline-flex items-center gap-2 rounded-(--radius-control) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)",
        className,
      )}
      aria-label="Vercentlabs — go to homepage"
    >
      <LogoMark />
      <span className={cx("text-base font-semibold tracking-[-0.02em]", inverse ? "text-(--color-text-inverse)" : "text-(--color-text-primary)")}>
        Vercentlabs
      </span>
    </Link>
  );
}
