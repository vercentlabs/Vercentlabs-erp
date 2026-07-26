import { Database, Eye, KeyRound, ShieldCheck } from "lucide-react";

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
  title: "Security and Governance | Vercentlabs ERP",
  description:
    "Review the identity, permission, organisation, audit and transactional controls implemented across Vercentlabs ERP.",
  path: "/security",
});

const foundations = [
  {
    icon: KeyRound,
    title: "Identity and session control",
    description:
      "Verified accounts, session lifecycle controls, mobile token rotation and explicit organisation context.",
  },
  {
    icon: ShieldCheck,
    title: "Role and permission boundaries",
    description:
      "Navigation, records and actions respond to the active user permission set rather than visual convention alone.",
  },
  {
    icon: Database,
    title: "Tenant and branch isolation",
    description:
      "Organisation, company and branch scope is enforced in service and database access paths.",
  },
  {
    icon: Eye,
    title: "Audit and decision evidence",
    description:
      "Important changes preserve actor, time, context, request and governed decision history.",
  },
] as const;

export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Security and governance"
        title="Control is part of the product model. Not a badge beside the footer."
        description="Vercentlabs is designed around tenant boundaries, explicit permissions, transactional commands and traceable operating evidence."
      />

      <OperatorBand
        index="01"
        eyebrow="Control foundation"
        title="The system should know who can see, change and approve each record."
        description="Security starts with product behaviour and data boundaries before provider certifications or procurement documentation."
        tone="white"
      >
        <OperatorGrid columns={2}>
          {foundations.map((item, index) => (
            <OperatorCard
              key={item.title}
              index={String(index + 1).padStart(2, "0")}
              icon={item.icon}
              title={item.title}
              description={item.description}
              status="foundation"
            />
          ))}
        </OperatorGrid>
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Operational controls"
        title="Fail closed. Preserve context. Leave evidence."
        description="The release verifier and database contracts test the controls expected from the current CRM scope."
        tone="ink"
      >
        <OperatorList
          items={[
            "Organisation-scoped data access",
            "Company and branch validation",
            "Permission-gated navigation and mutations",
            "Transactional approval execution",
            "Immutable consent evidence",
            "Audit-ready record histories",
            "Signed public CRM capture",
            "Retryable leased outbox delivery",
            "Billing entitlement enforcement",
          ]}
        />
        <OperatorNote label="Important">
          <p>
            Production security also depends on deployment configuration,
            secrets management, monitoring, backup, incident response and
            contractual operating procedures.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Security review"
        title="Evaluate the controls against your actual operating risk."
        description="Share your organisation structure, sensitive data, access model, approval boundaries and deployment requirements."
        primary={{ label: "Request a security discussion", href: "/contact" }}
        secondary={{ label: "Read privacy policy", href: "/privacy" }}
      />
    </MarketingShell>
  );
}
