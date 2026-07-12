import {
  ArrowRight,
  Boxes,
  Building2,
  Check,
  GitBranch,
  LockKeyhole,
  Network,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import SectionHeading from "@/components/marketing/section-heading";
import {
  businessFlows,
  erpModules,
  frequentlyAskedQuestions,
  industries,
} from "@/content/erp";
import { siteConfig } from "@/lib/site-config";

const problems = [
  "Departments working in isolated tools",
  "Repeated manual data entry and reconciliation",
  "Approvals managed through messages and spreadsheets",
  "Operational reports produced after decisions are already due",
  "Customer, supplier, inventory and finance data that does not agree",
  "Limited traceability across end-to-end business processes",
];

const platformCapabilities = [
  {
    icon: Network,
    title: "Connected data",
    description:
      "Use governed master data and shared transactions across operational modules.",
  },
  {
    icon: GitBranch,
    title: "Controlled workflows",
    description:
      "Route approvals, exceptions and responsibilities through configurable business rules.",
  },
  {
    icon: LockKeyhole,
    title: "Role-based access",
    description:
      "Limit actions and information by role, organisation, location and responsibility.",
  },
  {
    icon: Building2,
    title: "Enterprise structure",
    description:
      "Support companies, business units, locations, teams and shared-service operations.",
  },
];

export default function ProductMarketingSections() {
  return (
    <>
      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <SectionHeading
              eyebrow="The operating challenge"
              title="Growth becomes harder when every team runs a different system."
              description="Disconnected applications create duplicated work, delayed information and weak accountability across the enterprise."
            />

            <div className="grid gap-3 sm:grid-cols-2">
              {problems.map((problem) => (
                <div
                  key={problem}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                >
                  <p className="font-semibold leading-7 text-slate-700">
                    {problem}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-20 sm:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="One platform"
            title="A shared operating foundation for every core business function."
            description="Vercent ERP is designed to connect processes, permissions, data and reporting without forcing teams to operate in separate silos."
            align="center"
          />

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {platformCapabilities.map((capability) => {
              const Icon = capability.icon;

              return (
                <article
                  key={capability.title}
                  className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>

                  <h3 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {capability.title}
                  </h3>

                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {capability.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="ERP modules"
              title="Build the operating system around your real business."
              description="Begin with the workflows that matter most, while retaining one shared platform for future expansion."
            />

            <Link
              href="/modules"
              className="inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
            >
              Explore all modules
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {erpModules.slice(0, 6).map((erpModule) => (
              <Link
                key={erpModule.slug}
                href={"/modules/" + erpModule.slug}
                className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-xl"
              >
                <Boxes aria-hidden="true" className="h-6 w-6 text-indigo-600" />

                <h3 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                  {erpModule.name}
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {erpModule.summary}
                </p>

                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-indigo-600">
                  View module
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

      <section className="bg-slate-950 py-20 text-white sm:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="End-to-end operations"
            title="Connect complete business flows, not just individual screens."
            description="Transactions should move across departments with ownership, approvals and context preserved."
          />

          <div className="mt-12 space-y-5">
            {businessFlows.map((flow, index) => (
              <article
                key={flow.name}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-8"
              >
                <div className="grid gap-6 lg:grid-cols-[0.45fr_1fr]">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-300">
                      Flow {index + 1}
                    </p>

                    <h3 className="font-display mt-2 text-2xl font-extrabold">
                      {flow.name}
                    </h3>

                    <p className="mt-3 text-sm leading-7 text-slate-400">
                      {flow.summary}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {flow.stages.map((stage, stageIndex) => (
                      <div key={stage} className="flex items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-200">
                          {stage}
                        </span>

                        {stageIndex < flow.stages.length - 1 ? (
                          <ArrowRight
                            aria-hidden="true"
                            className="h-3.5 w-3.5 text-indigo-300"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-20 sm:py-24">
        <PageContainer>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Industry context"
              title="Configure the platform around how your organisation operates."
              description="Industry requirements influence workflows, controls, data, reporting and implementation priorities."
            />

            <Link
              href="/industries"
              className="inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
            >
              View industries
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={"/industries/" + industry.slug}
                className="rounded-3xl border border-slate-200 bg-white p-6 transition hover:border-indigo-200 hover:shadow-lg"
              >
                <Building2
                  aria-hidden="true"
                  className="h-6 w-6 text-teal-600"
                />

                <h3 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                  {industry.name}
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {industry.description}
                </p>
              </Link>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="grid gap-10 rounded-[2rem] bg-indigo-50 p-8 sm:p-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <ShieldCheck
                aria-hidden="true"
                className="h-10 w-10 text-indigo-600"
              />

              <h2 className="font-display mt-6 text-3xl font-extrabold tracking-[-0.035em] text-slate-950">
                Control and traceability belong in the platform foundation.
              </h2>

              <p className="mt-5 leading-8 text-slate-600">
                Security is approached through identity, access, organisation
                scope, approvals, audit history and controlled platform
                operations.
              </p>

              <Link
                href="/security"
                className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
              >
                Review the security approach
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "Role-based permissions",
                "Organisation and location scope",
                "Approval authority",
                "Audit history",
                "Controlled administrative changes",
                "Data and operational boundaries",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl bg-white p-4"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  />

                  <p className="text-sm font-semibold leading-6 text-slate-700">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-20 sm:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Questions"
            title="Clear expectations before implementation begins."
            align="center"
          />

          <div className="mx-auto mt-10 max-w-3xl space-y-3">
            {frequentlyAskedQuestions.map((item) => (
              <details
                key={item.question}
                className="group rounded-2xl border border-slate-200 bg-white p-5"
              >
                <summary className="cursor-pointer list-none font-display font-extrabold text-slate-950">
                  {item.question}
                </summary>

                <p className="mt-4 text-sm leading-7 text-slate-600">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-14 text-center text-white sm:px-12">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-indigo-600/30 blur-[100px]"
            />

            <div className="relative mx-auto max-w-3xl">
              <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-indigo-300">
                Build with operational context
              </p>

              <h2 className="font-display mt-4 text-3xl font-extrabold tracking-[-0.04em] sm:text-5xl">
                Discuss the workflows your ERP must solve first.
              </h2>

              <p className="mx-auto mt-5 max-w-2xl leading-8 text-slate-300">
                Review the current systems, business processes, implementation
                constraints and the smallest valuable starting scope with the
                VercentLabs founding team.
              </p>

              <a
                href={
                  "mailto:" +
                  siteConfig.email +
                  "?subject=Vercent ERP discovery discussion"
                }
                className="button-primary mt-8"
              >
                Start a discussion
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            </div>
          </div>
        </PageContainer>
      </section>
    </>
  );
}
