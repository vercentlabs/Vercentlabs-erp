import type { Metadata } from "next";
import { Check } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "ERP Engagement and Pricing",
  description:
    "Understand the discovery, pilot and rollout engagement approach for Vercent ERP.",
};

const engagements = [
  {
    name: "Discovery",
    description:
      "Assess processes, systems, data, controls, pain points and the highest-value starting scope.",
    includes: [
      "Stakeholder and workflow review",
      "Current-system assessment",
      "Priority and scope definition",
      "Implementation recommendation",
    ],
  },
  {
    name: "Pilot",
    description:
      "Validate selected workflows, roles, data and user scenarios in a controlled implementation.",
    includes: [
      "Selected process configuration",
      "Data mapping and migration rehearsal",
      "Business scenario validation",
      "Pilot review and rollout decision",
    ],
  },
  {
    name: "Phased rollout",
    description:
      "Expand modules, companies, locations and workflows through governed implementation releases.",
    includes: [
      "Release planning",
      "Configuration and integration",
      "Migration and user preparation",
      "Cutover, support and improvement",
    ],
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Commercial approach"
        title="Pricing should follow verified scope, complexity and implementation responsibility."
        description="Public fixed prices are not shown before the platform, service scope and implementation model are ready to support reliable commercial commitments."
      />

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="grid gap-5 lg:grid-cols-3">
            {engagements.map((engagement, index) => (
              <article
                key={engagement.name}
                className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm"
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

          <div className="mt-12 rounded-[2rem] bg-indigo-50 p-8 text-center sm:p-12">
            <h2 className="font-display text-3xl font-extrabold text-slate-950">
              Discuss the organisation before discussing a number.
            </h2>

            <p className="mx-auto mt-4 max-w-2xl leading-8 text-slate-600">
              The founding team can review the current environment and identify
              an appropriate discovery, pilot or implementation approach.
            </p>

            <a
              href={
                "mailto:" +
                siteConfig.email +
                "?subject=Vercent ERP engagement discussion"
              }
              className="button-primary mt-7"
            >
              Contact VercentLabs
            </a>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
