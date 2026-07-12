import type { Metadata } from "next";
import { Building2, Check, Users } from "lucide-react";

import LeadForm from "@/components/forms/lead-form";
import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Request Early Access",
  description:
    "Request an ERP discovery, design-partner or early-access discussion with VercentLabs.",
  robots: {
    index: false,
    follow: true,
  },
};

const expectations = [
  "This is an early-access request, not instant account creation",
  "VercentLabs will review the organisation and priority workflow",
  "Suitable requests may begin with discovery before a pilot",
  "No production availability or implementation date is promised by this form",
];

export default function SignupPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Early access"
        title="Request a product, pilot or design-partner discussion."
        description="Vercent ERP is under active development. Early-access requests are reviewed for fit, process clarity and implementation readiness."
      />

      <section className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-7">
                <Building2
                  aria-hidden="true"
                  className="h-8 w-8 text-indigo-600"
                />

                <h2 className="font-display mt-5 text-2xl font-extrabold text-slate-950">
                  Start with a real workflow.
                </h2>

                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Useful requests identify the current systems, process owners,
                  users, locations, pain points and desired outcome.
                </p>
              </div>

              <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-7">
                <Users aria-hidden="true" className="h-7 w-7 text-teal-700" />

                <ul className="mt-5 space-y-3">
                  {expectations.map((expectation) => (
                    <li
                      key={expectation}
                      className="flex items-start gap-3 text-sm leading-7 text-slate-600"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-1 h-4 w-4 shrink-0 text-emerald-600"
                      />
                      {expectation}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <LeadForm mode="signup" />
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
