import { notFound } from "next/navigation";

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
import { getIndustry, industries } from "@/content/erp";
import { createPageMetadata } from "@/lib/metadata";

type IndustryPageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return industries.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: IndustryPageProps) {
  const { slug } = await params;
  const item = getIndustry(slug);
  return item
    ? createPageMetadata({
        title: `${item.name} ERP`,
        description: item.description,
        path: `/industries/${item.slug}`,
      })
    : {};
}

export default async function IndustryPage({ params }: IndustryPageProps) {
  const { slug } = await params;
  const item = getIndustry(slug);
  if (!item) notFound();

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Industry operating context"
        title={item.name}
        description={item.description}
      />

      <OperatorBand
        index="01"
        eyebrow="Where operations break"
        title="The system must begin with the problems people already work around."
        description="These are the operating risks and coordination gaps that should shape discovery and pilot acceptance."
        tone="white"
      >
        <OperatorList items={item.challenges} />
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Capability direction"
        title="Translate the context into controlled product behaviour."
        description="Capabilities remain subject to the current release boundary: CRM, Sales, Accounting and Procurement are released; the other eight ERP modules remain roadmap scope."
      >
        <OperatorGrid columns={2}>
          {item.capabilities.map((capability, index) => (
            <OperatorCard
              key={capability}
              index={String(index + 1).padStart(2, "0")}
              title={capability}
              status="roadmap"
            />
          ))}
        </OperatorGrid>
        <OperatorNote label="Pilot rule">
          <p>
            Start with one measurable customer workflow and preserve the
            organisation, branch, permission and audit boundaries required by
            the real operation.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Context workshop"
        title={`Map ${item.name.toLowerCase()} operations before choosing features.`}
        description="A useful pilot begins with actual records, roles, handoffs, exceptions and evidence requirements."
        primary={{ label: "Book a discovery session", href: "/contact" }}
        secondary={{ label: "View system map", href: "/modules" }}
      />
    </MarketingShell>
  );
}
