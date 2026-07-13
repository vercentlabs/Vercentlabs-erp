import { ArrowRight, Boxes } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { erpModules } from "@/content/erp";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "12 Connected ERP Modules",
  description:
    "Explore Accounting, Procurement, Sales, CRM, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll in Vercent ERP.",
  path: "/modules",
});

export default function ModulesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Complete modular ERP"
        title="12 modules. One connected operating foundation."
        description="Each module owns a clear business responsibility while sharing master data, permissions, documents, workflows and reporting across Vercent ERP."
        actions={
          <Link href="/contact" className="button-primary">
            Book a module walkthrough{" "}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />
      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {erpModules.map((item, index) => (
              <Link
                key={item.slug}
                href={"/modules/" + item.slug}
                className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <Boxes aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-extrabold text-slate-400">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                  {item.name}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {item.summary}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600">
                  Explore module{" "}
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
