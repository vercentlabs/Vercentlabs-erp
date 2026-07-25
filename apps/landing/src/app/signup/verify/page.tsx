import Link from "next/link";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Verify your request",
  description: "Check your email to continue a VercentLabs ERP access request.",
  path: "/signup/verify",
  noIndex: true,
});

export default function SignupVerifyPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Request received"
        title="Check the email address you submitted."
        description="The next step is delivered through the verified email workflow rather than a simulated success screen."
      />
      <OperatorBand
        index="01"
        eyebrow="Verification"
        title="Continue from the signed email link."
        description="The link confirms the address and preserves the request context."
        tone="white"
      >
        <div className="operator-auth-panel">
          <OperatorNote label="No email">
            <p>
              Check spam and confirm the address used in the request. Contact
              VercentLabs when the message does not arrive.
            </p>
          </OperatorNote>
          <Link href="/" className="button-secondary">
            Return to homepage
          </Link>
        </div>
      </OperatorBand>
    </MarketingShell>
  );
}
