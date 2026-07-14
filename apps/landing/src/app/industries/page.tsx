import { createPageMetadata } from "@/lib/metadata";
import { ArrowRight, Building2 } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { industries } from "@/content/erp";

export const metadata = createPageMetadata({
  title: "ERP Solutions by Industry",
  description:
    "Explore connected ERP workflows for manufacturing, distribution, retail, services and project operations.",
  path: "/industries",
});

export default function IndustriesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Industry solutions"
        title="ERP must reflect the way the organisation actually operates."
        description="Industry context shapes workflows, controls, master data, compliance needs, reporting and implementation priorities."
      />

      <section className="bg-white py-7 sm:py-16">
        <PageContainer>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-1 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={"/industries/" + industry.slug}
                className="group min-w-0 rounded-xl border border-slate-200 bg-white p-3 transition hover:-translate-y-1 hover:border-teal-200 hover:shadow-lg sm:rounded-2xl sm:p-7"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600 sm:h-11 sm:w-11 sm:rounded-2xl">
                  <Building2
                    aria-hidden="true"
                    className="h-4 w-4 sm:h-5 sm:w-5"
                  />
                </div>

                <h2 className="font-display mt-3 text-sm font-extrabold text-slate-950 sm:mt-6 sm:text-xl">
                  {industry.name}
                </h2>

                <p className="mt-1.5 line-clamp-4 text-[11px] leading-5 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {industry.description}
                </p>

                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-extrabold text-teal-700 sm:mt-6 sm:gap-2 sm:text-sm">
                  Explore industry
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 transition group-hover:translate-x-1"
                  />
                </span>
              </Link>
            ))}
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
