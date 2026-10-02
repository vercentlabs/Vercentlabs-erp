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
        stat: "04",
        statLabel: "Four layers of control, from database to workflow.",
        items: [
          { label: "Tenant isolation", detail: "Row-level security in the database separates each organisation's data.", color: "var(--color-module-accounting)" },
          { label: "Scoped access", detail: "Roles, permissions, record-level access, and company/branch access.", color: "var(--color-module-hr-payroll)" },
          { label: "Protected audit log", detail: "The database rejects edits and deletions of audit entries.", color: "var(--color-state-success)" },
          { label: "Recovery", detail: "Backups with a restore process, plus logging and monitoring.", color: "var(--color-brand)" },
        ],
        definitionLabel: "What security means here",
        bodyEyebrow: "Controls buyers can verify",
        bodyTitle: "Isolation, access, audit, and recovery—explained plainly.",
        bodyDescription: "Where a control runs in the application rather than the database, it says so.",
        moduleEyebrow: "Controls in context",
        moduleTitle: "Governance applied to sensitive operational modules.",
      }}
    />
  );
}
