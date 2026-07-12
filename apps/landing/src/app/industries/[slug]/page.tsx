import type { Metadata } from "next";
import { Check } from "lucide-react";
import { notFound } from "next/navigation";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { getIndustry, industries } from "@/content/erp";

type IndustryPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return industries.map((industry) => ({
    slug: industry.slug,
  }));
}

export async function generateMetadata({
  params,
}: IndustryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const industry = getIndustry(slug);

  if (!industry) {
    return {};
  }

  return {
    title: industry.name,
    description: industry.description,
  };
}

export default async function IndustryPage({ params }: IndustryPageProps) {
  const { slug } = await params;
  const industry = getIndustry(slug);

  if (!industry) {
    notFound();
  }

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Industry solution"
        title={industry.name}
        description={industry.description}
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl font-extrabold text-slate-950">
                Common operating challenges
              </h2>

              <div className="mt-7 space-y-3">
                {industry.challenges.map((challenge) => (
                  <div
                    key={challenge}
                    className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-sm font-semibold leading-7 text-slate-700"
                  >
                    {challenge}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="font-display text-3xl font-extrabold text-slate-950">
                Relevant platform capabilities
              </h2>

              <div className="mt-7 space-y-3">
                {industry.capabilities.map((capability) => (
                  <div
                    key={capability}
                    className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-5"
                  >
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                    />
                    <p className="text-sm font-semibold leading-7 text-slate-700">
                      {capability}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
