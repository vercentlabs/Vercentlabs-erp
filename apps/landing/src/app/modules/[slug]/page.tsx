import type { Metadata } from "next";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { erpModules, getModule } from "@/content/erp";

type ModulePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return erpModules.map((erpModule) => ({
    slug: erpModule.slug,
  }));
}

export async function generateMetadata({
  params,
}: ModulePageProps): Promise<Metadata> {
  const { slug } = await params;
  const erpModule = getModule(slug);

  if (!erpModule) {
    return {};
  }

  return {
    title: erpModule.name,
    description: erpModule.summary,
  };
}

export default async function ModulePage({ params }: ModulePageProps) {
  const { slug } = await params;
  const erpModule = getModule(slug);

  if (!erpModule) {
    notFound();
  }

  return (
    <MarketingShell>
      <PageHero
        eyebrow="ERP module"
        title={erpModule.name}
        description={erpModule.summary}
        actions={
          <a
            href="mailto:vercentlabs@gmail.com?subject=Vercent ERP module discussion"
            className="button-primary"
          >
            Discuss this module
          </a>
        }
      />

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-indigo-600">
                Intended outcome
              </p>

              <h2 className="font-display mt-4 text-3xl font-extrabold tracking-[-0.035em] text-slate-950">
                {erpModule.outcome}
              </h2>

              <Link
                href="/how-it-works"
                className="mt-7 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
              >
                Review the implementation approach
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {erpModule.capabilities.map((capability) => (
                <div
                  key={capability}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5"
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
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
