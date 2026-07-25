import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorList,
  OperatorSteps,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "ERP Design Partner Programme",
  description:
    "Apply to work with VercentLabs on real ERP workflows, validation and phased implementation for a growing Indian business.",
  path: "/customers",
});

export default function CustomersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Design partner programme"
        title="Shape the workflows your operating team will actually depend on."
        description="Selected organisations work with VercentLabs to convert a real operating problem into validated records, controls, scenarios and a practical first scope."
      />

      <OperatorBand
        index="01"
        eyebrow="Programme"
        title="Discovery before deployment."
        description="A design partnership is not a discounted whole-company implementation. It is a disciplined way to validate one important workflow."
        tone="white"
      >
        <OperatorSteps
          items={[
            "Fit review",
            "Workflow discovery",
            "Scenario validation",
            "Pilot decision",
          ]}
        />
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Good fit"
        title="The organisation can explain the problem and own the decision."
        description="Strong pilots have a named process owner, realistic records and a narrow outcome that can be evaluated."
        tone="ink"
      >
        <OperatorList
          items={[
            "Growing manufacturer, distributor or service business in India",
            "Important workflow split across spreadsheets or disconnected tools",
            "Named owner who understands decisions and exceptions",
            "Willingness to validate realistic scenarios",
            "Practical first scope instead of immediate total replacement",
            "Ability to involve real end users in acceptance",
          ]}
        />
      </OperatorBand>

      <OperatorBand
        index="03"
        eyebrow="What you receive"
        title="A clearer operating model—even before the software decision."
        description="The work produces evidence that supports product fit, implementation scope and adoption planning."
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            title="Workflow map"
            description="Actors, handoffs, decisions, exceptions and source records."
          />
          <OperatorCard
            index="02"
            title="Control model"
            description="Permissions, approval boundaries, audit evidence and ownership."
          />
          <OperatorCard
            index="03"
            title="Pilot decision"
            description="Explicit acceptance criteria, risks and next-step recommendation."
          />
        </OperatorGrid>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Apply"
        title="Bring one workflow worth fixing properly."
        description="Share the business, process owner, current tools and the operational result you need."
        primary={{ label: "Apply as a design partner", href: "/contact" }}
        secondary={{ label: "Review implementation", href: "/how-it-works" }}
      />
    </MarketingShell>
  );
}
