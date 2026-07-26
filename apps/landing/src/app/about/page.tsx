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

export const metadata = createPageMetadata({
  title: "About Vercentlabs",
  description:
    "Learn how Vercentlabs is building a governed ERP foundation and CRM early access through phased design-partner delivery.",
  path: "/about",
});

const principles = [
  "Solve operating problems before adding software complexity",
  "Design complete workflows instead of isolated features",
  "Treat permissions, auditability and data governance as foundations",
  "Build modularly without creating disconnected products",
  "Publish only claims that can be supported with evidence",
  "Learn with real implementation partners and business users",
] as const;

export default function AboutPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="About Vercentlabs"
        title="Build software that makes operations easier to read, control and improve."
        description="Vercentlabs LLP is developing a governed enterprise operating platform around Indian business reality, phased implementation and evidence-led product decisions."
      />

      <OperatorBand
        index="01"
        eyebrow="Mission"
        title="Turn disconnected work into one understandable operating system."
        description="The long-term product direction connects commercial operations, finance, supply chain, production, people, projects and reporting without hiding today’s release boundary."
        tone="white"
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            title="Current product"
            description="Released CRM early access with identity, permissions, approvals, audit history, billing controls and mobile workflows."
            status="released"
          />
          <OperatorCard
            index="02"
            title="Shared foundation"
            description="Organisation context, governed data, access control and platform contracts designed to support future modules."
            status="foundation"
          />
          <OperatorCard
            index="03"
            title="Product roadmap"
            description="Eleven additional ERP modules developed through process evidence and controlled expansion."
            status="roadmap"
          />
        </OperatorGrid>
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Working principles"
        title="Conviction without invention."
        description="A serious software company earns trust by making hard product choices and stating the truth clearly."
        tone="ink"
      >
        <OperatorList items={principles} />
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Work with us"
        title="Bring a real operating problem into the product process."
        description="We are interested in design partners, implementation specialists and builders who care about complete workflows and accountable systems."
        primary={{ label: "Start a conversation", href: "/contact" }}
        secondary={{ label: "Explore careers", href: "/careers" }}
      />
    </MarketingShell>
  );
}
