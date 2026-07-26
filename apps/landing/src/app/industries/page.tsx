import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { industries } from "@/content/erp";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Industries | Vercentlabs ERP",
  description:
    "See how Vercentlabs ERP is being shaped around manufacturing, distribution, retail, services and multi-company operating contexts.",
  path: "/industries",
});

export default function IndustriesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Operating contexts"
        title="Industry language changes. Control, ownership and evidence do not."
        description="Vercentlabs maps the same governed operating foundation to different business contexts without pretending that one generic workflow fits every organisation."
      />

      <OperatorBand
        index="01"
        eyebrow="Context library"
        title="Start with the operating reality. Then configure the system."
        description="Each industry page frames the problems, handoffs and capabilities that should be validated before broader module work."
        tone="white"
      >
        <OperatorGrid columns={3}>
          {industries.map((industry, index) => (
            <OperatorCard
              key={industry.slug}
              index={String(index + 1).padStart(2, "0")}
              title={industry.name}
              description={industry.description}
              href={`/industries/${industry.slug}`}
              meta={`${industry.challenges.length} operating challenges`}
            />
          ))}
        </OperatorGrid>
        <OperatorNote label="Design principle">
          <p>
            Industry fit is validated through real process discovery, sample
            records, responsibility maps and acceptance scenarios—not by
            changing the colour of a generic dashboard.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Industry workshop"
        title="Bring the process. We will map the operating system."
        description="Share the business structure, current tools, handoffs and control points that make your operation different."
        primary={{ label: "Discuss your industry", href: "/contact" }}
        secondary={{ label: "Review workflows", href: "/workflows" }}
      />
    </MarketingShell>
  );
}
