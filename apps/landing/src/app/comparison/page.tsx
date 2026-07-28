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
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "ERP Approach Comparison",
  description:
    "Compare spreadsheets, accounting-only tools, traditional legacy ERP and the connected modular Vercentlabs approach.",
  path: "/comparison",
});

const approaches = [
  {
    title: "Spreadsheets and point tools",
    description:
      "Fast to start, but data ownership, controls and responsibility fragment as operations grow.",
    fit: "Small, temporary or low-risk workflows",
  },
  {
    title: "Accounting-only system",
    description:
      "Strong financial control while customer, supply, service and project operations remain elsewhere.",
    fit: "Finance-first requirements",
  },
  {
    title: "Traditional legacy ERP",
    description:
      "Broad centralisation with heavier change programmes, specialist dependency and slower interface evolution.",
    fit: "Large established transformation programmes",
  },
  {
    title: "Vercentlabs approach",
    description:
      "Shared platform controls, four released business modules and phased expansion around complete workflows.",
    fit: "Growing organisations needing connected operations",
  },
] as const;

const decisionQuestions = [
  "Where is the authoritative customer, supplier, item and transaction record?",
  "Which handoffs require ownership, approvals or evidence?",
  "How much migration, integration and internal change is required?",
  "Can real users complete a complete scenario without workarounds?",
  "What remains unavailable, manual or roadmap after implementation?",
  "What is the total cost of software, services and internal effort?",
] as const;

export default function ComparisonPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="ERP approach comparison"
        title="Compare the operating model. Not the number of menu items."
        description="A useful ERP decision examines data ownership, workflow, governance, implementation, reporting, expansion and total cost across complete business scenarios."
      />

      <OperatorBand
        index="01"
        eyebrow="Four approaches"
        title="Every system shape creates a different operating cost."
        description="The right choice depends on the risk, cross-team dependency, control requirements and change capacity of the organisation."
        tone="white"
      >
        <OperatorGrid columns={4}>
          {approaches.map((approach, index) => (
            <OperatorCard
              key={approach.title}
              index={String(index + 1).padStart(2, "0")}
              title={approach.title}
              description={approach.description}
              meta={`Best fit · ${approach.fit}`}
              status={index === 3 ? "foundation" : "neutral"}
            />
          ))}
        </OperatorGrid>
        <OperatorNote label="Fair comparison">
          <p>
            These are broad operating patterns, not universal facts about every
            vendor. Validate shortlisted products against current documentation,
            demonstrations, references and your real scenarios.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Decision test"
        title="Ask the questions that survive the demo."
        description="A visually impressive screen is not proof that the operating path, control model or implementation economics will work."
        tone="ink"
      >
        <OperatorList items={decisionQuestions} />
      </OperatorBand>

      <OperatorBand
        index="03"
        eyebrow="Vercentlabs position"
        title="Start narrow. Preserve the shared system. Expand with evidence."
        description="The current product releases CRM, Sales, Accounting and Procurement on a governed platform foundation. Eight additional modules remain explicit roadmap scope."
      >
        <OperatorGrid columns={3}>
          <OperatorCard
            index="01"
            title="Released now"
            description="CRM records, pipeline, activities, permissions, approval requests, audit history, reporting and mobile workflows."
            status="released"
          />
          <OperatorCard
            index="02"
            title="Shared now"
            description="Identity, organisation context, master data, platform contracts, billing and operational controls."
            status="foundation"
          />
          <OperatorCard
            index="03"
            title="Roadmap"
            description="Stock, manufacturing, projects, assets, POS, quality, support and HR/payroll."
            status="roadmap"
          />
        </OperatorGrid>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Evaluation"
        title="Bring one complete scenario into the comparison."
        description="Use real roles, approvals, exceptions, reports, migration samples and security boundaries—not a generic feature checklist."
        primary={{ label: "Book a comparison session", href: "/contact" }}
        secondary={{ label: "Review pricing", href: "/pricing" }}
      />
    </MarketingShell>
  );
}
