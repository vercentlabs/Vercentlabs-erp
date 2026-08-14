import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cx } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "inverse";
export type ButtonSize = "md" | "sm";

const BASE_CLASSES =
  "group inline-flex items-center justify-center gap-2 rounded-[2px] font-semibold tracking-[-0.015em] transition-[color,background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-standard) active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus) disabled:cursor-not-allowed disabled:opacity-50";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-sm",
  sm: "min-h-9 px-4 text-[0.82rem]",
};

const TERTIARY_SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-11 text-sm",
  sm: "min-h-9 text-[0.82rem]",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border border-(--vl-ink) bg-(--vl-ink) text-white hover:border-(--vl-brand-dark) hover:bg-(--vl-brand-dark)",
  secondary:
    "border border-(--color-border-strong) bg-transparent text-(--color-text-primary) hover:border-(--color-text-primary) hover:bg-(--color-bg-elevated)",
  tertiary:
    "vl-editorial-link rounded-none text-(--color-text-brand) after:ml-1 after:inline-block after:content-['→']",
  inverse:
    "border border-white bg-white text-(--vl-ink) hover:border-(--vl-brand-wash) hover:bg-(--vl-brand-wash)",
};

function sizeClasses(variant: ButtonVariant, size: ButtonSize): string {
  return variant === "tertiary" ? TERTIARY_SIZE_CLASSES[size] : SIZE_CLASSES[size];
}

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
      className={cx(BASE_CLASSES, sizeClasses(variant, size), VARIANT_CLASSES[variant], className)}
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
  prefetch?: boolean;
}

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
      className={cx(BASE_CLASSES, sizeClasses(variant, size), VARIANT_CLASSES[variant], className)}
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
        "inline-flex h-10 w-10 items-center justify-center rounded-[2px] border border-transparent text-(--color-text-primary) transition-[border-color,background-color,transform] duration-(--duration-fast) hover:border-(--color-border-strong) hover:bg-(--color-bg-elevated) active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
