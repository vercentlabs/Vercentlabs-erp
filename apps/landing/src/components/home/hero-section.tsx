import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  Factory,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import Header from "@/components/layout/header";
import PageContainer from "@/components/layout/page-container";

const flowSteps = [
  { label: "Opportunity", detail: "CRM", icon: CheckCircle2 },
  { label: "Sales order", detail: "Sales", icon: PackageCheck },
  { label: "Production", detail: "Manufacturing", icon: Factory },
  { label: "Invoice", detail: "Accounting", icon: CircleDollarSign },
];

export default function HeroSection() {
  return (
    <div className="bg-white">
      <Header />

      <section
        id="platform-preview"
        className="relative isolate overflow-hidden border-b border-slate-200 bg-[linear-gradient(180deg,#f8faff_0%,#ffffff_78%)] py-14 sm:py-18 lg:py-24"
      >
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-0 -z-10 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-indigo-200/40 blur-3xl sm:h-[620px] sm:w-[620px]"
        />

        <PageContainer>
          <div className="grid min-w-0 items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
            <div className="min-w-0 text-center lg:text-left">
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-indigo-700 shadow-sm">
                <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                Connected enterprise operations
              </span>

              <h1 className="font-display mx-auto mt-6 max-w-4xl text-balance text-4xl font-extrabold leading-[1.08] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:mx-0 lg:text-6xl xl:text-7xl">
                Run every core operation from one connected ERP.
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-8 text-slate-600 sm:text-lg lg:mx-0">
                Vercent ERP connects accounting, procurement, sales, CRM, stock,
                manufacturing, projects, assets, point of sale, quality,
                support, HR and payroll through shared data, workflows,
                permissions and reporting.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link
                  href="/contact"
                  className="button-primary min-h-[52px] w-full px-6 sm:w-auto"
                >
                  Book a personalised demo
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>

                <Link
                  href="/#modules"
                  className="button-secondary min-h-[52px] w-full px-6 sm:w-auto"
                >
                  Explore 12 modules
                </Link>
              </div>

              <ul className="mx-auto mt-8 grid max-w-xl gap-3 text-left sm:grid-cols-2 lg:mx-0">
                {[
                  "One source of operational data",
                  "Role-based control and approvals",
                  "Multi-company and multi-location",
                  "API and integration-ready foundation",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm font-semibold leading-6 text-slate-700"
                  >
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0">
              <div className="relative mx-auto max-w-2xl rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-[0_30px_90px_rgba(15,23,42,0.16)] sm:p-5">
                <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4 sm:p-6">
                  <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-indigo-600">
                        Connected workflow
                      </p>
                      <h2 className="font-display mt-1 text-xl font-extrabold text-slate-950 sm:text-2xl">
                        Opportunity to cash
                      </h2>
                    </div>

                    <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-extrabold text-emerald-800">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Live business context
                    </span>
                  </div>

                  <ol className="mt-5 grid gap-3 sm:grid-cols-2">
                    {flowSteps.map((step, index) => {
                      const Icon = step.icon;

                      return (
                        <li
                          key={step.label}
                          className="rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                              <Icon aria-hidden="true" className="h-5 w-5" />
                            </span>
                            <span className="text-xs font-extrabold text-slate-400">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </div>
                          <p className="mt-4 text-sm font-extrabold text-slate-950">
                            {step.label}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {step.detail}
                          </p>
                        </li>
                      );
                    })}
                  </ol>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "Modules", value: "12", icon: Boxes },
                      {
                        label: "Connected flows",
                        value: "6",
                        icon: PackageCheck,
                      },
                      {
                        label: "Shared controls",
                        value: "One",
                        icon: ShieldCheck,
                      },
                    ].map((item) => {
                      const Icon = item.icon;

                      return (
                        <div
                          key={item.label}
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <Icon
                            aria-hidden="true"
                            className="h-5 w-5 shrink-0 text-teal-600"
                          />
                          <div>
                            <p className="font-display text-lg font-extrabold text-slate-950">
                              {item.value}
                            </p>
                            <p className="text-[11px] font-semibold text-slate-500">
                              {item.label}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PageContainer>
      </section>
    </div>
  );
}
