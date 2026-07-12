import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MailCheck } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Early Access Request Received",
  robots: {
    index: false,
    follow: false,
  },
};

type VerifySignupPageProps = {
  searchParams: Promise<{
    email?: string | string[];
  }>;
};

export default async function VerifySignupPage({
  searchParams,
}: VerifySignupPageProps) {
  const parameters = await searchParams;
  const rawEmail = Array.isArray(parameters.email)
    ? parameters.email[0]
    : parameters.email;

  const email = rawEmail && rawEmail.length <= 160 ? rawEmail : "";

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Request received"
        title="Thank you for sharing your ERP requirement."
        description="This confirms only that the early-access request was accepted by the configured enquiry service. It does not create a production ERP account."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-xl rounded-3xl border border-emerald-200 bg-emerald-50 p-7 text-center sm:p-10">
            <MailCheck
              aria-hidden="true"
              className="mx-auto h-11 w-11 text-emerald-700"
            />

            <h2 className="font-display mt-5 text-2xl font-extrabold text-emerald-950">
              The team can now review your request.
            </h2>

            {email ? (
              <p className="mt-4 text-sm leading-7 text-emerald-900">
                Any response will be sent to <strong>{email}</strong>.
              </p>
            ) : (
              <p className="mt-4 text-sm leading-7 text-emerald-900">
                Any response will be sent to the email provided in the request.
              </p>
            )}

            <Link href="/" className="button-primary mt-6">
              Return to the homepage
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
