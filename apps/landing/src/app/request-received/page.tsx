import Link from "next/link";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Request received",
  description: "Your VercentLabs request has been delivered for review.",
  path: "/request-received",
  noIndex: true,
});

export default function RequestReceivedPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Request delivered"
        title="The context is with the VercentLabs team."
        description="A team member will review the operating problem and reply through the work email you submitted. No trial, account or implementation commitment is created by this form alone."
      />

      <OperatorBand
        index="01"
        eyebrow="What happens next"
        title="Review first. Then choose the correct secure path."
        description="Product evaluation, design-partner work and account registration are separate journeys. The reply will identify the next appropriate step."
        tone="white"
      >
        <div className="operator-auth-panel">
          <OperatorNote label="Expected response">
            <p>
              VercentLabs reviews requests on business days. Include additional
              context by emailing {siteConfig.email}.
            </p>
          </OperatorNote>
          <div className="operator-actions">
            <Link href="/product" className="button-primary">
              Review released scope
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
