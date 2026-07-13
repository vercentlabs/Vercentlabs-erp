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
import { businessFlows, erpModules, industries } from "@/content/erp";

const moduleIcons = [
  Layers3,
  Route,
  Sparkles,
  UsersRound,
  Boxes,
  Workflow,
  GitBranch,
  LockKeyhole,
  Building2,
  ShieldCheck,
  Network,
  UsersRound,
];

const problems = [
  {
    icon: AlertTriangle,
    title: "Teams work from different versions of the truth",
    description:
      "Sales, finance, purchasing, operations and people teams repeat data across disconnected systems.",
  },
  {
    icon: Route,
    title: "Work slows down at every handoff",
    description:
      "Approvals, documents and responsibilities move through calls, messages and spreadsheets.",
  },
  {
    icon: Network,
    title: "Reporting arrives after the decision",
    description:
      "Leaders spend time consolidating information instead of acting on current operational context.",
  },
];

const platformCapabilities = [
  {
    icon: ShieldCheck,
    title: "Roles and permissions",
    description:
      "Control access by company, location, team, responsibility and business action.",
  },
  {
    icon: Workflow,
    title: "Approvals and automation",
    description:
      "Route decisions, exceptions and repeatable tasks through governed workflows.",
  },
  {
    icon: GitBranch,
    title: "Audit and traceability",
    description:
      "Retain record history, ownership, approvals and meaningful business changes.",
  },
  {
    icon: Layers3,
    title: "Shared reporting foundation",
    description:
      "Use connected operational and financial data for role-based dashboards and reports.",
  },
];

const pricingOptions = [
  {
    name: "Foundation",
    fit: "A focused first rollout",
    description:
      "Start with the highest-value workflow and the modules, data and controls required to operate it.",
    items: [
      "Selected ERP modules",
      "Core roles and approvals",
      "Data migration scope",
      "Implementation and training",
    ],
  },
  {
    name: "Connected Operations",
    fit: "Multiple teams and workflows",
    description:
      "Connect commercial, supply-chain, production, service or people processes on one platform.",
    items: [
      "Cross-module workflows",
      "Multiple teams or locations",
      "Integrations and reporting",
      "Structured rollout support",
    ],
  },
  {
    name: "Enterprise Control",
    fit: "Complex organisations",
    description:
      "Configure multi-company operations, advanced governance, integrations and phased transformation.",
    items: [
      "Multi-company structures",
      "Advanced permissions",
      "Custom integration scope",
      "Governance and adoption plan",
    ],
  },
];

const comparisonPoints = [
  {
    title: "Spreadsheets and point tools",
    detail:
      "Quick to start, but data and responsibility fragment as operations grow.",
  },
  {
    title: "Accounting-only systems",
    detail:
      "Strong for books, but operational workflows often remain outside the system.",
  },
  {
    title: "Traditional legacy ERP",
    detail:
      "Broad capability, but change and usability can become expensive or specialist-dependent.",
  },
  {
    title: "Vercent ERP",
    detail:
      "Twelve modular applications on one shared data, workflow and control foundation.",
  },
];

const implementationStages = [
  {
    number: "01",
    title: "Discover",
    description:
      "Map current processes, data, responsibilities, controls, integrations and success measures.",
  },
  {
    number: "02",
    title: "Design",
    description:
      "Define the target workflow, module scope, roles, approvals, migration and rollout plan.",
  },
  {
    number: "03",
    title: "Configure and validate",
    description:
      "Set up the solution, migrate data and test complete business scenarios with process owners.",
  },
  {
    number: "04",
    title: "Launch and improve",
    description:
      "Train users, control cutover, measure adoption and expand through planned releases.",
  },
];

const faqs = [
  {
    question: "Can we begin with only a few modules?",
    answer:
      "Yes. The platform is modular, so implementation can begin with the workflow that creates the clearest business value and expand without creating a disconnected system.",
  },
  {
    question: "How is pricing calculated?",
    answer:
      "Pricing depends on selected modules, users, companies, locations, implementation effort, migration, integrations and support requirements. The pricing page explains every cost component used in a proposal.",
  },
  {
    question: "Can Vercent ERP support multiple companies and locations?",
    answer:
      "Yes. Organisation boundaries, locations, roles, permissions and reporting are part of the shared platform foundation.",
  },
  {
    question: "How does Vercent ERP compare with our current tools?",
    answer:
      "The comparison page evaluates common operating approaches across data, workflow, controls, reporting, implementation and expansion without relying on unsupported competitor claims.",
  },
  {
    question: "Can the ERP integrate with existing systems?",
    answer:
      "The platform supports controlled integration through APIs, business events, imports and defined application contracts. Final scope depends on each external system.",
  },
  {
    question: "What happens during implementation?",
    answer:
      "Implementation covers discovery, process design, configuration, migration, validation, training, cutover and adoption. The rollout is organised around complete business flows rather than isolated screens.",
  },
];

