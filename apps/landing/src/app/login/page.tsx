import Link from "next/link";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";
import { getSignInHref, siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Sign In to VercentLabs ERP",
  description:
    "Open the configured VercentLabs ERP application or request access to the design-partner programme.",
  path: "/login",
  noIndex: true,
});

export default function LoginPage() {
  const configured = siteConfig.appUrl.length > 0;
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Application access"
        title={
          configured
            ? "Continue to the secure ERP application."
            : "Production sign-in is not publicly available yet."
        }
        description={
          configured
            ? "Authentication is handled by the deployed ERP application rather than the marketing website."
            : "The public website does not create a fake local account or claim that production access is ready."
        }
      />
      <OperatorBand
        index="01"
        eyebrow="Access path"
        title={
          configured
            ? "Leave the public website and open the workspace."
            : "Request a controlled early-access discussion."
        }
        description={
          configured
            ? "The configured application handles identity, session and organisation context."
            : "Share the organisation and priority workflow so the team can evaluate a suitable pilot."
        }
        tone="white"
      >
        <div className="operator-auth-panel">
          {configured ? (
            <a
              href={getSignInHref()}
              target="_blank"
              rel="noreferrer"
              className="button-primary"
            >
              Open VercentLabs ERP
            </a>
          ) : (
            <Link href="/contact" className="button-primary">
              Request early access
            </Link>
          )}
          <OperatorNote label="Security">
            <p>Credentials are never collected by the public marketing page.</p>
          </OperatorNote>
        </div>
      </OperatorBand>
    </MarketingShell>
  );
}
