"use client";

import type { ReactNode } from "react";
import { ButtonLink, type ButtonVariant } from "@/components/ui/button";
import { cx } from "@/lib/utils";
import { track, type AnalyticsEventName } from "@/lib/analytics";

/**
 * A CTA link that fires an analytics event on click. page.tsx is a Server
 * Component, so it cannot pass an inline onClick to a Client Component
 * (event handlers aren't serializable across the RSC boundary) — this wrapper
 * owns the click handler itself instead.
 */
export function TrackedCtaLink({
  href,
  event,
  ctaLocation,
  variant,
  className,
  children,
}: {
  href: string;
  event: AnalyticsEventName;
  ctaLocation: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ButtonLink
      href={href}
      variant={variant}
      className={className}
      onClick={() => track(event, { ctaLocation, ctaDestination: href })}
    >
      {children}
    </ButtonLink>
  );
}

/**
 * A plain inline text link (not button-styled) that fires an analytics
 * event on click — for citation/source links inside long-form content,
 * distinct from TrackedCtaLink's button treatment.
 */
export function TrackedLink({
  href,
  event,
  ctaLocation,
  external,
  className,
  children,
}: {
  href: string;
  event: AnalyticsEventName;
  ctaLocation: string;
  external?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cx("text-(--color-text-link) underline underline-offset-2 hover:text-(--color-text-brand)", className)}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={() => track(event, { ctaLocation, ctaDestination: href })}
    >
      {children}
    </a>
  );
}
