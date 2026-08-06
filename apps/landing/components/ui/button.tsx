import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cx } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "inverse";
export type ButtonSize = "md" | "sm";

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-(--radius-control) font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus) disabled:cursor-not-allowed disabled:opacity-50";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "h-11 px-5 text-sm",
  sm: "h-9 px-4 text-sm",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-(--color-bg-brand) text-(--color-text-inverse) hover:bg-(--color-text-brand)",
  secondary:
    "border border-(--color-border-strong) bg-(--color-bg-elevated) text-(--color-text-primary) hover:border-(--color-border-brand) hover:text-(--color-text-brand)",
  tertiary: "text-(--color-text-brand) hover:underline underline-offset-4",
  inverse: "bg-(--color-bg-elevated) text-(--color-text-primary) hover:bg-(--color-bg-subtle)",
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
  className?: string;
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
  );
}

/** For real actions: form submits, dialog triggers, client-side handlers. */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BASE_CLASSES, SIZE_CLASSES[size], VARIANT_CLASSES[variant], className)}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

interface ButtonLinkProps
  extends Omit<CommonProps, "loading">,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> {
  href: string;
  /**
   * Defaults to false: most CTA destinations (e.g. /book-demo, /product/platform)
   * don't exist as real pages yet in this phase (see docs/landing-redesign/
   * phase-2/implementation-summary.md) — Next.js's default Link prefetching would
   * otherwise fire background requests that 404. Pass true once a destination is
   * a real, built page.
   */
  prefetch?: boolean;
}

/** For real navigation: every CTA that sends a visitor to another route. Links have no loading state. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  children,
  className,
  href,
  prefetch = false,
  ...rest
}: ButtonLinkProps) {
  const isExternal = /^https?:\/\//.test(href);
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cx(BASE_CLASSES, SIZE_CLASSES[size], VARIANT_CLASSES[variant], className)}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: { label: string; children: ReactNode; className?: string } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children"
>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx(
        "inline-flex h-10 w-10 items-center justify-center rounded-(--radius-control) text-(--color-text-primary) transition-colors hover:bg-(--color-bg-subtle) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
