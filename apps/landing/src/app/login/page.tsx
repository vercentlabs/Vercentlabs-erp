import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, LockKeyhole } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { landingConfig } from "@/lib/landing-config";

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Open the deployed Vercent ERP application or request product access.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginPage() {
  const appIsConfigured = landingConfig.appUrl.length > 0;

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Sign in"
        title={
          appIsConfigured
            ? "Open the Vercent ERP application."
            : "Production sign-in is not publicly available yet."
        }
        description={
          appIsConfigured
            ? "Authentication is handled by the deployed ERP application rather than the marketing website."
            : "The public landing application does not create a fake local account or claim that production access is ready."
        }
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10">
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
                href={landingConfig.appUrl}
                target="_blank"
                rel="noreferrer"
                className="button-primary mt-6"
              >
                Open Vercent ERP
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
