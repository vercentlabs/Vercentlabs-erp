import { createPageMetadata } from "@/lib/metadata";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  GraduationCap,
  UsersRound,
} from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "VercentLabs Partner Programme",
  description:
    "Explore implementation, industry, integration and delivery partnership opportunities with VercentLabs.",
  path: "/partner",
});

const partnerTypes = [
  {
    icon: BriefcaseBusiness,
    title: "ERP implementation professionals",
    description:
      "Bring process discovery, configuration, migration, training and adoption experience.",
  },
  {
    icon: Building2,
    title: "Industry specialists",
    description:
      "Help validate workflows, terminology, controls and reporting requirements.",
  },
  {
    icon: UsersRound,
    title: "Pilot organisations",
    description:
      "Collaborate around carefully selected operating problems and realistic user scenarios.",
  },
  {
    icon: GraduationCap,
    title: "Learning and talent partners",
    description:
      "Create structured opportunities for developers and functional learners to grow through real product work.",
  },
];

export default function PartnerPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Partner ecosystem"
        title="Build the product with people who understand real ERP implementation."
        description="VercentLabs is interested in grounded partnerships that improve product quality, industry understanding and implementation capability."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-5 md:grid-cols-2">
            {partnerTypes.map((partner) => {
              const Icon = partner.icon;

              return (
                <article
                  key={partner.title}
                  className="rounded-2xl border border-slate-200 bg-white p-7"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-7 w-7 text-indigo-600"
                  />

                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {partner.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {partner.description}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 rounded-3xl bg-slate-950 p-8 text-white sm:p-12">
            <h2 className="font-display text-3xl font-extrabold">
              Start with a direct conversation.
            </h2>

            <p className="mt-4 max-w-2xl leading-8 text-slate-300">
              Share the relevant experience, market, organisation, customer
              problem or partnership idea.
            </p>

            <a
              href={
                "mailto:" +
                siteConfig.email +
                "?subject=VercentLabs partnership discussion"
              }
              className="button-primary mt-7"
            >
              Discuss a partnership
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
