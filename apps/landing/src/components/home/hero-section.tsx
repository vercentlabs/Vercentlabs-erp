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
        className="relative isolate overflow-hidden border-b border-slate-200 bg-[linear-gradient(180deg,#f8faff_0%,#ffffff_78%)] py-9 sm:py-18 lg:h-[80svh] lg:max-h-[80svh] lg:py-8 xl:py-10"
      >
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-0 -z-10 h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-indigo-200/40 blur-3xl sm:h-[620px] sm:w-[620px]"
        />

        <PageContainer className="lg:h-full">
          <div className="grid min-w-0 items-center gap-8 sm:gap-12 lg:h-full lg:grid-cols-[0.95fr_1.05fr] lg:gap-12 xl:gap-16">
            <div className="min-w-0 text-center lg:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-indigo-700 shadow-sm sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs sm:tracking-[0.14em]">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                />
                Connected enterprise operations
              </span>

              <h1 className="font-display mx-auto mt-4 max-w-4xl text-balance text-3xl font-extrabold leading-[1.08] tracking-[-0.045em] text-slate-950 sm:mt-6 sm:text-5xl lg:mx-0 lg:mt-4 lg:text-5xl xl:text-6xl">
                Run every core operation from one connected ERP.
              </h1>

              <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-6 text-slate-600 sm:mt-6 sm:text-lg sm:leading-8 lg:mx-0 lg:mt-4 lg:text-base lg:leading-7 xl:text-lg">
                VercentLabs ERP connects accounting, procurement, sales, CRM,
                stock, manufacturing, projects, assets, point of sale, quality,
                support, HR and payroll through shared data, workflows,
                permissions and reporting.
              </p>

              <div className="mt-5 flex flex-col gap-2.5 sm:mt-8 sm:flex-row sm:gap-3 sm:justify-center lg:mt-6 lg:justify-start">
                <Link
                  href="/contact"
                  className="button-primary min-h-11 w-full px-4 text-xs sm:min-h-[52px] sm:w-auto sm:px-6 sm:text-sm"
                >
                  Book a personalised demo
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>

                <Link
                  href="/#modules"
                  className="button-secondary min-h-11 w-full px-4 text-xs sm:min-h-[52px] sm:w-auto sm:px-6 sm:text-sm"
                >
                  Explore 12 modules
                </Link>
              </div>

              <ul className="mx-auto mt-5 grid max-w-xl grid-cols-2 gap-2 text-left sm:mt-8 sm:gap-3 lg:mx-0 lg:mt-6 [@media(max-height:899px)]:hidden">
                {[
                  "One source of operational data",
                  "Role-based control and approvals",
                  "Multi-company and multi-location",
                  "API and integration-ready foundation",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-1.5 text-[11px] font-semibold leading-4 text-slate-700 sm:gap-2.5 sm:text-sm sm:leading-6"
                  >
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 sm:h-5 sm:w-5"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0">
              <div className="relative mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_60px_rgba(15,23,42,0.14)] sm:rounded-[1.75rem] sm:p-5 sm:shadow-[0_30px_90px_rgba(15,23,42,0.16)] lg:max-h-full lg:p-3 xl:p-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:rounded-[1.35rem] sm:p-6 lg:p-4 xl:p-5">
                  <div className="flex flex-col gap-2.5 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pb-5 lg:pb-4">
                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-indigo-600 sm:text-xs sm:tracking-[0.15em]">
                        Connected workflow
                      </p>
                      <h2 className="font-display mt-0.5 text-lg font-extrabold text-slate-950 sm:mt-1 sm:text-2xl">
                        Opportunity to cash
                      </h2>
                    </div>

                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold text-emerald-800 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 sm:h-2 sm:w-2" />
                      Live business context
                    </span>
                  </div>

                  <ol className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:mt-4 lg:gap-2 xl:gap-3">
                    {flowSteps.map((step, index) => {
                      const Icon = step.icon;

                      return (
                        <li
                          key={step.label}
                          className="rounded-xl border border-slate-200 bg-white p-2.5 sm:rounded-2xl sm:p-4 lg:p-3 xl:p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 sm:h-10 sm:w-10 sm:rounded-xl">
                              <Icon
                                aria-hidden="true"
                                className="h-4 w-4 sm:h-5 sm:w-5"
                              />
                            </span>
                            <span className="text-[10px] font-extrabold text-slate-400 sm:text-xs">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </div>
                          <p className="mt-2 text-xs font-extrabold text-slate-950 sm:mt-4 sm:text-sm lg:mt-3">
                            {step.label}
                          </p>
                          <p className="mt-0.5 text-[10px] font-semibold text-slate-500 sm:mt-1 sm:text-xs">
                            {step.detail}
                          </p>
                        </li>
                      );
                    })}
                  </ol>

                  <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:mt-4 sm:gap-3 lg:mt-3 lg:gap-2 xl:gap-3">
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
                          className="flex min-w-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2 sm:gap-3 sm:rounded-2xl sm:p-4 lg:p-3 xl:p-4"
                        >
                          <Icon
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 text-teal-600 sm:h-5 sm:w-5"
                          />
                          <div>
                            <p className="font-display text-sm font-extrabold text-slate-950 sm:text-lg">
                              {item.value}
                            </p>
                            <p className="text-[9px] font-semibold leading-3 text-slate-500 sm:text-[11px] sm:leading-normal">
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
