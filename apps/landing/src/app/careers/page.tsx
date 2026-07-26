import { Code2, Settings, Users } from "lucide-react";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorList,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Careers at Vercentlabs",
  description:
    "Explore product, engineering and implementation opportunities at Vercentlabs.",
  path: "/careers",
});

export default function CareersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Careers"
        title="Build systems that people can understand under real operating pressure."
        description="Vercentlabs is interested in builders who care about complete workflows, explicit constraints and the difference between a demo and a dependable product."
      />
      <OperatorBand
        index="01"
        eyebrow="Work areas"
        title="The product needs more than feature delivery."
        description="Enterprise software is shaped by product thinking, engineering discipline, implementation understanding and user evidence."
        tone="white"
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            icon={Code2}
            title="Product engineering"
            description="Web, mobile, API, data, platform, quality and secure delivery."
          />
          <OperatorCard
            index="02"
            icon={Settings}
            title="ERP implementation"
            description="Process discovery, configuration, migration, testing and adoption."
          />
          <OperatorCard
            index="03"
            icon={Users}
            title="Product and customer learning"
            description="Research, workflow validation, content, support and market understanding."
          />
        </OperatorGrid>
      </OperatorBand>
      <OperatorBand
        index="02"
        eyebrow="How we work"
        title="Evidence before ego."
        description="The team should be willing to inspect the system, state uncertainty and improve the operating model."
        tone="ink"
      >
        <OperatorList
          items={[
            "Read the workflow before changing the interface",
            "Test the full path instead of isolated components",
            "Keep release claims aligned with real capability",
            "Prefer maintainable systems over clever fragments",
            "Write decisions and acceptance criteria",
            "Learn from users without copying their current inefficiencies",
          ]}
        />
      </OperatorBand>
      <OperatorFinalCta
        eyebrow="Introduce yourself"
        title="Show the work and the thinking behind it."
        description="Share relevant projects, decisions, failures, learning and the role you want to grow into."
        primary={{
          label: "Email your profile",
          href: `mailto:${siteConfig.email}?subject=Vercentlabs career introduction`,
        }}
        secondary={{ label: "Learn about Vercentlabs", href: "/about" }}
      />
    </MarketingShell>
  );
}
