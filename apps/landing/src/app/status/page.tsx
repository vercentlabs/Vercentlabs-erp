import { Activity, Clock, Wrench } from "lucide-react";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorGrid,
  OperatorNote,
} from "@/components/marketing/operator-page";
import PublicStatusCheck from "@/components/marketing/public-status-check";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Status",
  description:
    "Review the live public website health check and the stated Vercentlabs ERP release status.",
  path: "/status",
});

export default function StatusPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Service status"
        title="Separate live health from product and service commitments."
        description="The public website can report its own current response. Product development state and any future customer service commitment remain separate facts."
      />
      <OperatorBand
        index="01"
        eyebrow="Current state"
        title="Three surfaces. Three different commitments."
        description="Operational status is useful only when it says exactly what was checked."
        tone="white"
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            icon={Activity}
            title="Public landing deployment"
            description="The indicator below calls this deployment's no-cache health endpoint from your browser."
            status="released"
            meta="Live same-origin check"
          >
            <PublicStatusCheck />
          </OperatorCard>
          <OperatorCard
            index="02"
            icon={Wrench}
            title="Vercentlabs ERP product"
            description="Platform foundation and CRM are in controlled early access. Eleven modules remain roadmap."
            status="foundation"
            meta="Active early access"
          />
          <OperatorCard
            index="03"
            icon={Clock}
            title="Production customer service"
            description="No public uptime percentage or contractual service-level commitment is claimed here."
            status="roadmap"
            meta="Agreement-specific"
          />
        </OperatorGrid>
        <OperatorNote label="Contract boundary">
          <p>
            A successful public health response does not prove database
            readiness, provider delivery, customer tenancy or contracted SLA
            performance.
          </p>
        </OperatorNote>
      </OperatorBand>
    </MarketingShell>
  );
}
