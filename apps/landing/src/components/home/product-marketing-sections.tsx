import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  GitBranch,
  LockKeyhole,
  Route,
  ShieldCheck,
  Sparkles,
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

const problems = [
  [
    "Repeated data entry",
    "The same customer, item, order and invoice data is copied between teams.",
  ],
  [
    "Disconnected decisions",
    "Approvals and exceptions disappear inside messages, spreadsheets and calls.",
  ],
  [
    "Unreliable stock",
    "Sales, purchasing and production work from different availability numbers.",
  ],
  [
    "Late reporting",
    "Managers receive consolidated information after the moment for action has passed.",
  ],
  [
    "Weak accountability",
    "Teams cannot quickly see who owns the next step or delayed commitment.",
  ],
  [
    "Costly growth",
    "Every new branch, team or process adds another tool and more reconciliation.",
  ],
];

const foundations = [
  [
    LockKeyhole,
    "Role-based access",
    "Control actions and information by company, location, role and responsibility.",
  ],
  [
    Workflow,
    "Configurable workflows",
    "Model approvals, handoffs, exceptions and business rules without losing control.",
  ],
  [
    GitBranch,
    "Complete traceability",
    "Follow each transaction from origin to operational and financial impact.",
  ],
  [
    Sparkles,
    "Shared reporting",
    "Build dashboards from one governed set of business records.",
  ],
];

export default function ProductMarketingSections() {
  return (
    <>
      <section className="border-t border-slate-100 bg-white py-14 sm:py-16">
        <PageContainer>
          <RevealOnScroll>
            <SectionHeading
              eyebrow="Why businesses replace disconnected tools"
              title="Growth should create momentum—not more manual coordination."
              description="Vercent ERP removes the operational gaps created when departments manage one business through separate applications and spreadsheets."
              align="center"
            />
          </RevealOnScroll>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map(([title, description], index) => (
              <RevealOnScroll key={title} delay={index * 40}>
                <article className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-1 hover:border-rose-200 hover:bg-rose-50/60 hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                    <AlertTriangle aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <h3 className="font-display mt-4 text-base font-extrabold text-slate-950">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {description}
                  </p>
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section id="modules" className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="12 ERP modules"
              title="Every core department. One shared operating foundation."
              description="Start with the modules you need and expand without rebuilding customers, suppliers, items, employees, permissions or reporting."
            />
            <Link
              href="/modules"
              className="inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600 hover:text-indigo-800"
            >
              View all module capabilities
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {erpModules.map((item, index) => (
              <Link
                key={item.slug}
                href={"/modules/" + item.slug}
                className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg"
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
                  {item.name}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                  {item.summary}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-indigo-600">
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

      <section
        id="workflows"
        className="relative overflow-hidden bg-white py-14 sm:py-16"
      >
        <PageContainer>
          <SectionHeading
            eyebrow="6 end-to-end workflows"
            title="Transactions stay connected as responsibility moves between teams."
            description="Each workflow carries data, documents, approvals and accounting impact from beginning to end."
            align="center"
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {businessFlows.map((flow, index) => (
              <article
                key={flow.name}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                    <Route aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-indigo-600">
                    Flow {index + 1}
                  </span>
                </div>
                <h3 className="font-display mt-4 text-xl font-extrabold text-slate-950">
                  {flow.name}
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  {flow.summary}
                </p>
                <ol className="mt-5 flex flex-wrap gap-2">
                  {flow.stages.map((stage, stageIndex) => (
                    <li
                      key={stage}
                      className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
                    >
                      <span className="text-indigo-600">{stageIndex + 1}</span>
                      {stage}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <Link href="/how-it-works" className="button-secondary">
              See how implementation works
            </Link>
          </div>
        </PageContainer>
      </section>

      <section className="bg-slate-950 py-14 text-white sm:py-16">
        <PageContainer>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-300">
                Platform foundation
              </p>
              <h2 className="font-display mt-3 text-3xl font-extrabold tracking-[-0.035em] sm:text-4xl">
                Control every module with the same security and governance
                model.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
                Identity, access, approvals, audit history, documents and
                reporting are shared platform services—not separate
                afterthoughts.
              </p>
              <Link
                href="/security"
                className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-300 hover:text-white"
              >
                Review security and governance
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {foundations.map(([Icon, title, description]) => {
                const FoundationIcon = Icon as typeof ShieldCheck;
                return (
                  <article
                    key={String(title)}
                    className="rounded-2xl border border-white/10 bg-white/5 p-5"
                  >
                    <FoundationIcon
                      aria-hidden="true"
                      className="h-6 w-6 text-teal-300"
                    />
                    <h3 className="font-display mt-4 text-lg font-extrabold">
                      {String(title)}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {String(description)}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              eyebrow="Industry-ready operations"
              title="Configure the platform around the way your business actually works."
              description="Use shared ERP foundations with workflows, controls and reporting shaped for each operating environment."
            />
            <Link
              href="/industries"
              className="inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
            >
              Explore industry solutions
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={"/industries/" + industry.slug}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-teal-200 hover:shadow-md"
              >
                <Building2
                  aria-hidden="true"
                  className="h-6 w-6 text-teal-700"
                />
                <h3 className="font-display mt-4 text-lg font-extrabold text-slate-950">
                  {industry.name}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {industry.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-teal-700">
                  View solution{" "}
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

      <section className="bg-slate-50 py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="Implementation"
            title="Move to one ERP through a controlled, phased rollout."
            align="center"
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              [
                "Discover",
                "Map processes, controls, data, integrations and success measures.",
              ],
              [
                "Configure",
                "Set up modules, roles, workflows, master data and reports.",
              ],
              [
                "Validate",
                "Test real scenarios, migrate data and prepare users.",
              ],
              [
                "Go live",
                "Control cutover, monitor adoption and expand with confidence.",
              ],
            ].map(([title, description], index) => (
              <article
                key={title}
                className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5"
              >
                <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                  Step {index + 1}
                </span>
                <h3 className="font-display mt-3 text-lg font-extrabold text-slate-950">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {description}
                </p>
                <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-indigo-600 to-teal-500" />
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="Frequently asked questions"
            title="Everything you need before booking a demo."
            align="center"
          />
          <div className="mx-auto mt-9 max-w-3xl space-y-3">
            {frequentlyAskedQuestions.map((item) => (
              <details
                key={item.question}
                className="group rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
              >
                <summary className="cursor-pointer list-none pr-8 font-display text-sm font-extrabold text-slate-950">
                  {item.question}
                </summary>
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm leading-7 text-slate-600">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-12 text-center text-white sm:px-10">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-indigo-600/35 blur-[100px]"
            />
            <div className="relative mx-auto max-w-2xl">
              <span className="inline-flex rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-200">
                See Vercent ERP in your workflow
              </span>
              <h2 className="font-display mt-4 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
                Replace disconnected tools with one clear operating system.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">
                Book a personalised walkthrough based on your departments,
                locations, current systems and priority processes.
              </p>
              <Link href="/contact" className="button-primary mt-7">
                Book a demo{" "}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </PageContainer>
      </section>
    </>
  );
}
