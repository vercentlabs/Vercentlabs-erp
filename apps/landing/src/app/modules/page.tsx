import { createPageMetadata } from "@/lib/metadata";
import { ArrowRight, Boxes } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { erpModules } from "@/content/erp";

export const metadata = createPageMetadata({
  title: "Vercent ERP Modules",
  description:
    "Explore ten connected modules across finance, procurement, inventory, sales, CRM, manufacturing, people, projects and reporting.",
  path: "/modules",
});

export default function ModulesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Modular enterprise platform"
        title="Ten modules. One connected operating foundation."
        description="Each module supports a distinct business responsibility while sharing data, permissions, workflows and reporting with the wider platform."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {erpModules.map((erpModule, index) => (
              <Link
                key={erpModule.slug}
                href={"/modules/" + erpModule.slug}
                className="group rounded-2xl border border-slate-200 bg-white p-7 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
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
