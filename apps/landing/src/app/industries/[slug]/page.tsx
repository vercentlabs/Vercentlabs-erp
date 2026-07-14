import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { getIndustry, industries } from "@/content/erp";
import { createPageMetadata } from "@/lib/metadata";

type IndustryPageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return industries.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: IndustryPageProps) {
  const { slug } = await params;
  const item = getIndustry(slug);
  return item
    ? createPageMetadata({
        title: item.name + " ERP",
        description: item.description,
        path: "/industries/" + item.slug,
      })
    : {};
}

export default async function IndustryPage({ params }: IndustryPageProps) {
  const { slug } = await params;
  const item = getIndustry(slug);
  if (!item) notFound();

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Industry workflow"
        title={item.name}
        description={item.description}
        actions={
          <Link href="/signup" className="button-primary">
            Discuss your operating model
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />
      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="grid gap-7 sm:gap-12 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-extrabold text-slate-950 sm:text-3xl">
                Common operating challenges
              </h2>
              <div className="mt-7 space-y-3">
                {item.challenges.map((challenge) => (
                  <div
                    key={challenge}
                    className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs font-semibold leading-6 text-slate-700 sm:rounded-2xl sm:p-5 sm:text-sm sm:leading-7"
                  >
                    {challenge}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="font-display text-2xl font-extrabold text-slate-950 sm:text-3xl">
                Relevant platform capabilities
              </h2>
              <div className="mt-7 space-y-3">
                {item.capabilities.map((capability) => (
                  <div
                    key={capability}
                    className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-4 sm:gap-3 sm:rounded-2xl sm:p-5"
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
