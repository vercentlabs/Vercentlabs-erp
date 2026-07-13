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
    "Understand how Vercent ERP pricing is structured across software, implementation, migration, integrations and support.",
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
            <Link href="/contact" className="button-primary min-h-[52px]">
              Request a scoped proposal
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link href="/comparison" className="button-secondary min-h-[52px]">
              Compare approaches
            </Link>
          </div>
        }
      />

      <section className="bg-slate-50 py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Engagement options"
            title="Choose the rollout pattern that matches your operating complexity."
            description="Package names organise the conversation; the final proposal is based on validated scope."
            align="center"
          />

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {packages.map((item) => (
              <article
                key={item.name}
                className={
                  "relative flex min-w-0 flex-col rounded-3xl border bg-white p-6 sm:p-8 " +
                  (item.featured
                    ? "border-indigo-300 shadow-xl shadow-indigo-100"
                    : "border-slate-200")
                }
              >
                {item.featured ? (
                  <span className="absolute right-5 top-5 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">
                    Most flexible
                  </span>
                ) : null}

                <p className="max-w-[70%] text-xs font-extrabold uppercase tracking-[0.15em] text-indigo-600">
                  {item.eyebrow}
                </p>
                <h2 className="font-display mt-3 text-2xl font-extrabold text-slate-950">
                  {item.name}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {item.description}
                </p>

                <div className="mt-6 border-y border-slate-200 py-5">
                  <p className="font-display text-3xl font-extrabold text-slate-950">
                    Custom quote
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Based on validated scope
                  </p>
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {item.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/contact"
                  className={
                    "mt-7 min-h-[52px] w-full " +
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

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="What shapes the proposal"
            title="See every major cost component before making a decision."
            description="The commercial model should make both recurring and implementation costs visible."
            align="center"
          />

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {costComponents.map((component) => {
              const Icon = component.icon;

              return (
                <article
                  key={component.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6 text-indigo-600"
                  />
                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {component.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {component.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="border-y border-slate-200 bg-indigo-50/60 py-16 sm:py-20">
        <PageContainer>
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                Scope before price
              </p>
              <h2 className="font-display mt-3 text-3xl font-extrabold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                A useful proposal begins with one real business workflow.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
                Bring the current process, systems, users, locations, data,
                controls, pain points and desired outcome. The discovery
                conversation turns that context into an understandable scope.
              </p>
            </div>

            <div className="rounded-3xl border border-indigo-100 bg-white p-6 sm:p-8">
              <h3 className="font-display text-xl font-extrabold text-slate-950">
                Information to prepare
              </h3>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
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
                    className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700"
                  >
                    <Check
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-emerald-600"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/contact" className="button-primary mt-6 w-full">
                Request a proposal
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer width="narrow">
          <SectionHeading
            eyebrow="Pricing FAQ"
            title="Questions about scope, cost and expansion."
            align="center"
          />

          <div className="mt-10 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white px-5 sm:px-7">
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary className="flex min-h-[64px] cursor-pointer list-none items-center py-5 pr-8 text-left text-base font-extrabold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600">
                  {faq.question}
                </summary>
                <p className="pb-6 text-sm leading-7 text-slate-600">
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
