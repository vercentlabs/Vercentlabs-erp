import {
  ArrowRight,
  Building2,
  CircleDollarSign,
  Factory,
  PackageCheck,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import { siteConfig } from "@/lib/site-config";

const capabilities = [
  {
    icon: CircleDollarSign,
    label: "Finance",
  },
  {
    icon: PackageCheck,
    label: "Inventory",
  },
  {
    icon: Factory,
    label: "Manufacturing",
  },
  {
    icon: UsersRound,
    label: "People",
  },
];

const operationalUpdates = [
  {
    title: "Sales order approved",
    detail: "Production demand created automatically",
    status: "Completed",
  },
  {
    title: "Material requirement detected",
    detail: "Procurement request awaiting approval",
    status: "Review",
  },
  {
    title: "Customer payment received",
    detail: "Finance ledger and cash position updated",
    status: "Posted",
  },
];

export default function HeroSection() {
  return (
    <section
      className="hero-grid relative isolate overflow-hidden bg-[#080c18] py-20 text-white sm:py-24 lg:py-28"
      aria-labelledby="hero-heading"
    >
      <div
        aria-hidden="true"
        className="ambient-orb ambient-orb-primary -left-32 top-0 h-96 w-96"
      />

      <div
        aria-hidden="true"
        className="ambient-orb ambient-orb-secondary -right-32 bottom-0 h-96 w-96"
      />

      <PageContainer className="relative">
        <div className="grid items-center gap-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1.5 text-xs font-bold text-indigo-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
              Enterprise operations, connected
            </div>

            <h1
              id="hero-heading"
              className="font-display text-4xl font-extrabold leading-[1.06] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl"
            >
              Run your entire enterprise through{" "}
              <span className="gradient-text">one connected system.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-8 text-slate-400 sm:text-lg">
              Connect finance, procurement, inventory, sales, manufacturing,
              people, projects and analytics through one secure ERP platform.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#platform-preview" className="button-primary">
                Explore the platform
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>

              <a
                href={`mailto:${siteConfig.email}?subject=Vercent ERP product discussion`}
                className="button-secondary"
              >
                Talk to the founding team
              </a>
            </div>

            <div className="mt-9 grid gap-3 text-sm text-slate-400 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-4 w-4 text-indigo-300"
                />
                Role-based control
              </div>

              <div className="flex items-center gap-2">
                <Workflow
                  aria-hidden="true"
                  className="h-4 w-4 text-indigo-300"
                />
                Approval workflows
              </div>

              <div className="flex items-center gap-2">
                <Building2
                  aria-hidden="true"
                  className="h-4 w-4 text-indigo-300"
                />
                Multi-company ready
              </div>
            </div>
          </div>

          <div
            id="platform-preview"
            className="premium-card relative overflow-hidden p-3 sm:p-4"
          >
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1224]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>

                <span className="text-[11px] font-semibold text-slate-500">
                  Enterprise command centre
                </span>
              </div>

              <div className="grid min-h-[430px] md:grid-cols-[145px_1fr]">
                <aside className="hidden border-r border-white/10 bg-black/10 p-4 md:block">
                  <div className="mb-6 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-xs font-black text-white">
                      V
                    </div>

                    <span className="font-display text-xs font-bold">
                      Vercent ERP
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {[
                      "Overview",
                      "Finance",
                      "Procurement",
                      "Inventory",
                      "Sales",
                      "Manufacturing",
                    ].map((item, index) => (
                      <div
                        key={item}
                        className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${
                          index === 0
                            ? "bg-indigo-500/15 text-indigo-200"
                            : "text-slate-500"
                        }`}
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </aside>

                <div className="p-4 sm:p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-300">
                        Operations overview
                      </p>

                      <h2 className="font-display mt-1 text-lg font-bold text-white">
                        Good afternoon, Atharva
                      </h2>
                    </div>

                    <span className="inline-flex w-fit items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                      All systems operational
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {capabilities.map((capability) => {
                      const Icon = capability.icon;

                      return (
                        <div
                          key={capability.label}
                          className="rounded-xl border border-white/10 bg-white/[0.035] p-3"
                        >
                          <Icon
                            aria-hidden="true"
                            className="h-4 w-4 text-indigo-300"
                          />

                          <p className="mt-3 text-[10px] font-semibold text-slate-500">
                            {capability.label}
                          </p>

                          <p className="font-display mt-1 text-sm font-bold text-slate-100">
                            Connected
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-200">
                        Live business activity
                      </p>

                      <span className="text-[10px] font-semibold text-indigo-300">
                        Real-time
                      </span>
                    </div>

                    <div className="mt-3 space-y-3">
                      {operationalUpdates.map((update) => (
                        <div
                          key={update.title}
                          className="flex items-start justify-between gap-4 border-t border-white/10 pt-3 first:border-t-0 first:pt-0"
                        >
                          <div>
                            <p className="text-[11px] font-bold text-slate-200">
                              {update.title}
                            </p>

                            <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                              {update.detail}
                            </p>
                          </div>

                          <span className="shrink-0 rounded-full bg-indigo-500/10 px-2 py-1 text-[9px] font-bold text-indigo-300">
                            {update.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </section>
  );
}
