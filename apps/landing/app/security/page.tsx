import { SECURITY_PAGE } from "@vercentlabs/landing-content";
import { EvidencePlatformPageTemplate } from "@/components/platform/evidence-platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: SECURITY_PAGE.title,
  description: SECURITY_PAGE.metaDescription,
  path: SECURITY_PAGE.slug,
});

export default function SecurityPage() {
  return (
    <EvidencePlatformPageTemplate
      content={SECURITY_PAGE}
      breadcrumbTrail={[{ name: "Security & Governance", path: SECURITY_PAGE.slug }]}
      visual={{
        eyebrow: "Governance foundation",
        stat: "12",
        statLabel: "Seeded roles with scoped permission packages.",
        items: [
          { label: "Structural isolation", detail: "Tenant and company boundaries enforced below the UI.", color: "var(--color-module-accounting)" },
          { label: "Scoped access", detail: "Time-bound roles at company, branch, or department level.", color: "var(--color-module-hr-payroll)" },
          { label: "Immutable history", detail: "Audit records reject update and deletion at the database layer.", color: "var(--color-state-success)" },
          { label: "Maker-checker", detail: "Sensitive actions block self-approval by construction.", color: "var(--color-brand)" },
        ],
        definitionLabel: "What security means here",
        bodyEyebrow: "Controls buyers can verify",
        bodyTitle: "Isolation, identity, audit, and approval—explained plainly.",
        bodyDescription: "Implemented mechanisms and current limitations are separated clearly.",
        moduleEyebrow: "Controls in context",
        moduleTitle: "Governance applied to sensitive operational modules.",
      }}
    />
  );
}
