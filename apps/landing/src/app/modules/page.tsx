import { isReleasedModule } from "@vercentlabs/shared-types";

import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { erpModules } from "@/content/erp";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Module System",
  description:
    "Review the four released ERP modules and eight clearly labelled roadmap modules in the Vercentlabs ERP system.",
  path: "/modules",
});

export default function ModulesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="System map"
        title="Twelve modules. Four released. Eight stated without theatre."
        description="CRM, Sales, Accounting and Procurement are the released early-access operating modules. The remaining eight modules are roadmap scope built on the same identity, permission, audit and master-data foundation."
      />

      <OperatorBand
        index="01"
        eyebrow="Release map"
        title="The roadmap is visible. The release boundary is explicit."
        description="Every module page carries its current status so buyers can distinguish usable scope from future product direction."
        tone="white"
      >
        <OperatorGrid columns={4}>
          {erpModules.map((module, index) => {
            const released = isReleasedModule(module.slug);
            return (
              <OperatorCard
                key={module.slug}
                index={String(index + 1).padStart(2, "0")}
                title={module.name}
                description={module.summary}
                status={released ? "released" : "roadmap"}
                meta={released ? "Released early access" : "Roadmap module"}
                href={`/modules/${module.slug}`}
              />
            );
          })}
        </OperatorGrid>
        <OperatorNote label="Foundation">
          <p>
            Identity, organisation context, permissions, audit history, billing
            controls and governed master data are shared platform concerns—not
            separate module promises.
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorFinalCta
        eyebrow="Scope discussion"
        title="Start with the released operating core. Expand only after evidence."
        description="Use the released CRM-to-cash and source-to-pay core to validate data ownership, permissions, accounting handoffs and adoption before broader ERP rollout."
        primary={{ label: "Book a scope session", href: "/contact" }}
        secondary={{
          label: "See implementation approach",
          href: "/how-it-works",
        }}
      />
    </MarketingShell>
  );
}
