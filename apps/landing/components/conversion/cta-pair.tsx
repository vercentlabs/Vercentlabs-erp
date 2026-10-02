import type { ReactNode } from "react";
import { Inline } from "@/components/layout/container";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import type { ButtonVariant } from "@/components/ui/button";
import type { AnalyticsEventName } from "@/lib/analytics";

export interface CtaPairAction {
  href: string;
  event: AnalyticsEventName;
  label: ReactNode;
  variant?: ButtonVariant;
}

/**
 * A primary + secondary conversion action sharing one analytics location.
 * Each link still fires its own event with { ctaLocation, ctaDestination: href }
 * through TrackedCtaLink, so pairing never changes what is tracked.
 */
export function CtaPair({
  primary,
  secondary,
  ctaLocation,
  className,
}: {
  primary: CtaPairAction;
  secondary: CtaPairAction;
  ctaLocation: string;
  className?: string;
}) {
  return (
    <Inline gap={3} className={className}>
      <PairLink action={primary} ctaLocation={ctaLocation} />
      <PairLink action={secondary} ctaLocation={ctaLocation} />
    </Inline>
  );
}

function PairLink({ action, ctaLocation }: { action: CtaPairAction; ctaLocation: string }) {
  // Forward `variant` only when set, so the button's own default applies
  // exactly as it does for a bare <TrackedCtaLink>.
  return (
    <TrackedCtaLink href={action.href} event={action.event} ctaLocation={ctaLocation} {...(action.variant ? { variant: action.variant } : {})}>
      {action.label}
    </TrackedCtaLink>
  );
}
