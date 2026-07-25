import { Activity, Clock, Wrench } from "lucide-react";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorGrid,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP Status",
  description:
    "Review the operational status of VercentLabs ERP services and the public website.",
  path: "/status",
});

export default function StatusPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Service status"
        title="Publish the actual development state. Not invented uptime."
        description="This page distinguishes the public website, active product development and any future production customer service commitments."
      />
      <OperatorBand
        index="01"
        eyebrow="Current state"
        title="Three surfaces. Three different commitments."
        description="Operational status must remain specific enough to be useful and narrow enough to be true."
        tone="white"
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            icon={Activity}
            title="Public landing application"
            description="Product, module, industry, company and contact routes are available."
            status="released"
            meta="Operational"
          />
          <OperatorCard
            index="02"
            icon={Wrench}
            title="VercentLabs ERP product"
            description="Platform, CRM, mobile, database and release-hardening work is active."
            status="foundation"
            meta="Active development"
          />
          <OperatorCard
            index="03"
            icon={Clock}
            title="Production customer service"
            description="No public production uptime or service-level commitment is currently claimed."
            status="roadmap"
            meta="Not publicly launched"
          />
        </OperatorGrid>
        <OperatorNote label="Contract boundary">
          <p>
            This is a public development summary, not a contractual
            service-level dashboard.
          </p>
        </OperatorNote>
      </OperatorBand>
    </MarketingShell>
  );
}
