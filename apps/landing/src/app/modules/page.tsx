import type { Metadata } from "next";
import { ArrowRight, Boxes } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { erpModules } from "@/content/erp";

export const metadata: Metadata = {
  title: "12 ERP Modules",
  description:
    "Explore all 12 VercentLabs ERP modules for accounting, procurement, sales, CRM, stock, manufacturing, projects, assets, point of sale, quality, support, HR and payroll.",
  alternates: {
    canonical: "/modules",
  },
};

export default function ModulesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Modular enterprise platform"
        title="Twelve modules. One connected operating foundation."
        description="Each module supports a distinct business responsibility while sharing data, permissions, workflows, audit history and reporting with the wider platform."
        actions={
          <Link href="/contact" className="button-primary w-full sm:w-auto">
            Book a module demonstration
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-7 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {erpModules.map((erpModule, index) => (
              <Link
                key={erpModule.slug}
                href={"/modules/" + erpModule.slug}
                className="group min-w-0 rounded-xl border border-slate-200 bg-white p-3 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 sm:rounded-2xl sm:p-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 sm:h-11 sm:w-11 sm:rounded-2xl">
                    <Boxes
                      aria-hidden="true"
                      className="h-4 w-4 sm:h-5 sm:w-5"
                    />
                  </div>
                  <span className="text-[10px] font-extrabold text-slate-400 sm:text-xs">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>

                <h2 className="font-display mt-3 text-sm font-extrabold text-slate-950 sm:mt-6 sm:text-xl">
                  {erpModule.name}
                </h2>

                <p className="mt-1.5 line-clamp-4 text-[11px] leading-5 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {erpModule.summary}
                </p>

                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-extrabold text-indigo-600 sm:mt-6 sm:gap-2 sm:text-sm">
                  Explore module
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
