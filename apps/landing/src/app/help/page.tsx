import { BookOpen, LifeBuoy, Mail, ShieldCheck } from "lucide-react";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Vercentlabs Help",
  description:
    "Find product, implementation, security and account guidance for Vercentlabs ERP.",
  path: "/help",
});

export default function HelpPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Help centre"
        title="Find the right path without searching through marketing copy."
        description="Public guidance is organised around product scope, implementation, security and direct support. Production customer documentation will expand with the service."
      />
      <OperatorBand
        index="01"
        eyebrow="Guidance"
        title="Start with the question you are trying to resolve."
        description="Each path leads to current public information rather than an invented documentation library."
        tone="white"
      >
        <OperatorGrid columns={4}>
          <OperatorCard
            index="01"
            icon={BookOpen}
            title="Product scope"
            description="Released CRM, shared platform foundation and roadmap module status."
            href="/product"
          />
          <OperatorCard
            index="02"
            icon={LifeBuoy}
            title="Implementation"
            description="Discovery, pilot, acceptance and rollout expectations."
            href="/how-it-works"
          />
          <OperatorCard
            index="03"
            icon={ShieldCheck}
            title="Security"
            description="Identity, permissions, tenant boundaries and audit controls."
            href="/security"
          />
          <OperatorCard
            index="04"
            icon={Mail}
            title="Direct support"
            description={`Send product or account questions to ${siteConfig.email}.`}
            href={`mailto:${siteConfig.email}`}
          />
        </OperatorGrid>
        <OperatorNote label="Early access">
          <p>
            Support channels and service levels depend on the customer agreement
            and current release stage.
          </p>
        </OperatorNote>
      </OperatorBand>
      <OperatorFinalCta
        eyebrow="Still blocked"
        title="Send the exact question and operating context."
        description="Include the page, workflow, account state and result you expected so the team can respond usefully."
        primary={{ label: "Contact Vercentlabs", href: "/contact" }}
      />
    </MarketingShell>
  );
}
