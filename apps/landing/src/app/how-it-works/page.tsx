import { createPageMetadata } from "@/lib/metadata";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";
import { businessFlows } from "@/content/erp";

export const metadata = createPageMetadata({
  title: "How Vercent ERP Works",
  description:
    "Understand Vercent ERP end-to-end workflows and its discovery, validation, migration and phased implementation approach.",
  path: "/how-it-works",
});

const implementationStages = [
  {
    title: "Discover",
    description:
      "Understand the organisation, current systems, controls, data, pain points and priority outcomes.",
  },
  {
    title: "Design",
    description:
      "Define process scope, roles, approvals, master data, integrations, migration and success measures.",
  },
  {
    title: "Configure and validate",
    description:
      "Implement the selected workflows, test business scenarios and validate migrated information.",
  },
  {
    title: "Release and improve",
    description:
      "Train users, control cutover, monitor adoption and expand through planned releases.",
  },
];

export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Process-led ERP"
        title="Connect business events from beginning to end."
        description="Vercent ERP is designed around complete operating flows so that information, controls and responsibility move with each transaction."
        actions={
          <Link href="/modules" className="button-primary">
            Review the modules
          </Link>
        }
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="Core workflows"
            title="Five connected flows cover the centre of enterprise operations."
          />

          <div className="mt-10 space-y-5">
            {businessFlows.map((flow, index) => (
              <article
                key={flow.name}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8"
              >
                <div className="grid gap-6 lg:grid-cols-[0.35fr_1fr]">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-600">
                      Flow {index + 1}
                    </p>
                    <h2 className="font-display mt-2 text-2xl font-extrabold text-slate-950">
                      {flow.name}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {flow.summary}
                    </p>
                  </div>

                  <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {flow.stages.map((stage, stageIndex) => (
                      <li
                        key={stage}
                        className="rounded-2xl border border-slate-200 bg-white p-4"
                      >
                        <span className="text-xs font-extrabold text-indigo-600">
                          {String(stageIndex + 1).padStart(2, "0")}
                        </span>
                        <p className="mt-2 text-sm font-bold text-slate-800">
                          {stage}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="Implementation"
            title="Move from discovery to controlled adoption."
            description="ERP implementation is treated as an operating change programme rather than only a software installation."
            align="center"
          />

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {implementationStages.map((stage, index) => (
              <article
                key={stage.title}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <span className="text-sm font-extrabold text-indigo-600">
                  Phase {index + 1}
                </span>
                <h2 className="font-display mt-3 text-xl font-extrabold text-slate-950">
                  {stage.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {stage.description}
                </p>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
