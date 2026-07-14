import type { Metadata } from "next";
import {
  ArrowRight,
  Boxes,
  Building2,
  Check,
  GitBranch,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "ERP Pricing",
  description:
    "Understand how VercentLabs ERP pricing is structured across software, implementation, migration, integrations and support.",
  alternates: {
    canonical: "/pricing",
  },
};

const packages = [
  {
    name: "Foundation",
    eyebrow: "Focused first rollout",
    description:
      "Implement the highest-value business flow with the modules and controls required to operate it.",
    features: [
      "Selected modules and users",
      "Core organisation and role setup",
      "Defined migration scope",
      "Implementation and user training",
      "Standard launch support",
    ],
  },
  {
    name: "Connected Operations",
    eyebrow: "Multiple teams and workflows",
    description:
      "Connect commercial, supply-chain, production, service or people operations through shared processes.",
    features: [
      "Cross-module business flows",
      "Multiple teams or locations",
      "Advanced approvals and reporting",
      "Defined integration scope",
      "Phased rollout and adoption support",
    ],
    featured: true,
  },
  {
    name: "Enterprise Control",
    eyebrow: "Complex organisation scope",
    description:
      "Configure multi-company operations, governed integrations and a controlled transformation roadmap.",
    features: [
      "Multi-company and business-unit setup",
      "Advanced role and policy design",
      "Complex migration and integration",
      "Governance and validation programme",
      "Extended support arrangement",
    ],
  },
];

const costComponents = [
  {
    icon: Boxes,
    title: "Software subscription",
    description:
      "Selected modules, users, companies, locations and the agreed product environment.",
  },
  {
    icon: Workflow,
    title: "Implementation",
    description:
      "Discovery, process design, configuration, validation, training, cutover and adoption.",
  },
  {
    icon: GitBranch,
    title: "Data migration",
    description:
      "Source assessment, cleansing rules, mapping, rehearsal, validation and controlled import.",
  },
  {
    icon: Building2,
    title: "Integrations",
    description:
      "External systems, API contracts, business events, import/export and integration testing.",
  },
  {
    icon: UsersRound,
    title: "Support",
    description:
      "The response model, operating coverage and service arrangement agreed for your organisation.",
  },
  {
    icon: ShieldCheck,
    title: "Governance requirements",
    description:
      "Organisation complexity, permissions, approvals, audit, environments and release controls.",
  },
];