export default function ProductMarketingSections() {
  return (
    <>
      <section
        aria-label="Product summary"
        className="border-b border-slate-200 bg-white py-6"
      >
        <PageContainer>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["12", "separate ERP modules"],
              ["6", "connected business flows"],
              ["One", "shared data foundation"],
              ["Flexible", "phased implementation"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-center"
              >
                <p className="font-display text-xl font-extrabold text-slate-950">
                  {value}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </PageContainer>
      </section>

      <section id="problems" className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Why connected ERP"
            title="Operational growth becomes expensive when every team runs a different system."
            description="Vercent ERP replaces repeated entry and unclear handoffs with connected records, responsibilities and controls."
            align="center"
          />

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {problems.map((problem) => {
              const Icon = problem.icon;

              return (
                <article
                  key={problem.title}
                  className="rounded-3xl border border-rose-100 bg-rose-50/60 p-6 sm:p-7"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-rose-600 shadow-sm">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {problem.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {problem.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section
        id="modules"
        className="border-y border-slate-200 bg-slate-50 py-16 sm:py-20 lg:py-24"
      >
        <PageContainer>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Complete product scope"
              title="Twelve modules. One operating foundation."
              description="Use each module independently while keeping customers, suppliers, items, employees, approvals and reporting connected."
            />
            <Link
              href="/modules"
              className="button-secondary min-h-11 w-full shrink-0 sm:w-auto"
            >
              View all module details
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {erpModules.map((erpModule, index) => {
              const Icon = moduleIcons[index] ?? Boxes;

              return (
                <Link
                  key={erpModule.slug}
                  href={"/modules/" + erpModule.slug}
                  className="group min-w-0 rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-extrabold text-slate-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  <h2 className="font-display mt-5 text-lg font-extrabold text-slate-950">
                    {erpModule.name}
                  </h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                    {erpModule.summary}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600">
                    Explore
                    <ArrowRight
                      aria-hidden="true"
                      className="h-4 w-4 transition group-hover:translate-x-1"
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section id="workflows" className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="End-to-end workflows"
            title="Business events move across modules without losing context."
            description="Each flow connects records, people, approvals and financial impact from beginning to end."
            align="center"
          />

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {businessFlows.map((flow, index) => (
              <article
                key={flow.name}
                className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-50 font-display text-sm font-extrabold text-teal-700">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-xl font-extrabold text-slate-950">
                      {flow.name}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      {flow.summary}
                    </p>
                  </div>
                </div>

                <ol className="mt-5 flex flex-wrap gap-2">
                  {flow.stages.map((stage, stageIndex) => (
                    <li
                      key={stage}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      <span className="text-indigo-600">{stageIndex + 1}</span>
                      {stage}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      <section
        id="platform"
        className="border-y border-slate-200 bg-slate-950 py-16 text-white sm:py-20 lg:py-24"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="Shared platform"
            title="The controls underneath every module matter as much as the screens."
            description="Permissions, approvals, history and reporting apply consistently across the complete ERP."
            align="center"
          />

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {platformCapabilities.map((capability) => {
              const Icon = capability.icon;

              return (
                <article
                  key={capability.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] p-6"
                >
                  <Icon aria-hidden="true" className="h-6 w-6 text-teal-300" />
                  <h2 className="font-display mt-5 text-lg font-extrabold text-white">
                    {capability.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {capability.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section id="industries" className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Industry solutions"
              title="Configure the ERP around the way your organisation operates."
              description="Industry context changes workflows, controls, master data, reporting and implementation priorities."
            />
            <Link
              href="/industries"
              className="button-secondary min-h-11 w-full shrink-0 sm:w-auto"
            >
              Explore industries
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={"/industries/" + industry.slug}
                className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-teal-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                <Building2
                  aria-hidden="true"
                  className="h-6 w-6 text-teal-600"
                />
                <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                  {industry.name}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {industry.description}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-teal-700">
                  View solution
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

      <section
        id="pricing"
        className="border-y border-slate-200 bg-indigo-50/50 py-16 sm:py-20 lg:py-24"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="Pricing"
            title="Pay for the operating scope you actually need."
            description="Every proposal separates software, implementation, migration, integration and support so the commercial scope remains understandable."
            align="center"
          />

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {pricingOptions.map((option, index) => (
              <article
                key={option.name}
                className={
                  "relative rounded-3xl border bg-white p-6 sm:p-7 " +
                  (index === 1
                    ? "border-indigo-300 shadow-xl shadow-indigo-100"
                    : "border-slate-200")
                }
              >
                {index === 1 ? (
                  <span className="absolute right-5 top-5 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">
                    Most flexible
                  </span>
                ) : null}

                <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-indigo-600">
                  {option.fit}
                </p>
                <h2 className="font-display mt-3 text-2xl font-extrabold text-slate-950">
                  {option.name}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {option.description}
                </p>
                <p className="font-display mt-6 text-3xl font-extrabold text-slate-950">
                  Custom quote
                </p>
                <ul className="mt-6 space-y-3">
                  {option.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className="button-primary min-h-[52px] w-full sm:w-auto"
            >
              Understand pricing
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="button-secondary min-h-[52px] w-full sm:w-auto"
            >
              Request a scoped proposal
            </Link>
          </div>
        </PageContainer>
      </section>

      <section id="comparison" className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Compare approaches"
            title="Choose an operating model, not only a feature list."
            description="Evaluate how each approach handles shared data, workflows, controls, reporting, implementation and future expansion."
            align="center"
          />

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {comparisonPoints.map((point, index) => (
              <article
                key={point.title}
                className={
                  "rounded-2xl border p-6 " +
                  (index === comparisonPoints.length - 1
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-slate-200 bg-slate-50")
                }
              >
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">
                  Approach {index + 1}
                </p>
                <h2 className="font-display mt-3 text-lg font-extrabold text-slate-950">
                  {point.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {point.detail}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/comparison"
              className="button-secondary min-h-[52px] w-full sm:w-auto"
            >
              Open the full comparison
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </PageContainer>
      </section>

      <section
        id="implementation"
        className="border-y border-slate-200 bg-slate-50 py-16 sm:py-20 lg:py-24"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="Implementation"
            title="Introduce change in controlled, understandable stages."
            description="A successful ERP rollout aligns process, data, controls, technology and user adoption."
            align="center"
          />

          <ol className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {implementationStages.map((stage) => (
              <li
                key={stage.number}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <span className="font-display text-sm font-extrabold text-indigo-600">
                  {stage.number}
                </span>
                <h2 className="font-display mt-4 text-xl font-extrabold text-slate-950">
                  {stage.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {stage.description}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-8 text-center">
            <Link
              href="/how-it-works"
              className="button-secondary min-h-[52px] w-full sm:w-auto"
            >
              Review the implementation approach
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </PageContainer>
      </section>

      <section id="security" className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="grid gap-8 rounded-3xl border border-indigo-100 bg-indigo-50 p-6 sm:p-9 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <ShieldCheck
                aria-hidden="true"
                className="h-9 w-9 text-indigo-600"
              />
              <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                Security and governance
              </p>
              <h2 className="font-display mt-3 text-3xl font-extrabold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                Keep access, responsibility and change visible.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
                Identity, least-privilege permissions, approval authority,
                organisation boundaries and audit history form the control
                foundation of every module.
              </p>
              <Link href="/security" className="button-primary mt-6">
                Review the security approach
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "Role-based permissions",
                "Company and location boundaries",
                "Approval authority",
                "Record and activity history",
                "Controlled administration",
                "Integration access scopes",
              ].map((item) => (
                <div
                  key={item}
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-indigo-100 bg-white p-4"
                >
                  <LockKeyhole
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-indigo-600"
                  />
                  <p className="text-sm font-bold text-slate-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>

      <section
        id="faq"
        className="border-y border-slate-200 bg-slate-50 py-16 sm:py-20 lg:py-24"
      >
        <PageContainer width="narrow">
          <SectionHeading
            eyebrow="Frequently asked questions"
            title="The practical questions teams ask before choosing an ERP."
            description="Use these answers as a starting point for a scoped product and implementation discussion."
            align="center"
          />

          <div className="mt-10 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white px-5 sm:px-7">
            {faqs.map((faq, index) => (
              <details key={faq.question} className="group" open={index === 0}>
                <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-6 py-5 pr-8 text-left text-base font-extrabold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600">
                  {faq.question}
                </summary>
                <p className="max-w-2xl pb-6 text-sm leading-7 text-slate-600">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-12 text-center text-white sm:px-10 sm:py-16">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-600/40 blur-[110px]"
            />
            <div className="relative mx-auto max-w-3xl">
              <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-teal-300">
                See Vercent ERP in your operating context
              </p>
              <h2 className="font-display mt-4 text-balance text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl lg:text-5xl">
                Bring one real workflow. Leave with a clear ERP scope.
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Share your current systems, process owners, modules, users,
                locations, integrations and business priorities for a focused
                demonstration.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/contact"
                  className="button-primary min-h-[52px] w-full sm:w-auto"
                >
                  Book a personalised demo
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex min-h-[52px] w-full items-center justify-center rounded-full border border-white/20 bg-white/10 px-6 text-sm font-extrabold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto"
                >
                  Review pricing
                </Link>
              </div>
            </div>
          </div>
        </PageContainer>
      </section>
    </>
  );
}
