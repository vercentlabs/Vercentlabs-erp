import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Check, Users } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Design Partners",
  description:
    "Learn how VercentLabs intends to work with ERP design partners and pilot organisations.",
  alternates: {
    canonical: "/customers",
  },
};

const partnerExpectations = [
  "A real and clearly owned operating problem",
  "Access to knowledgeable process participants",
  "Willingness to validate workflows and terminology",
  "Realistic data and business scenarios for testing",
  "Structured feedback and implementation decisions",
];

export default function CustomersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Design partners"
        title="Build with real operating context before publishing customer claims."
        description="VercentLabs does not present invented customer logos, testimonials or success metrics. The current focus is finding suitable organisations and ERP professionals for controlled discovery and pilot work."
        actions={
          <Link href="/contact" className="button-primary">
            Discuss a design partnership
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-7">
              <Building2
                aria-hidden="true"
                className="h-8 w-8 text-indigo-600"
              />

              <h2 className="font-display mt-5 text-2xl font-extrabold text-slate-950">
                Suitable pilot organisations
              </h2>

              <p className="mt-4 text-sm leading-7 text-slate-600">
                Organisations with disconnected systems, manual approvals, weak
                process visibility or a defined ERP replacement requirement may
                be suitable for discovery.
              </p>
            </div>

            <div className="rounded-3xl border border-teal-100 bg-teal-50 p-7">
              <Users aria-hidden="true" className="h-8 w-8 text-teal-700" />

              <h2 className="font-display mt-5 text-2xl font-extrabold text-slate-950">
                Suitable implementation partners
              </h2>

              <p className="mt-4 text-sm leading-7 text-slate-600">
                ERP consultants and implementation professionals can help
                validate process design, migration, controls, adoption and
                industry requirements.
              </p>
            </div>
          </div>

          <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-7 sm:p-10">
            <h2 className="font-display text-3xl font-extrabold text-slate-950">
              A useful design partnership requires:
            </h2>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {partnerExpectations.map((expectation) => (
                <div
                  key={expectation}
                  className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  />

                  <p className="text-sm font-semibold leading-6 text-slate-700">
                    {expectation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
