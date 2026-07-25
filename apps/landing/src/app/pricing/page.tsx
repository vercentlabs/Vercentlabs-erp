import { Check } from "lucide-react";
import Link from "next/link";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorFinalCta,
  OperatorGrid,
  OperatorCard,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Vercent ERP Pricing",
  description:
    "Choose an unlimited-user Vercent ERP plan based on companies, branches, storage and operational volume.",
  path: "/pricing",
});

const plans = [
  {
    code: "launch",
    name: "Launch",
    audience:
      "Small businesses replacing spreadsheets with one governed workspace.",
    monthly: "₹3,999",
    yearly: "₹39,990 yearly",
    onboarding: "Self-guided onboarding included",
    featured: false,
    limits: [
      "Unlimited users",
      "1 company · 2 branches",
      "25 GB storage",
      "100,000 API requests / month",
      "5,000 automation or outbound actions / month",
      "CRM and business master data",
      "Roles, permissions and audit history",
    ],
  },
  {
    code: "growth",
    name: "Growth",
    audience:
      "Growing distribution, service and multi-location operating teams.",
    monthly: "₹9,999",
    yearly: "₹99,990 yearly",
    onboarding: "₹19,999 implementation package",
    featured: true,
    limits: [
      "Unlimited users",
      "3 companies · 10 branches",
      "100 GB storage",
      "500,000 API requests / month",
      "25,000 automation or outbound actions / month",
      "Advanced CRM workflows and priority support",
    ],
  },
  {
    code: "scale",
    name: "Scale",
    audience:
      "Established multi-company businesses with higher operational volume.",
    monthly: "₹24,999",
    yearly: "₹2,49,990 yearly",
    onboarding: "₹74,999 implementation package",
    featured: false,
    limits: [
      "Unlimited users",
      "10 companies · 50 branches",
      "500 GB storage",
      "2,000,000 API requests / month",
      "100,000 automation or outbound actions / month",
      "Higher-volume integrations and rollout governance",
    ],
  },
] as const;

function signupHref() {
  return siteConfig.appUrl ? `${siteConfig.appUrl}/signup` : "/signup";
}

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Commercial model"
        title="Price the operating capacity. Not every person who needs the truth."
        description="Every standard plan includes unlimited users. Commercial limits follow companies, branches, storage, integrations and automation volume so adoption is not punished."
      />

      <OperatorBand
        index="01"
        eyebrow="Plans"
        title="Three operating envelopes. One transparent model."
        description="A 14-day Launch-capacity trial is available. There is no free-forever production plan. Prices exclude applicable taxes, third-party usage and dedicated infrastructure."
        tone="white"
      >
        <div className="operator-price-grid">
          {plans.map((plan) => (
            <article
              key={plan.code}
              className={`operator-price ${plan.featured ? "operator-price--featured" : ""}`}
            >
              <div className="operator-price__label">
                <span>{plan.code}</span>
                {plan.featured ? <span>Recommended</span> : null}
              </div>
              <h2>{plan.name}</h2>
              <p className="operator-price__amount">
                {plan.monthly}
                <span> / month</span>
              </p>
              <p>{plan.audience}</p>
              <p>
                {plan.yearly} · {plan.onboarding}
              </p>
              <ul>
                {plan.limits.map((item) => (
                  <li key={item}>
                    <Check aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href={signupHref()}
                className={
                  plan.featured ? "button-primary" : "button-secondary"
                }
              >
                Start 14-day trial
              </Link>
            </article>
          ))}
        </div>
        <OperatorNote label="Enterprise">
          <p>
            Custom scope starts from ₹60,000 per month, with implementation from
            ₹2,00,000 for dedicated environments, multi-company controls,
            integrations and contracted support.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Commercial discipline"
        title="Implementation is real work. Scope it honestly."
        description="Migration, process design, integrations, training and rollout governance can require more effort than the subscription itself."
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            title="Separate implementation scope"
            description="Define migration, configuration, training, custom development and acceptance criteria before work begins."
          />
          <OperatorCard
            index="02"
            title="Cost-protected expansion"
            description="Additional storage, API, messaging, automation and AI consumption are quoted instead of hidden inside the base price."
          />
          <OperatorCard
            index="03"
            title="Margin-governed plans"
            description="Published plans are validated against direct costs and a minimum gross-margin floor before provider sync."
          />
        </OperatorGrid>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Commercial conversation"
        title="Choose the right operating envelope before rollout."
        description="Share your companies, branches, users, migration volume and workflow scope. We will respond with a grounded recommendation."
        primary={{
          label: "Discuss implementation",
          href: `mailto:${siteConfig.email}?subject=Vercent ERP pricing and implementation discussion`,
        }}
        secondary={{ label: "Review product", href: "/product" }}
      />
    </MarketingShell>
  );
}
