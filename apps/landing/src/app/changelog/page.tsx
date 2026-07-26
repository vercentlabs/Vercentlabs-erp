import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorGrid,
  OperatorList,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Product Progress",
  description:
    "Follow meaningful public milestones across the Vercentlabs ERP platform, product experience and design-partner readiness.",
  path: "/changelog",
});

const entries = [
  {
    date: "July 2026",
    label: "Product experience",
    title: "Operating-system editorial public website",
    items: [
      "Responsive product-led homepage and supporting-page system",
      "Explicit release, foundation and roadmap taxonomy",
      "Accessible navigation, reduced-motion behaviour and route smoke checks",
      "Preserved SEO, structured data and lead delivery",
    ],
  },
  {
    date: "July 2026",
    label: "Release",
    title: "CRM end-to-end release completion",
    items: [
      "Web and mobile approval initiation",
      "Permission-safe mutation controls",
      "Transactional approval decisions",
      "Release, database, billing and RLS verification",
    ],
  },
  {
    date: "July 2026",
    label: "Platform",
    title: "Multi-tenant ERP foundation",
    items: [
      "Organisation, company and branch context",
      "Shared packages and governed service contracts",
      "Control and tenant migrations",
      "CRM, billing and mobile foundations",
    ],
  },
] as const;

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Product progress"
        title="Track completed foundations without turning every change into launch theatre."
        description="This public record describes meaningful product, platform and readiness milestones. Production customer release notes will begin with production releases."
      />
      <OperatorBand
        index="01"
        eyebrow="Milestones"
        title="What changed. Why it matters. What remains true."
        description="Entries focus on durable system changes instead of cosmetic activity."
        tone="white"
      >
        <OperatorGrid columns={3}>
          {entries.map((entry, index) => (
            <OperatorCard
              key={entry.title}
              index={String(index + 1).padStart(2, "0")}
              eyebrow={entry.label}
              title={entry.title}
              meta={entry.date}
            >
              <OperatorList items={entry.items} />
            </OperatorCard>
          ))}
        </OperatorGrid>
      </OperatorBand>
    </MarketingShell>
  );
}
