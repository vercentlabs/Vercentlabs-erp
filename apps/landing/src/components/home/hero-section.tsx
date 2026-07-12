import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Factory,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";

const workflowItems = [
  {
    icon: PackageCheck,
    label: "Sales order SO-1048",
    status: "Approved",
    description: "Customer, price, stock and credit checks completed.",
  },
  {
    icon: Factory,
    label: "Production plan",
    status: "Scheduled",
    description: "Materials, capacity and quality checkpoints reserved.",
  },
  {
    icon: CircleDollarSign,
    label: "Invoice and ledger",
    status: "Connected",
    description: "Fulfilment updates billing, receivables and reporting.",
  },
];

export default function HeroSection() {
  return (
    <section
      className="relative overflow-hidden border-b border-slate-100 bg-white"
      aria-labelledby="hero-headline"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,102,241,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to bottom, black, transparent 90%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -left-28 top-0 h-72 w-72 rounded-full bg-indigo-200/55 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-teal-200/45 blur-[110px]"
      />

      <PageContainer className="relative py-14 sm:py-18 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_0.9fr] xl:gap-16">
          <div>
            <p className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.15em] text-indigo-700">
              12 modules. One connected business platform.
            </p>

            <h1
              id="hero-headline"
              className="font-display mt-5 max-w-4xl text-4xl font-extrabold leading-[1.06] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-[3.5rem]"
            >
              Run every core operation from one connected ERP.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              Vercent ERP connects accounting, procurement, sales, CRM, stock,
              manufacturing, projects, assets, point of sale, quality, support
              and HR & payroll—so work moves without spreadsheet handoffs or
              repeated entry.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className="button-primary justify-center">
                Book a personalised demo
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link href="/modules" className="button-secondary justify-center">
                Explore all 12 modules
              </Link>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                "12 connected modules",
                "6 end-to-end workflows",
                "Role-based control",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 text-sm font-bold text-slate-700"
                >
                  <Check
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-emerald-600"
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div id="platform-preview" className="scroll-mt-28">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
              <div className="flex items-center justify-between gap-4 bg-slate-950 px-5 py-4 text-white">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-indigo-300">
                    Live workflow view
                  </p>
                  <p className="font-display mt-1 font-extrabold">
                    Order to cash
                  </p>
                </div>
                <ShieldCheck
                  aria-hidden="true"
                  className="h-6 w-6 text-teal-300"
                />
              </div>

              <div className="space-y-3 p-5">
                {workflowItems.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <article
                      key={item.label}
                      className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                          <Icon aria-hidden="true" className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="font-display text-sm font-extrabold text-slate-950">
                              {item.label}
                            </h2>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">
                              {item.status}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-6 text-slate-600">
                            {item.description}
                          </p>
                        </div>
                      </div>
                      {index < workflowItems.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-4 left-9 h-4 w-px bg-indigo-200"
                        />
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 bg-indigo-50/70 px-5 py-3 text-xs leading-5 text-indigo-900">
                Every step keeps ownership, approval and accounting impact
                traceable.
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
