import LeadForm from "@/components/forms/lead-form";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorList,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Book a Vercentlabs ERP Demo",
  description:
    "Request a focused walkthrough of released CRM workflows, permissions, approvals, audit history and the wider ERP roadmap.",
  path: "/book-demo",
});

export default function BookDemoPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Product walkthrough"
        title="See the released workflow. Challenge the control model."
        description="The walkthrough is built around your operating scenario and the current CRM release—not a rehearsed tour of roadmap screens."
      />

      <OperatorBand
        index="01"
        eyebrow="Demo brief"
        title="Give the session a real job to do."
        description="A useful demo should answer whether the product can represent your data, ownership, handoffs and governed decisions."
        tone="white"
      >
        <div className="operator-form-layout">
          <div className="operator-form-layout__context">
            <h2>What we can cover.</h2>
            <OperatorList
              items={[
                "Lead and contact capture",
                "Opportunity pipeline",
                "Activities and ownership",
                "Permissions and branch context",
                "Approval requests",
                "Audit history and reporting",
              ]}
            />
          </div>
          <div>
            <LeadForm mode="demo" />
          </div>
        </div>
        <OperatorNote label="Scope">
          <p>
            CRM is the released early-access module. The other eleven modules
            are shown only as roadmap context.
          </p>
        </OperatorNote>
      </OperatorBand>
    </MarketingShell>
  );
}
