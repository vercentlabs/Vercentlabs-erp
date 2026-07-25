import { isReleasedModule } from "@vercent/shared-types";
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
import { erpModules, getModule } from "@/content/erp";
import { createPageMetadata } from "@/lib/metadata";

type ModulePageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return erpModules.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: ModulePageProps) {
  const { slug } = await params;
  const item = getModule(slug);
  return item
    ? createPageMetadata({
        title: `${item.name} ERP Module`,
        description: item.summary,
        path: `/modules/${item.slug}`,
      })
    : {};
}

export default async function ModulePage({ params }: ModulePageProps) {
  const { slug } = await params;
  const item = getModule(slug);
  if (!item) notFound();
  const released = isReleasedModule(item.slug);

  return (
    <MarketingShell>
      <PageHero
        eyebrow={released ? "Released early-access module" : "Roadmap module"}
        title={item.name}
        description={item.summary}
      />

      <OperatorBand
        index="01"
        eyebrow={released ? "Released outcome" : "Planned outcome"}
        title={item.outcome}
        description={
          released
            ? "This scope is available for controlled early-access validation."
            : "This outcome is product direction, not a current production claim."
        }
        tone={released ? "white" : "paper"}
      >
        <OperatorGrid columns={2}>
          {item.capabilities.map((capability, index) => (
            <OperatorCard
              key={capability}
              index={String(index + 1).padStart(2, "0")}
              title={capability}
              status={released ? "released" : "roadmap"}
            />
          ))}
        </OperatorGrid>
        <OperatorNote label="Current status">
          <p>
            {released
              ? "Available as released CRM early-access scope with permissions, approvals, audit history and mobile workflows."
              : "Visible for roadmap transparency. It cannot be activated in the current release."}
          </p>
        </OperatorNote>
      </OperatorBand>

      <OperatorBand
        index="02"
        eyebrow="Shared system"
        title="Every module must inherit the same operating controls."
        description="Expansion is valuable only when identity, context, permissions and evidence remain consistent across the system."
        tone="ink"
      >
        <OperatorList
          items={[
            "Organisation and branch context",
            "Role and permission boundaries",
            "Governed master data",
            "Transactional approval commands",
            "Audit-ready history",
            "Shared reporting and integration contracts",
          ]}
        />
      </OperatorBand>

      <OperatorFinalCta
        eyebrow={released ? "Early access" : "Roadmap conversation"}
        title={
          released
            ? "Validate CRM with a real operating team."
            : `Help shape ${item.name} around a real operating problem.`
        }
        description={
          released
            ? "Begin with a narrow workflow, explicit users and measurable acceptance criteria."
            : "Roadmap discussions are grounded in process evidence, not feature wish lists."
        }
        primary={{
          label: released ? "Request CRM early access" : "Discuss the roadmap",
          href: "/contact",
        }}
        secondary={{ label: "Return to system map", href: "/modules" }}
      />
    </MarketingShell>
  );
}
