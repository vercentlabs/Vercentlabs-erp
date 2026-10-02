import { CTAS } from "../navigation.js";

/**
 * /security — access control, tenant isolation, audit, and recovery. /product/security redirects here (apps/landing/next.config.mjs).
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js).
 */
export const SECURITY_PAGE = Object.freeze({
  slug: "/security",
  title: "Security & Governance",
  metaDescription:
    "Vercentlabs ERP security: tenant isolation with database row-level security, roles and permissions, record-level and company/branch access, a protected audit log, and backups with a restore process.",
  directDefinition:
    "Vercentlabs' security architecture combines tenant isolation enforced by database row-level security, role-based permissions with record-level and company/branch access, an audit log the database protects from edits and deletion, and backups with a restore process — the controls a buying committee asks about, explained plainly.",
  eyebrow: "Security & governance",
  heading: "The controls a buying committee actually asks about.",
  supportingText:
    "Every control below is part of the approved launch platform. Where a control works in the application rather than the database, this page says so.",
  sections: [
    {
      id: "tenant-isolation",
      heading: "Tenant isolation",
      items: [
        { title: "Database row-level security", description: "Each organisation's data is isolated by row-level security on its tenant tables, so one tenant's queries can't reach another tenant's rows." },
        { title: "Company and branch access", description: "Within an organisation, access to companies and branches is scoped through permissions and query-level controls in the application." },
      ],
    },
    {
      id: "authentication",
      heading: "Authentication and sessions",
      items: [
        { title: "Sign-in and password reset", description: "Login and logout, and a forgot / reset password flow." },
        { title: "Session management", description: "Sessions are managed by the platform, and users can be deactivated to remove their access." },
      ],
    },
    {
      id: "roles-record-field-access",
      heading: "Roles and record-level access",
      items: [
        { title: "Roles and permissions", description: "What each person can see and do is set by their role's permissions and checked on the server, not just hidden in the interface." },
        { title: "Record-level access", description: "Access can be limited to the records a person is responsible for." },
      ],
    },
    {
      id: "audit-history",
      heading: "Audit history",
      items: [
        { title: "Protected audit log", description: "Significant actions are written to the platform audit log by the application, and a database trigger rejects any attempt to update or delete an entry." },
        { title: "Activity history", description: "Records keep a history of what happened to them." },
      ],
    },
    {
      id: "approval-controls",
      heading: "Approvals where they're built in",
      items: [
        { title: "Leave and payroll approval", description: "Leave requests and payroll are approved in the system, and an approver can't approve a payroll that includes their own pay." },
      ],
    },
    {
      id: "data-retention-encryption",
      heading: "Data integrity and recovery",
      items: [
        { title: "Transaction safety and concurrency protection", description: "Operations commit completely or not at all, and simultaneous edits can't silently overwrite each other." },
        { title: "Backups and restore", description: "Data is backed up, with a restore process." },
        { title: "Logging and monitoring", description: "The service is logged and monitored, with health checks." },
      ],
    },
  ],
  connectedModuleKeys: ["accounting", "hr-payroll", "crm"],
  faqs: [
    { question: "How is one tenant's data kept separate from another's?", answer: "Each organisation's data is isolated by database row-level security on its tenant tables, so one tenant's queries can't reach another tenant's rows." },
    { question: "Can access be limited to specific companies or branches?", answer: "Yes. Company and branch access is scoped through permissions and query-level controls in the application, alongside record-level access." },
    { question: "Can the audit log be changed?", answer: "No. A database trigger rejects any attempt to update or delete an audit log entry, even from inside the application." },
  ],
  primaryCta: CTAS.talkToSpecialist,
  finalCtaHeading: "Walk through the security architecture with an ERP specialist.",
});
