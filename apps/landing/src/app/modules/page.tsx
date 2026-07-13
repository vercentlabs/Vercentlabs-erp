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
    "Explore all 12 Vercent ERP modules for accounting, procurement, sales, CRM, stock, manufacturing, projects, assets, point of sale, quality, support, HR and payroll.",
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
          <Link href="/contact" className="button-primary">
            Book a module demonstration
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {erpModules.map((erpModule, index) => (
              <Link
                key={erpModule.slug}
                href={"/modules/" + erpModule.slug}
                className="group min-w-0 rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <Boxes aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-extrabold text-slate-400">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>

                <h2 className="font-display mt-6 text-xl font-extrabold text-slate-950">
                  {erpModule.name}
                </h2>

                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {erpModule.summary}
                </p>

                <span className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600">
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
