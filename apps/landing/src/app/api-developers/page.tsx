import { createPageMetadata } from "@/lib/metadata";
import { Code2, Database, GitBranch, ShieldCheck, Webhook } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";

export const metadata = createPageMetadata({
  title: "Vercent ERP API and Integrations",
  description:
    "Explore the planned versioned API, webhook, integration and governed extension architecture for Vercent ERP.",
  path: "/api-developers",
});

const principles = [
  {
    icon: Code2,
    title: "Versioned contracts",
    description:
      "Public API contracts will use explicit versions and controlled compatibility rules.",
  },
  {
    icon: ShieldCheck,
    title: "Scoped access",
    description:
      "Integration access will follow tenant, organisation, role and permission boundaries.",
  },
  {
    icon: Webhook,
    title: "Business events",
    description:
      "Approved external systems can react to meaningful ERP lifecycle events.",
  },
  {
    icon: Database,
    title: "Governed records",
    description:
      "Integrations operate through validated application contracts rather than direct database access.",
  },
];

const exampleLines = [
  "POST /api/v1/sales-orders",
  "Authorization: Bearer <integration-token>",
  "Idempotency-Key: <unique-request-id>",
  "Content-Type: application/json",
  "",
  "{",
  '  "customerId": "customer_123",',
  '  "companyId": "company_001",',
  '  "items": [',
  '    { "productId": "product_42", "quantity": 10 }',
  "  ]",
  "}",
];

export default function ApiDevelopersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Developer platform"
        title="Connect Vercent ERP without bypassing business controls."
        description="The integration architecture is being designed around versioned contracts, tenant-safe access, idempotent operations, business events and traceable changes."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="API principles"
            title="Integrations should behave like controlled ERP participants."
            description="The examples describe the planned contract direction. Public production credentials and final API documentation will be released only when the services are ready."
            align="center"
          />

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {principles.map((principle) => {
              const Icon = principle.icon;

              return (
                <article
                  key={principle.title}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6 text-indigo-600"
                  />

                  <h2 className="font-display mt-4 text-lg font-extrabold text-slate-950">
                    {principle.title}
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {principle.description}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <GitBranch
                aria-hidden="true"
                className="h-7 w-7 text-indigo-600"
              />

              <h2 className="font-display mt-4 text-2xl font-extrabold text-slate-950">
                Planned integration surfaces
              </h2>

              <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
                <li>REST API contracts for core resources</li>
                <li>Outbound business-event webhooks</li>
                <li>Import and migration tooling</li>
                <li>Shared SDK and generated types</li>
                <li>Audit and idempotency support</li>
              </ul>
            </div>

            <div className="overflow-hidden rounded-2xl bg-slate-950">
              <div className="border-b border-white/10 px-5 py-3 text-xs font-bold text-slate-400">
                Planned contract example
              </div>

              <pre className="overflow-x-auto p-6 text-sm leading-7 text-indigo-100">
                <code>{exampleLines.join("\n")}</code>
              </pre>
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
