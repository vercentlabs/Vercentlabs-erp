import Link from "next/link";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorNote,
} from "@/components/marketing/operator-page";

export default function NotFoundPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="404 / Route not found"
        title="The address does not map to a public operating surface."
        description="The page may have moved, the address may be incomplete, or the route may belong to the secure ERP application rather than the public website."
      />
      <OperatorBand
        index="01"
        eyebrow="Recovery"
        title="Return to a known public route."
        description="Use the product map for released scope, or the homepage for the complete public navigation."
        tone="white"
      >
        <div className="operator-auth-panel">
          <OperatorNote label="No action recorded">
            <p>
              A missing route does not complete a form, trial, account, payment
              or product command.
            </p>
          </OperatorNote>
          <div className="operator-actions">
            <Link href="/product" className="button-primary">
              Review released product
            </Link>
            <Link href="/" className="button-secondary">
              Return home
            </Link>
          </div>
        </div>
      </OperatorBand>
    </MarketingShell>
  );
}
