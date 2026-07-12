import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  GitBranch,
  Layers3,
  LockKeyhole,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import SectionHeading from "@/components/marketing/section-heading";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";
import {
  businessFlows,
  erpModules,
  frequentlyAskedQuestions,
  industries,
} from "@/content/erp";
import { siteConfig } from "@/lib/site-config";

const problems = [
  {
    title: "Disconnected departments",
    description:
      "Sales, purchasing, inventory, finance and operations work from different versions of the truth.",
    className: "border-rose-100 bg-rose-50/80",
    iconClassName: "bg-rose-100 text-rose-600",
  },
  {
    title: "Repeated data entry",
    description:
      "The same customer, order, invoice and stock information is copied between multiple systems.",
    className: "border-amber-100 bg-amber-50/80",
    iconClassName: "bg-amber-100 text-amber-700",
  },
  {
    title: "Invisible approvals",
    description:
      "Requests and decisions move through messages without clear authority, status or traceability.",
    className: "border-indigo-100 bg-indigo-50/80",
    iconClassName: "bg-indigo-100 text-indigo-600",
  },
  {
    title: "Delayed reporting",
    description:
      "Managers receive consolidated information after the moment for action has already passed.",
    className: "border-sky-100 bg-sky-50/80",
    iconClassName: "bg-sky-100 text-sky-600",
  },
  {
    title: "Weak accountability",
    description:
      "Teams struggle to identify who owns the next step, exception or customer commitment.",
    className: "border-violet-100 bg-violet-50/80",
    iconClassName: "bg-violet-100 text-violet-600",
  },
  {
    title: "Difficult expansion",
    description:
      "Every new company, location or workflow adds more tools and more reconciliation work.",
    className: "border-teal-100 bg-teal-50/80",
    iconClassName: "bg-teal-100 text-teal-700",
  },
];

const platformCapabilities = [
  {
    icon: Network,
    title: "Shared business data",
    description:
      "Connect customers, suppliers, products, employees, accounts and transactions through governed records.",
  },
  {
    icon: Workflow,
    title: "Configurable workflows",
    description:
      "Route approvals, responsibilities, exceptions and handoffs through controlled business processes.",
  },
  {
    icon: LockKeyhole,
    title: "Role-based access",
    description:
      "Limit information and actions by role, company, location and operating responsibility.",
  },
  {
    icon: Building2,
    title: "Enterprise structures",
    description:
      "Represent companies, locations, teams, departments and shared-service operations.",
  },
];

const implementationSteps = [
  {
    title: "Discover",
    description:
      "Map current systems, workflows, controls, data problems and priority outcomes.",
  },
  {
    title: "Design",
    description:
      "Define the process scope, roles, approvals, migration and integration requirements.",
  },
  {
    title: "Validate",
    description:
      "Configure selected workflows and test realistic business scenarios with users.",
  },
  {
    title: "Release",
    description:
      "Prepare users, control cutover and expand through planned implementation releases.",
  },
];

