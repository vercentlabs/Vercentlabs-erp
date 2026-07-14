import { createPageMetadata } from "@/lib/metadata";
import { ArrowRight, Briefcase, Code2, Settings, Users } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { landingConfig } from "@/lib/landing-config";

export const metadata = createPageMetadata({
  title: "Careers at VercentLabs",
  description:
    "Explore product engineering, ERP implementation and business operations careers at VercentLabs.",
  path: "/careers",
});

const areas = [
  {
    icon: Code2,
    title: "Product engineering",
    description:
      "Frontend, backend, platform, data and quality engineering for a multi-tenant ERP product.",
  },
  {
    icon: Settings,
    title: "ERP implementation",
    description:
      "Process discovery, configuration, migration, testing, training and business adoption.",
  },
  {
    icon: Users,
    title: "Product and industry learning",
    description:
      "Research real operating problems and translate them into understandable product workflows.",
  },
];

export default function CareersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Careers"
        title="Learn by helping build a serious enterprise product."
        description="VercentLabs is building its product and implementation capability carefully. Formal openings will be published only when a defined role, responsibility and selection process is ready."
      />

      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="grid gap-4 md:grid-cols-3">
            {areas.map((area) => {
              const Icon = area.icon;

              return (
                <article
                  key={area.title}
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6 text-indigo-600"
                  />

                  <h2 className="font-display mt-4 text-xl font-extrabold text-slate-950">
                    {area.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {area.description}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-7 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 sm:mt-10 sm:rounded-3xl sm:p-10">
            <Briefcase aria-hidden="true" className="h-8 w-8 text-indigo-600" />

            <h2 className="font-display mt-3.5 text-2xl font-extrabold text-slate-950 sm:mt-5 sm:text-3xl">
              No formal vacancy is currently published.
            </h2>

            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
              Experienced ERP professionals, product builders and committed
              learners may still share a concise introduction, relevant work and
              the area where they can contribute.
            </p>

            <a
              href={
                "mailto:" +
                landingConfig.contactEmail +
                "?subject=VercentLabs career introduction"
              }
              className="button-primary mt-6"
            >
              Send an introduction
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
