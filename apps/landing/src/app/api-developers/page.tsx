import { Code2, Database, ShieldCheck, Webhook } from "lucide-react";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorList,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP API and Integrations",
  description:
    "Explore versioned APIs, webhooks and governed integrations for VercentLabs ERP.",
  path: "/api-developers",
});

const principles = [
  {
    icon: Code2,
    title: "Versioned contracts",
    description:
      "Explicit versions and controlled compatibility rules for public integration surfaces.",
  },
  {
    icon: ShieldCheck,
    title: "Scoped access",
    description:
      "Tenant, organisation, role and permission boundaries remain active for integrations.",
  },
  {
    icon: Webhook,
    title: "Business events",
    description:
      "Approved systems react to meaningful lifecycle events through retryable delivery.",
  },
  {
    icon: Database,
    title: "Governed records",
    description:
      "Integrations use validated application contracts instead of direct database access.",
  },
] as const;

const example = `POST /api/v1/crm/opportunities\nAuthorization: Bearer <integration-token>\nIdempotency-Key: <unique-request-id>\nContent-Type: application/json\n\n{\n  "organizationId": "org_001",\n  "companyId": "company_001",\n  "name": "North region rollout"\n}`;

export default function ApiDevelopersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Developer platform"
        title="Connect the system without bypassing the controls."
        description="Integration architecture follows versioned contracts, scoped access, idempotent commands, business events and traceable changes."
      />

      <OperatorBand
        index="01"
        eyebrow="API principles"
        title="An integration is another governed participant in the operation."
        description="The final public production API will be documented only when the released services and support model are ready."
        tone="white"
      >
        <OperatorGrid columns={4}>
          {principles.map((item, index) => (
            <OperatorCard
              key={item.title}
              index={String(index + 1).padStart(2, "0")}
              icon={item.icon}
              title={item.title}
              description={item.description}
            />
          ))}
        </OperatorGrid>
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Contract direction"
        title="Readable requests. Explicit context. Deterministic outcomes."
        description="The interface should make tenant scope, idempotency and business intent visible in every request."
        tone="ink"
      >
        <div className="os-code-frame">
          <div className="os-code-frame__label">
            Illustrative contract · not a final public endpoint
          </div>
          <pre>
            <code>{example}</code>
          </pre>
        </div>
        <OperatorList
          items={[
            "REST resource contracts",
            "Outbound webhooks",
            "Import and migration tools",
            "Shared SDK and generated types",
            "Audit and idempotency support",
            "Provider fail-closed behaviour",
          ]}
        />
        <OperatorNote label="Release boundary">
          <p>
            Public integration credentials and final documentation are not
            claimed as generally available until the production service is
            ready.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Integration discovery"
        title="Start with the business event—not the connector logo."
        description="Describe the source system, destination, data ownership, trigger, retry behaviour and evidence required after the exchange."
        primary={{ label: "Discuss an integration", href: "/contact" }}
        secondary={{ label: "Review security", href: "/security" }}
      />
    </MarketingShell>
  );
}