export default function ProductMarketingSections() {
  return (
    <>
      <section className="border-t border-slate-100 bg-white py-14 sm:py-16">
        <PageContainer>
          <RevealOnScroll>
            <SectionHeading
              eyebrow="The operating problem"
              title="Growth becomes harder when every team runs a different system."
              description="Disconnected applications create repeated work, delayed decisions and weak accountability across the organisation."
              align="center"
            />
          </RevealOnScroll>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map((problem, index) => (
              <RevealOnScroll key={problem.title} delay={index * 55}>
                <article
                  className={
                    "h-full rounded-2xl border p-5 transition duration-300 hover:-translate-y-1 hover:shadow-md " +
                    problem.className
                  }
                >
                  <div
                    className={
                      "flex h-10 w-10 items-center justify-center rounded-xl " +
                      problem.iconClassName
                    }
                  >
                    <AlertTriangle aria-hidden="true" className="h-5 w-5" />
                  </div>

                  <h3 className="font-display mt-4 text-base font-extrabold text-slate-950">
                    {problem.title}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {problem.description}
                  </p>
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <RevealOnScroll from="left">
              <div>
                <span className="inline-flex rounded-full border border-indigo-200 bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-700">
                  One operating platform
                </span>

                <h2 className="font-display mt-4 text-3xl font-extrabold leading-tight tracking-[-0.035em] text-slate-950 sm:text-4xl">
                  Connect data, workflows, controls and reporting.
                </h2>

                <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
                  Vercent ERP is designed as a shared foundation for complete
                  business processes—not a collection of disconnected
                  departmental screens.
                </p>

                <Link
                  href="/features"
                  className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600 transition hover:text-indigo-800"
                >
                  Explore platform capabilities
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>
            </RevealOnScroll>

            <div className="grid gap-4 sm:grid-cols-2">
              {platformCapabilities.map((capability, index) => {
                const Icon = capability.icon;

                return (
                  <RevealOnScroll
                    key={capability.title}
                    delay={index * 70}
                    from="right"
                  >
                    <article className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-md">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                        <Icon aria-hidden="true" className="h-5 w-5" />
                      </div>

                      <h3 className="font-display mt-4 text-base font-extrabold text-slate-950">
                        {capability.title}
                      </h3>

                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {capability.description}
                      </p>
                    </article>
                  </RevealOnScroll>
                );
              })}
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <RevealOnScroll>
              <SectionHeading
                eyebrow="ERP modules"
                title="Build around the workflows your business needs first."
                description="Ten connected modules share one foundation for data, permissions, approvals and reporting."
              />
            </RevealOnScroll>

            <Link
              href="/modules"
              className="inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600 transition hover:text-indigo-800"
            >
              Explore all modules
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {erpModules.slice(0, 6).map((erpModule, index) => (
              <RevealOnScroll key={erpModule.slug} delay={index * 55}>
                <Link
                  href={"/modules/" + erpModule.slug}
                  className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Boxes aria-hidden="true" className="h-5 w-5" />
                    </div>

                    <span className="text-[11px] font-extrabold text-slate-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  <h3 className="font-display mt-4 text-lg font-extrabold text-slate-950">
                    {erpModule.name}
                  </h3>

                  <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                    {erpModule.summary}
                  </p>

                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-indigo-600">
                    View module
                    <ArrowRight
                      aria-hidden="true"
                      className="h-4 w-4 transition group-hover:translate-x-1"
                    />
                  </span>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="relative overflow-hidden bg-slate-50 py-14 sm:py-16">
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-32 hidden h-[76%] w-px -translate-x-1/2 bg-gradient-to-b from-indigo-200 via-indigo-300 to-teal-200 lg:block"
        />

        <PageContainer>
          <RevealOnScroll>
            <SectionHeading
              eyebrow="End-to-end workflows"
              title="Connect complete business journeys, not isolated screens."
              description="Information, approvals and responsibility stay attached as each transaction moves across departments."
              align="center"
            />
          </RevealOnScroll>

          <ol className="relative mt-10 space-y-5">
            {businessFlows.map((flow, index) => {
              const isEven = index % 2 === 0;

              return (
                <li key={flow.name}>
                  <RevealOnScroll
                    delay={index * 70}
                    from={isEven ? "left" : "right"}
                  >
                    <div className="grid items-center gap-4 lg:grid-cols-[1fr_48px_1fr]">
                      <article
                        className={
                          "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md " +
                          (isEven ? "lg:col-start-1" : "lg:col-start-3")
                        }
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                            <Route aria-hidden="true" className="h-5 w-5" />
                          </div>

                          <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                            Flow {String(index + 1).padStart(2, "0")}
                          </span>
                        </div>

                        <h3 className="font-display mt-4 text-lg font-extrabold text-slate-950">
                          {flow.name}
                        </h3>

                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {flow.summary}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {flow.stages.map((stage) => (
                            <span
                              key={stage}
                              className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700"
                            >
                              {stage}
                            </span>
                          ))}
                        </div>

                        <div className="mt-5 h-0.5 w-8 rounded-full bg-gradient-to-r from-indigo-600 to-teal-500 transition-all duration-300 hover:w-full" />
                      </article>

                      <div className="relative z-10 hidden h-11 w-11 items-center justify-center rounded-full border-4 border-slate-50 bg-indigo-600 text-xs font-extrabold text-white shadow-md lg:col-start-2 lg:row-start-1 lg:flex">
                        {index + 1}
                      </div>
                    </div>
                  </RevealOnScroll>
                </li>
              );
            })}
          </ol>

          <RevealOnScroll delay={320} className="mt-8 flex justify-center">
            <Link href="/how-it-works" className="button-primary">
              See how implementation works
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <RevealOnScroll>
              <SectionHeading
                eyebrow="Industry context"
                title="Configure ERP around the way your organisation operates."
                description="Workflows, controls, terminology and reports must reflect real industry requirements."
              />
            </RevealOnScroll>

            <Link
              href="/industries"
              className="inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600 transition hover:text-indigo-800"
            >
              View all industries
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {industries.map((industry, index) => (
              <RevealOnScroll key={industry.slug} delay={index * 55}>
                <Link
                  href={"/industries/" + industry.slug}
                  className="group block h-full rounded-2xl border border-slate-200 bg-white p-5 transition duration-300 hover:-translate-y-1 hover:border-teal-200 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                    <Building2 aria-hidden="true" className="h-5 w-5" />
                  </div>

                  <h3 className="font-display mt-4 text-lg font-extrabold text-slate-950">
                    {industry.name}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {industry.description}
                  </p>

                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-teal-700">
                    Explore solution
                    <ArrowRight
                      aria-hidden="true"
                      className="h-4 w-4 transition group-hover:translate-x-1"
                    />
                  </span>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <RevealOnScroll>
            <SectionHeading
              eyebrow="Implementation roadmap"
              title="Move from discovery to controlled adoption."
              description="ERP implementation is managed as an operating-change programme, not only a software installation."
              align="center"
            />
          </RevealOnScroll>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {implementationSteps.map((step, index) => (
              <RevealOnScroll key={step.title} delay={index * 70}>
                <article className="relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5">
                  <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                    Step {String(index + 1).padStart(2, "0")}
                  </span>

                  <h3 className="font-display mt-3 text-lg font-extrabold text-slate-950">
                    {step.title}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {step.description}
                  </p>

                  <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-indigo-600 to-teal-500" />
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <RevealOnScroll>
            <div className="grid gap-8 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-teal-50 p-7 sm:p-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
                  <ShieldCheck aria-hidden="true" className="h-6 w-6" />
                </div>

                <h2 className="font-display mt-5 text-3xl font-extrabold leading-tight tracking-[-0.035em] text-slate-950">
                  Control and traceability belong in the platform foundation.
                </h2>

                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Security begins with identity, access boundaries, approval
                  authority, administrative control and traceable business
                  activity.
                </p>

                <Link
                  href="/security"
                  className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
                >
                  Review the security approach
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    icon: LockKeyhole,
                    text: "Role-based permissions",
                  },
                  {
                    icon: Building2,
                    text: "Company and location scope",
                  },
                  {
                    icon: GitBranch,
                    text: "Approval authority",
                  },
                  {
                    icon: Layers3,
                    text: "Audit and change history",
                  },
                  {
                    icon: UsersRound,
                    text: "Controlled administration",
                  },
                  {
                    icon: Sparkles,
                    text: "Governed platform operations",
                  },
                ].map((item) => {
                  const Icon = item.icon;

                  return (
                    <div
                      key={item.text}
                      className="flex items-center gap-3 rounded-2xl border border-white bg-white/85 p-4 shadow-sm"
                    >
                      <Icon
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-indigo-600"
                      />

                      <p className="text-sm font-semibold text-slate-700">
                        {item.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <RevealOnScroll>
            <SectionHeading
              eyebrow="Questions"
              title="Clear expectations before implementation begins."
              align="center"
            />
          </RevealOnScroll>

          <div className="mx-auto mt-9 max-w-3xl space-y-3">
            {frequentlyAskedQuestions.map((item, index) => (
              <RevealOnScroll key={item.question} delay={index * 45}>
                <details className="group rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <summary className="cursor-pointer list-none pr-8 font-display text-sm font-extrabold text-slate-950">
                    {item.question}
                  </summary>

                  <p className="mt-3 border-t border-slate-100 pt-3 text-sm leading-7 text-slate-600">
                    {item.answer}
                  </p>
                </details>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <RevealOnScroll>
            <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-12 text-center text-white sm:px-10">
              <div
                aria-hidden="true"
                className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-indigo-600/35 blur-[100px]"
              />

              <div className="relative mx-auto max-w-2xl">
                <span className="inline-flex rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-200">
                  Build with operational context
                </span>

                <h2 className="font-display mt-4 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
                  Discuss the workflows your ERP must solve first.
                </h2>

                <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">
                  Review current systems, business processes, implementation
                  constraints and the smallest valuable starting scope with
                  VercentLabs.
                </p>

                <a
                  href={
                    "mailto:" +
                    siteConfig.email +
                    "?subject=Vercent ERP discovery discussion"
                  }
                  className="button-primary mt-7"
                >
                  Start a discussion
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </a>
              </div>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>
    </>
  );
}
