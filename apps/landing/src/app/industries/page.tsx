import type { Metadata } from "next";
import { ArrowRight, Building2 } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { industries } from "@/content/erp";

export const metadata: Metadata = {
  title: "Industry ERP Solutions",
  description:
    "Explore how the Vercent ERP platform can be configured around different industry operating requirements.",
};

export default function IndustriesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Industry solutions"
        title="ERP must reflect the way the organisation actually operates."
        description="Industry context shapes workflows, controls, master data, compliance needs, reporting and implementation priorities."
      />

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={"/industries/" + industry.slug}
                className="group rounded-3xl border border-slate-200 bg-white p-7 transition hover:-translate-y-1 hover:border-teal-200 hover:shadow-xl"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
                  <Building2 aria-hidden="true" className="h-5 w-5" />
                </div>

                <h2 className="font-display mt-6 text-xl font-extrabold text-slate-950">
                  {industry.name}
                </h2>

                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {industry.description}
                </p>

                <span className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-teal-700">
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
