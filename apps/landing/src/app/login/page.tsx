import { createPageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { ArrowRight, ExternalLink, LockKeyhole } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { getSignInHref, siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Sign In to VercentLabs ERP",
  description:
    "Open the configured VercentLabs ERP application or request access to the design-partner programme.",
  path: "/login",
  noIndex: true,
});

export default function LoginPage() {
  const appIsConfigured = siteConfig.appUrl.length > 0;

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Sign in"
        title={
          appIsConfigured
            ? "Open the VercentLabs ERP application."
            : "Production sign-in is not publicly available yet."
        }
        description={
          appIsConfigured
            ? "Authentication is handled by the deployed ERP application rather than the marketing website."
            : "The public landing application does not create a fake local account or claim that production access is ready."
        }
      />

      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm sm:rounded-3xl sm:p-10">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <LockKeyhole aria-hidden="true" className="h-6 w-6" />
            </div>

            <h2 className="font-display mt-5 text-2xl font-extrabold text-slate-950">
              {appIsConfigured
                ? "Continue to the secure application"
                : "Request early access"}
            </h2>

            <p className="mt-4 text-sm leading-7 text-slate-600">
              {appIsConfigured
                ? "You will leave the public website and continue to the configured ERP application."
                : "Share your organisation and priority workflow so the team can evaluate a suitable discovery or pilot discussion."}
            </p>

            {appIsConfigured ? (
              <a
                href={getSignInHref()}
                target="_blank"
                rel="noreferrer"
                className="button-primary mt-6"
              >
                Open VercentLabs ERP
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
              </a>
            ) : (
              <Link href="/signup" className="button-primary mt-6">
                Request early access
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            )}
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
