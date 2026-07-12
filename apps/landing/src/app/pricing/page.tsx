import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "ERP Engagement and Pricing Approach",
  description:
    "Understand how VercentLabs scopes ERP discovery, controlled pilots and phased implementation before providing a commercial proposal.",
  path: "/pricing",
});

const engagements = [
  {
    name: "Discovery",
    description:
      "Define the business problem, process owners, current systems, data, controls and smallest valuable scope.",
    includes: [
      "Stakeholder and workflow discovery",
      "Current-system and data review",
      "Priority and risk definition",
      "Recommended next-step scope",
    ],
  },
  {
    name: "Controlled pilot",
    description:
      "Validate selected workflows with realistic roles, data and business scenarios before a wider commitment.",
    includes: [
      "Pilot workflow configuration",
      "Scenario and control validation",
      "Migration rehearsal where required",
      "Pilot findings and rollout decision",
    ],
  },
  {
    name: "Phased rollout",
    description:
      "Release approved modules and workflows in manageable stages with training, cutover and improvement ownership.",
    includes: [
      "Release and environment planning",
      "Configuration and integration",
      "Migration and user preparation",
      "Cutover, support and improvement",
    ],
  },
];

const costDrivers = [
  "Number and complexity of workflows",
  "Companies, locations and user roles",
  "Data quality and migration volume",
  "Required integrations and reports",
  "Training, change and rollout responsibility",
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Commercial approach"
        title="Price the verified scope—not an imaginary standard implementation."
        description="ERP cost depends on the workflows, controls, migration, integrations, users and implementation responsibility. VercentLabs begins with discovery before making a commercial commitment."
        actions={
          <Link href="/signup" className="button-primary">
            Apply for a scope review
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-5 lg:grid-cols-3">
            {engagements.map((engagement, index) => (
              <article
                key={engagement.name}
                className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
              >
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-600">
                  Stage {index + 1}
                </p>
                <h2 className="font-display mt-3 text-2xl font-extrabold text-slate-950">
                  {engagement.name}
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  {engagement.description}
                </p>
                <ul className="mt-6 space-y-3">
                  {engagement.includes.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 text-sm leading-6 text-slate-700"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-10 grid gap-8 rounded-3xl border border-indigo-100 bg-indigo-50 p-8 sm:p-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                What shapes a proposal
              </p>
              <h2 className="font-display mt-3 text-3xl font-extrabold text-slate-950">
                A useful estimate follows a useful scope.
              </h2>
            </div>
            <ul className="space-y-3">
              {costDrivers.map((driver) => (
                <li
                  key={driver}
                  className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  <Check
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-indigo-600"
                  />
                  {driver}
                </li>
              ))}
            </ul>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
