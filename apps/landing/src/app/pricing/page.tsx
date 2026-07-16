import {
  ArrowRight,
  Building2,
  Check,
  Database,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Vercent ERP Pricing",
  description:
    "Choose an unlimited-user Vercent ERP plan based on companies, branches, storage and operational volume.",
  path: "/pricing",
});

type PublicPlan = {
  code: string;
  name: string;
  audience: string;
  monthly: string;
  yearly: string;
  onboarding: string;
  companies: string;
  branches: string;
  storage: string;
  api: string;
  automation: string;
  features: string[];
  featured?: boolean;
};

const plans: PublicPlan[] = [
  {
    code: "launch",
    name: "Launch",
    audience:
      "Small businesses replacing spreadsheets with one governed workspace.",
    monthly: "₹3,999",
    yearly: "₹39,990",
    onboarding: "Self-guided onboarding included",
    companies: "1 company",
    branches: "2 branches",
    storage: "25 GB",
    api: "100,000 API requests / month",
    automation: "5,000 automation or outbound actions / month",
    features: [
      "Unlimited users",
      "CRM and business master data",
      "Roles, approvals and audit history",
      "Standard email support",
    ],
  },
  {
    code: "growth",
    name: "Growth",
    audience:
      "Growing distribution, service and multi-location operating teams.",
    monthly: "₹9,999",
    yearly: "₹99,990",
    onboarding: "₹19,999 one-time implementation package",
    companies: "3 companies",
    branches: "10 branches",
    storage: "100 GB",
    api: "500,000 API requests / month",
    automation: "25,000 automation or outbound actions / month",
    features: [
      "Unlimited users",
      "Everything in Launch",
      "Priority implementation support",
      "Advanced workflows and reporting capacity",
    ],
    featured: true,
  },
  {
    code: "scale",
    name: "Scale",
    audience:
      "Established multi-company businesses with higher operational volume.",
    monthly: "₹24,999",
    yearly: "₹2,49,990",
    onboarding: "₹74,999 one-time implementation package",
    companies: "10 companies",
    branches: "50 branches",
    storage: "500 GB",
    api: "2,000,000 API requests / month",
    automation: "100,000 automation or outbound actions / month",
    features: [
      "Unlimited users",
      "Everything in Growth",
      "Higher-volume integration capacity",
      "Priority support and rollout governance",
    ],
  },
];

function signupHref() {
  const path = "/signup";
  return siteConfig.appUrl ? `${siteConfig.appUrl}${path}` : path;
}

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Transparent commercial model"
        title="Give every employee access without paying for every seat."
        description="Vercent ERP pricing follows operating capacity—companies, branches, storage, integrations and automation volume—so adoption is not punished while infrastructure costs remain controlled."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-4xl rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm leading-7 text-indigo-950 sm:p-7">
            <strong>
              14-day Launch-capacity trial. No free-forever production plan.
            </strong>{" "}
            Choose a paid plan after organisation onboarding. Annual billing is
            approximately two months cheaper than paying monthly. Prices exclude
            applicable taxes, implementation beyond the listed package,
            third-party messaging, AI consumption and dedicated infrastructure.
          </div>

          <div className="mt-10 grid gap-5 xl:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.code}
                className={`relative flex h-full flex-col rounded-2xl border p-6 shadow-sm sm:p-7 ${
                  plan.featured
                    ? "border-indigo-500 bg-slate-950 text-white shadow-xl"
                    : "border-slate-200 bg-white text-slate-950"
                }`}
              >
                {plan.featured ? (
                  <span className="absolute right-5 top-5 rounded-full bg-indigo-500 px-3 py-1 text-xs font-extrabold text-white">
                    Recommended
                  </span>
                ) : null}

                <p
                  className={`text-xs font-extrabold uppercase tracking-[0.18em] ${plan.featured ? "text-indigo-300" : "text-indigo-600"}`}
                >
                  {plan.name}
                </p>
                <p
                  className={`mt-4 min-h-14 text-sm leading-7 ${plan.featured ? "text-slate-300" : "text-slate-600"}`}
                >
                  {plan.audience}
                </p>

                <div className="mt-6">
                  <p className="font-display text-4xl font-extrabold tracking-[-0.04em]">
                    {plan.monthly}
                    <span
                      className={`ml-1 text-sm font-semibold ${plan.featured ? "text-slate-400" : "text-slate-500"}`}
                    >
                      / month
                    </span>
                  </p>
                  <p
                    className={`mt-2 text-sm ${plan.featured ? "text-emerald-300" : "text-emerald-700"}`}
                  >
                    {plan.yearly} when billed yearly
                  </p>
                  <p
                    className={`mt-2 text-xs ${plan.featured ? "text-slate-400" : "text-slate-500"}`}
                  >
                    {plan.onboarding}
                  </p>
                </div>

                <ul className="mt-7 space-y-3">
                  {[
                    ...plan.features,
                    plan.companies,
                    plan.branches,
                    plan.storage,
                    plan.api,
                    plan.automation,
                  ].map((item) => (
                    <li
                      key={item}
                      className={`flex gap-3 text-sm leading-6 ${plan.featured ? "text-slate-200" : "text-slate-700"}`}
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500"
                      />
                      {item}
                    </li>
                  ))}
                </ul>

                <Link
                  href={signupHref()}
                  className={
                    plan.featured
                      ? "button-primary mt-8"
                      : "button-secondary mt-8"
                  }
                >
                  Start 14-day trial
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {[
              {
                icon: Building2,
                title: "Enterprise",
                text: "Custom scope from ₹60,000 per month, with implementation from ₹2,00,000 for multi-company controls, dedicated environments, integrations and contracted support.",
              },
              {
                icon: Database,
                title: "Cost-protected expansion",
                text: "Additional companies, branches, storage, API capacity, automations, messages and AI credits are quoted separately instead of being hidden inside a loss-making base price.",
              },
              {
                icon: ShieldCheck,
                title: "Commercial governance",
                text: "Published plans are validated against a configurable direct-cost model and minimum gross-margin floor before they can be synced to Razorpay.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-7 w-7 text-indigo-600"
                  />
                  <h2 className="font-display mt-4 text-xl font-extrabold text-slate-950">
                    {item.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {item.text}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 rounded-3xl bg-slate-950 p-7 text-white sm:p-12">
            <div className="max-w-3xl">
              <Sparkles
                aria-hidden="true"
                className="h-8 w-8 text-indigo-300"
              />
              <h2 className="font-display mt-5 text-3xl font-extrabold">
                Implementation remains a separate responsibility.
              </h2>
              <p className="mt-4 leading-8 text-slate-300">
                Data migration, custom integrations, workflow design, training,
                dedicated support and industry-specific configuration can create
                more work than the software subscription itself. A written scope
                protects the customer and VercentLabs from an underfunded
                rollout.
              </p>
              <a
                href={`mailto:${siteConfig.email}?subject=Vercent ERP pricing and implementation discussion`}
                className="button-primary mt-7"
              >
                Discuss an implementation
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
