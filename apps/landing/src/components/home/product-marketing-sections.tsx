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
    title: "VercentLabs ERP",
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
    question: "Can VercentLabs ERP support multiple companies and locations?",
    answer:
      "Yes. Organisation boundaries, locations, roles, permissions and reporting are part of the shared platform foundation.",
  },
  {
    question: "How does VercentLabs ERP compare with our current tools?",
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
        className="border-b border-slate-200 bg-white py-4 sm:py-6"
      >
        <PageContainer>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            {[
              ["12", "separate ERP modules"],
              ["6", "connected business flows"],
              ["One", "shared data foundation"],
              ["Flexible", "phased implementation"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center sm:rounded-2xl sm:px-4 sm:py-4"
              >
                <p className="font-display text-lg font-extrabold text-slate-950 sm:text-xl">
                  {value}
                </p>
                <p className="mt-0.5 text-[10px] font-semibold leading-4 text-slate-500 sm:mt-1 sm:text-xs sm:leading-normal">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </PageContainer>
      </section>

      <section id="problems" className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Why connected ERP"
            title="Operational growth becomes expensive when every team runs a different system."
            description="VercentLabs ERP replaces repeated entry and unclear handoffs with connected records, responsibilities and controls."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:gap-5 md:grid-cols-3">
            {problems.map((problem) => {
              const Icon = problem.icon;

              return (
                <article
                  key={problem.title}
                  className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 sm:rounded-3xl sm:p-7"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-600 shadow-sm sm:h-11 sm:w-11 sm:rounded-2xl">
                    <Icon
                      aria-hidden="true"
                      className="h-4 w-4 sm:h-5 sm:w-5"
                    />
                  </div>
                  <h2 className="font-display mt-3.5 text-base font-extrabold text-slate-950 sm:mt-5 sm:text-xl">
                    {problem.title}
                  </h2>
                  <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
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
        className="border-y border-slate-200 bg-slate-50 py-10 sm:py-20 lg:py-24"
      >
        <PageContainer>
          <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Complete product scope"
              title="Twelve modules. One operating foundation."
              description="Use each module independently while keeping customers, suppliers, items, employees, approvals and reporting connected."
            />
            <Link
              href="/modules"
              className="button-secondary min-h-11 w-full shrink-0 px-4 text-xs sm:w-auto sm:px-5 sm:text-sm"
            >
              View all module details
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {erpModules.map((erpModule, index) => {
              const Icon = moduleIcons[index] ?? Boxes;

              return (
                <Link
                  key={erpModule.slug}
                  href={"/modules/" + erpModule.slug}
                  className="group min-w-0 rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 sm:rounded-2xl sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 sm:h-10 sm:w-10 sm:rounded-xl">
                      <Icon
                        aria-hidden="true"
                        className="h-4 w-4 sm:h-5 sm:w-5"
                      />
                    </span>
                    <span className="text-[10px] font-extrabold text-slate-400 sm:text-xs">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  <h2 className="font-display mt-3.5 text-base font-extrabold text-slate-950 sm:mt-5 sm:text-lg">
                    {erpModule.name}
                  </h2>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">
                    {erpModule.summary}
                  </p>
                  <span className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-extrabold text-indigo-600 sm:mt-5 sm:gap-2 sm:text-sm">
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

      <section id="workflows" className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="End-to-end workflows"
            title="Business events move across modules without losing context."
            description="Each flow connects records, people, approvals and financial impact from beginning to end."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-2">
            {businessFlows.map((flow, index) => (
              <article
                key={flow.name}
                className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7"
              >
                <div className="flex items-start gap-3 sm:gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 font-display text-xs font-extrabold text-teal-700 sm:h-11 sm:w-11 sm:rounded-2xl sm:text-sm">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-extrabold text-slate-950 sm:text-xl">
                      {flow.name}
                    </h2>
                    <p className="mt-1.5 text-xs leading-6 text-slate-600 sm:mt-2 sm:text-sm sm:leading-7">
                      {flow.summary}
                    </p>
                  </div>
                </div>

                <ol className="mt-4 flex flex-wrap gap-1.5 sm:mt-5 sm:gap-2">
                  {flow.stages.map((stage, stageIndex) => (
                    <li
                      key={stage}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-700 sm:gap-2 sm:px-3 sm:py-2 sm:text-xs"
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
        className="border-y border-slate-200 bg-slate-950 py-10 text-white sm:py-20 lg:py-24"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="Shared platform"
            title="The controls underneath every module matter as much as the screens."
            description="Permissions, approvals, history and reporting apply consistently across the complete ERP."
            align="center"
            tone="dark"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {platformCapabilities.map((capability) => {
              const Icon = capability.icon;

              return (
                <article
                  key={capability.title}
                  className="rounded-xl border border-white/10 bg-white/[0.06] p-4 sm:rounded-2xl sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-5 w-5 text-teal-300 sm:h-6 sm:w-6"
                  />
                  <h2 className="font-display mt-3.5 text-base font-extrabold text-white sm:mt-5 sm:text-lg">
                    {capability.title}
                  </h2>
                  <p className="mt-2 text-xs leading-6 text-slate-300 sm:mt-3 sm:text-sm sm:leading-7">
                    {capability.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section id="industries" className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Industry solutions"
              title="Configure the ERP around the way your organisation operates."
              description="Industry context changes workflows, controls, master data, reporting and implementation priorities."
            />
            <Link
              href="/industries"
              className="button-secondary min-h-11 w-full shrink-0 px-4 text-xs sm:w-auto sm:px-5 sm:text-sm"
            >
              Explore industries
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={"/industries/" + industry.slug}
                className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-1 hover:border-teal-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 sm:rounded-2xl sm:p-6"
              >
                <Building2
                  aria-hidden="true"
                  className="h-5 w-5 text-teal-600 sm:h-6 sm:w-6"
                />
                <h2 className="font-display mt-3.5 text-base font-extrabold text-slate-950 sm:mt-5 sm:text-xl">
                  {industry.name}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {industry.description}
                </p>
                <span className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-extrabold text-teal-700 sm:mt-5 sm:gap-2 sm:text-sm">
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
        className="border-y border-slate-200 bg-indigo-50/50 py-10 sm:py-20 lg:py-24"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="Pricing"
            title="Pay for the operating scope you actually need."
            description="Every proposal separates software, implementation, migration, integration and support so the commercial scope remains understandable."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3">
            {pricingOptions.map((option, index) => (
              <article
                key={option.name}
                className={
                  "relative rounded-2xl border bg-white p-4 sm:rounded-3xl sm:p-7 " +
                  (index === 1
                    ? "border-indigo-300 shadow-xl shadow-indigo-100"
                    : "border-slate-200")
                }
              >
                {index === 1 ? (
                  <span className="absolute right-4 top-4 rounded-full bg-indigo-600 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.1em] text-white sm:right-5 sm:top-5 sm:px-3 sm:text-[10px] sm:tracking-[0.12em]">
                    Most flexible
                  </span>
                ) : null}

                <p className="max-w-[60%] text-[10px] font-extrabold uppercase tracking-[0.13em] text-indigo-600 sm:max-w-none sm:text-xs sm:tracking-[0.15em]">
                  {option.fit}
                </p>
                <h2 className="font-display mt-2 text-xl font-extrabold text-slate-950 sm:mt-3 sm:text-2xl">
                  {option.name}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {option.description}
                </p>
                <p className="font-display mt-4 text-2xl font-extrabold text-slate-950 sm:mt-6 sm:text-3xl">
                  Custom quote
                </p>
                <ul className="mt-4 space-y-2 sm:mt-6 sm:space-y-3">
                  {option.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-xs font-semibold leading-5 text-slate-700 sm:gap-3 sm:text-sm sm:leading-6"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 sm:h-5 sm:w-5"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:mt-8 sm:flex-row sm:gap-3">
            <Link
              href="/pricing"
              className="button-primary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
            >
              Understand pricing
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="button-secondary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
            >
              Request a scoped proposal
            </Link>
          </div>
        </PageContainer>
      </section>

      <section id="comparison" className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Compare approaches"
            title="Choose an operating model, not only a feature list."
            description="Evaluate how each approach handles shared data, workflows, controls, reporting, implementation and future expansion."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {comparisonPoints.map((point, index) => (
              <article
                key={point.title}
                className={
                  "rounded-xl border p-4 sm:rounded-2xl sm:p-6 " +
                  (index === comparisonPoints.length - 1
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-slate-200 bg-slate-50")
                }
              >
                <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.14em]">
                  Approach {index + 1}
                </p>
                <h2 className="font-display mt-2 text-base font-extrabold text-slate-950 sm:mt-3 sm:text-lg">
                  {point.title}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {point.detail}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-6 text-center sm:mt-8">
            <Link
              href="/comparison"
              className="button-secondary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
            >
              Open the full comparison
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </PageContainer>
      </section>

      <section
        id="implementation"
        className="border-y border-slate-200 bg-slate-50 py-10 sm:py-20 lg:py-24"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="Implementation"
            title="Introduce change in controlled, understandable stages."
            description="A successful ERP rollout aligns process, data, controls, technology and user adoption."
            align="center"
          />

          <ol className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {implementationStages.map((stage) => (
              <li
                key={stage.number}
                className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-6"
              >
                <span className="font-display text-xs font-extrabold text-indigo-600 sm:text-sm">
                  {stage.number}
                </span>
                <h2 className="font-display mt-3 text-base font-extrabold text-slate-950 sm:mt-4 sm:text-xl">
                  {stage.title}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {stage.description}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-6 text-center sm:mt-8">
            <Link
              href="/how-it-works"
              className="button-secondary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
            >
              Review the implementation approach
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </PageContainer>
      </section>

      <section id="security" className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="grid gap-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 sm:gap-8 sm:rounded-3xl sm:p-9 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <ShieldCheck
                aria-hidden="true"
                className="h-7 w-7 text-indigo-600 sm:h-9 sm:w-9"
              />
              <p className="mt-3.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-indigo-600 sm:mt-5 sm:text-xs sm:tracking-[0.16em]">
                Security and governance
              </p>
              <h2 className="font-display mt-2 text-2xl font-extrabold tracking-[-0.035em] text-slate-950 sm:mt-3 sm:text-4xl">
                Keep access, responsibility and change visible.
              </h2>
              <p className="mt-3 text-xs leading-6 text-slate-600 sm:mt-4 sm:text-base sm:leading-7">
                Identity, least-privilege permissions, approval authority,
                organisation boundaries and audit history form the control
                foundation of every module.
              </p>
              <Link
                href="/security"
                className="button-primary mt-5 text-xs sm:mt-6 sm:text-sm"
              >
                Review the security approach
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
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
                  className="flex min-h-12 items-center gap-2 rounded-xl border border-indigo-100 bg-white p-2.5 sm:min-h-16 sm:gap-3 sm:rounded-2xl sm:p-4"
                >
                  <LockKeyhole
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-indigo-600 sm:h-5 sm:w-5"
                  />
                  <p className="text-[10px] font-bold leading-4 text-slate-700 sm:text-sm sm:leading-normal">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>

      <section
        id="faq"
        className="border-y border-slate-200 bg-slate-50 py-10 sm:py-20 lg:py-24"
      >
        <PageContainer width="narrow">
          <SectionHeading
            eyebrow="Frequently asked questions"
            title="The practical questions teams ask before choosing an ERP."
            description="Use these answers as a starting point for a scoped product and implementation discussion."
            align="center"
          />

          <div className="mt-7 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 sm:mt-10 sm:rounded-3xl sm:px-7">
            {faqs.map((faq, index) => (
              <details key={faq.question} className="group" open={index === 0}>
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 py-3.5 pr-7 text-left text-sm font-extrabold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 sm:min-h-[64px] sm:gap-6 sm:py-5 sm:pr-8 sm:text-base">
                  {faq.question}
                </summary>
                <p className="max-w-2xl pb-4 text-xs leading-6 text-slate-600 sm:pb-6 sm:text-sm sm:leading-7">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <div className="relative overflow-hidden rounded-2xl bg-slate-950 px-4 py-8 text-center text-white sm:rounded-[2rem] sm:px-10 sm:py-16">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-600/40 blur-[110px]"
            />
            <div className="relative mx-auto max-w-3xl">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-teal-300 sm:text-xs sm:tracking-[0.17em]">
                See VercentLabs ERP in your operating context
              </p>
              <h2 className="font-display mt-3 text-balance text-2xl font-extrabold tracking-[-0.04em] sm:mt-4 sm:text-4xl lg:text-5xl">
                Bring one real workflow. Leave with a clear ERP scope.
              </h2>
              <p className="mx-auto mt-3.5 max-w-2xl text-xs leading-6 text-slate-300 sm:mt-5 sm:text-base sm:leading-7">
                Share your current systems, process owners, modules, users,
                locations, integrations and business priorities for a focused
                demonstration.
              </p>
              <div className="mt-5 flex flex-col justify-center gap-2.5 sm:mt-8 sm:flex-row sm:gap-3">
                <Link
                  href="/contact"
                  className="button-primary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
                >
                  Book a personalised demo
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 text-xs font-extrabold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:min-h-[52px] sm:w-auto sm:px-6 sm:text-sm"
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
