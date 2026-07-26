import {
  BriefcaseBusiness,
  Building2,
  GraduationCap,
  UsersRound,
} from "lucide-react";

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
  title: "Vercentlabs Partner Programme",
  description:
    "Explore implementation, industry, integration and delivery partnership opportunities with Vercentlabs.",
  path: "/partner",
});

const types = [
  {
    icon: BriefcaseBusiness,
    title: "Implementation professionals",
    description:
      "Process discovery, configuration, migration, training and adoption experience.",
  },
  {
    icon: Building2,
    title: "Industry specialists",
    description: "Real terminology, controls, reports and exception knowledge.",
  },
  {
    icon: UsersRound,
    title: "Pilot organisations",
    description:
      "Carefully selected operating problems and realistic user scenarios.",
  },
  {
    icon: GraduationCap,
    title: "Learning and talent partners",
    description:
      "Structured opportunities for developers and functional learners.",
  },
] as const;

export default function PartnerPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Partner ecosystem"
        title="Build the product with people who understand the operation."
        description="Vercentlabs is interested in grounded partnerships that improve product quality, industry understanding and implementation capability."
      />
      <OperatorBand
        index="01"
        eyebrow="Partner types"
        title="Expertise should change the product—not decorate the partner page."
        description="The strongest partnerships bring process evidence, delivery capability or a real operating environment."
        tone="white"
      >
        <OperatorGrid columns={4}>
          {types.map((item, index) => (
            <OperatorCard
              key={item.title}
              index={String(index + 1).padStart(2, "0")}
              icon={item.icon}
              title={item.title}
              description={item.description}
            />
          ))}
        </OperatorGrid>
        <OperatorNote label="Expectation">
          <p>
            Partnership discussions should define contribution, ownership,
            confidentiality, commercial boundaries and measurable outcomes.
          </p>
        </OperatorNote>
      </OperatorBand>
      <OperatorFinalCta
        eyebrow="Partner discussion"
        title="Start with the capability you can bring."
        description="Share the market, operating experience, implementation strength or learning model that makes the partnership useful."
        primary={{
          label: "Email a partnership brief",
          href: `mailto:${siteConfig.email}?subject=Vercentlabs partnership discussion`,
        }}
        secondary={{
          label: "See design partner programme",
          href: "/customers",
        }}
      />
    </MarketingShell>
  );
}
