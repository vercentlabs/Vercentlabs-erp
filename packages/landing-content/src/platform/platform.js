import { CTAS } from "../navigation.js";

/**
 * /product/platform — the Shared Platform every module runs on.
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js).
 */
export const PLATFORM_PAGE = Object.freeze({
  slug: "/product/platform",
  title: "Platform Architecture",
  metaDescription:
    "The Shared Platform every Vercentlabs module runs on: tenants and companies, users, roles and permissions, company and branch access, audit logs, import and export, and transaction safety.",
  directDefinition:
    "Vercentlabs' Shared Platform is the foundation every module runs on — tenant and company management, users and roles, permissions with record-level and company/branch access, audit logs, notifications, import and export, and the transaction safety, idempotency, and concurrency protection that keep records consistent.",
  eyebrow: "Platform architecture",
  heading: "One platform, twelve modules.",
  supportingText:
    "Tenant isolation, roles and permissions, a protected audit log, and the reliability features below are built once and shared by every module — not rebuilt module by module.",
  sections: [
    {
      id: "tenant-company-structure",
      heading: "Tenants, companies & settings",
      supportingText: "Organisations and their companies, with company settings and the modules each organisation uses.",
      items: [
        { title: "Tenant and company management", description: "Each organisation is a tenant with one or more companies, isolated from other tenants in the database." },
        { title: "Company settings", description: "Currency, timezone, date and time formats, tax configuration, and document numbering per company." },
        { title: "Module enable / disable", description: "Modules are switched on per organisation, within its subscription plan." },
      ],
    },
    {
      id: "roles-permissions",
      heading: "Users, roles & permissions",
      supportingText: "Who can sign in, what they can do, and which records and companies they can reach.",
      items: [
        { title: "User management", description: "Users are invited, activated, and deactivated by the organisation." },
        { title: "Roles and permissions", description: "Roles carry permissions per module, checked on the server for every action." },
        { title: "Record-level and company/branch access", description: "Access can be limited to specific records, companies, and branches." },
      ],
    },
    {
      id: "collaboration",
      heading: "Collaboration & documents",
      supportingText: "Shared tools every module uses the same way.",
      items: [
        { title: "Comments, attachments, and activity history", description: "Discussion, files, and a history of what happened stay with the record." },
        { title: "Notifications", description: "People are notified about the work that needs their attention." },
        { title: "PDF and print", description: "Business documents can be produced as PDFs and printed." },
      ],
    },
    {
      id: "audit-trail",
      heading: "Protected audit log",
      supportingText: "Significant actions are written to a platform audit log that the database protects from edits and deletion.",
      items: [
        { title: "Enforced below the application", description: "A database trigger rejects any attempt to update or delete an audit entry, even from inside the application." },
      ],
    },
    {
      id: "reliability",
      heading: "Reliability & data integrity",
      supportingText: "The safeguards that keep records consistent and the service recoverable.",
      items: [
        { title: "Transaction safety and idempotency", description: "Operations commit completely or not at all, and a retried request can't be processed twice." },
        { title: "Concurrency protection", description: "Two people changing the same record can't silently overwrite each other." },
        { title: "Backups, restore, logging, and monitoring", description: "Data is backed up with a restore process, and the service is logged and monitored with health checks." },
      ],
    },
  ],
  connectedModuleKeys: ["crm", "sales", "accounting", "hr-payroll"],
  primaryCta: CTAS.talkToSpecialist,
  finalCtaHeading: "Walk through the platform architecture with an ERP specialist.",
});