const faqs = [
  {
    question:
      "Why does the page show custom quotes instead of invented prices?",
    answer:
      "ERP cost changes materially with module scope, users, companies, migration, integrations and implementation effort. A scoped proposal is more useful than a headline number that excludes the work required for a successful rollout.",
  },
  {
    question: "Can we start with one workflow and expand later?",
    answer:
      "Yes. A phased implementation can begin with one valuable process and add modules, users, locations and integrations on the same platform foundation.",
  },
  {
    question: "Are implementation and software shown separately?",
    answer:
      "Yes. The proposal separates recurring software, one-time implementation, migration, integrations and any agreed support so each cost is understandable.",
  },
  {
    question: "What information is needed for an accurate proposal?",
    answer:
      "The team needs the target workflows, modules, users, companies, locations, current systems, data sources, integrations, controls, timing and implementation responsibilities.",
  },
  {
    question: "Does the proposal include taxes and commercial terms?",
    answer:
      "The final written proposal identifies applicable taxes, billing schedule, validity, scope assumptions and commercial terms for the specific engagement.",
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Clear commercial scope"
        title="ERP pricing that follows what you actually deploy."
        description="Every proposal separates software, implementation, migration, integration and support so you can understand the complete cost of the selected operating scope."
        actions={
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/contact"
              className="button-primary min-h-11 text-xs sm:min-h-[52px] sm:text-sm"
            >
              Request a scoped proposal
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/comparison"
              className="button-secondary min-h-11 text-xs sm:min-h-[52px] sm:text-sm"
            >
              Compare approaches
            </Link>
          </div>
        }
      />

      <section className="bg-slate-50 py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Engagement options"
            title="Choose the rollout pattern that matches your operating complexity."
            description="Package names organise the conversation; the final proposal is based on validated scope."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3">
            {packages.map((item) => (
              <article
                key={item.name}
                className={
                  "relative flex min-w-0 flex-col rounded-2xl border bg-white p-4 sm:rounded-3xl sm:p-8 " +
                  (item.featured
                    ? "border-indigo-300 shadow-xl shadow-indigo-100"
                    : "border-slate-200")
                }
              >
                {item.featured ? (
                  <span className="absolute right-4 top-4 rounded-full bg-indigo-600 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.1em] text-white sm:right-5 sm:top-5 sm:px-3 sm:text-[10px] sm:tracking-[0.12em]">
                    Most flexible
                  </span>
                ) : null}

                <p className="max-w-[70%] text-xs font-extrabold uppercase tracking-[0.15em] text-indigo-600">
                  {item.eyebrow}
                </p>
                <h2 className="font-display mt-2 text-xl font-extrabold text-slate-950 sm:mt-3 sm:text-2xl">
                  {item.name}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {item.description}
                </p>

                <div className="mt-4 border-y border-slate-200 py-3.5 sm:mt-6 sm:py-5">
                  <p className="font-display text-2xl font-extrabold text-slate-950 sm:text-3xl">
                    Custom quote
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Based on validated scope
                  </p>
                </div>

                <ul className="mt-4 flex-1 space-y-2 sm:mt-6 sm:space-y-3">
                  {item.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-xs font-semibold leading-5 text-slate-700 sm:gap-3 sm:text-sm sm:leading-6"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 sm:h-5 sm:w-5"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/contact"
                  className={
                    "mt-5 min-h-11 w-full text-xs sm:mt-7 sm:min-h-[52px] sm:text-sm " +
                    (item.featured ? "button-primary" : "button-secondary")
                  }
                >
                  Discuss this scope
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="What shapes the proposal"
            title="See every major cost component before making a decision."
            description="The commercial model should make both recurring and implementation costs visible."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {costComponents.map((component) => {
              const Icon = component.icon;

              return (
                <article
                  key={component.title}
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-5 w-5 text-indigo-600 sm:h-6 sm:w-6"
                  />
                  <h2 className="font-display mt-3.5 text-base font-extrabold text-slate-950 sm:mt-5 sm:text-xl">
                    {component.title}
                  </h2>
                  <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                    {component.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="border-y border-slate-200 bg-indigo-50/60 py-10 sm:py-20">
        <PageContainer>
          <div className="grid gap-5 sm:gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                Scope before price
              </p>
              <h2 className="font-display mt-2 text-2xl font-extrabold tracking-[-0.035em] text-slate-950 sm:mt-3 sm:text-4xl">
                A useful proposal begins with one real business workflow.
              </h2>
              <p className="mt-3 text-xs leading-6 text-slate-600 sm:mt-4 sm:text-base sm:leading-7">
                Bring the current process, systems, users, locations, data,
                controls, pain points and desired outcome. The discovery
                conversation turns that context into an understandable scope.
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white p-4 sm:rounded-3xl sm:p-8">
              <h3 className="font-display text-base font-extrabold text-slate-950 sm:text-xl">
                Information to prepare
              </h3>
              <ul className="mt-3.5 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3">
                {[
                  "Priority workflows",
                  "Required modules",
                  "Users and roles",
                  "Companies and locations",
                  "Current systems",
                  "Migration sources",
                  "Required integrations",
                  "Target timeline",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-[10px] font-bold leading-4 text-slate-700 sm:gap-3 sm:rounded-xl sm:p-3 sm:text-sm sm:leading-normal"
                  >
                    <Check
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-emerald-600"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/contact"
                className="button-primary mt-4 w-full text-xs sm:mt-6 sm:text-sm"
              >
                Request a proposal
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer width="narrow">
          <SectionHeading
            eyebrow="Pricing FAQ"
            title="Questions about scope, cost and expansion."
            align="center"
          />

          <div className="mt-7 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 sm:mt-10 sm:rounded-3xl sm:px-7">
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center py-3.5 pr-7 text-left text-sm font-extrabold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 sm:min-h-[64px] sm:py-5 sm:pr-8 sm:text-base">
                  {faq.question}
                </summary>
                <p className="pb-4 text-xs leading-6 text-slate-600 sm:pb-6 sm:text-sm sm:leading-7">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
