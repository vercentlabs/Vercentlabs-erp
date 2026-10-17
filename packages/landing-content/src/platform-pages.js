/**
 * Content for /product, the six approved platform pages, and /modules — all
 * sourced from docs/landing-redesign/phase-1/product-intelligence.md's
 * "Shared Platform" profile and Cross-Module Workflows, per
 * docs/landing-redesign/phase-1/information-architecture.md's exact approved
 * route list. /security is canonical; /product/security 301s to it
 * (see apps/landing/next.config.mjs). No page here repeats the homepage
 * verbatim — the homepage sells the high-level idea, these pages go deeper.
 */

export const PRODUCT_OVERVIEW_PAGE = Object.freeze({
  slug: "/product",
  title: "Product Overview",
  metaDescription:
    "Vercentlabs ERP connects 12 operational modules on one shared platform — multi-company data isolation, governed approvals, an immutable audit trail, and role-based reporting. See how the architecture works.",
  directDefinition:
    "Vercentlabs ERP is a multi-tenant, multi-company operational ERP: 12 connected modules — covering revenue, operations, finance, people and service, and delivery — sharing one data model, one role and permission system, one governed approval engine, and one immutable audit trail, instead of five separate tools that happen to export to the same spreadsheet.",
  eyebrow: "How the platform actually works",
  heading: "One connected system, not twelve separate applications with a shared login screen.",
  supportingText:
    "This page explains the architecture underneath the 12 modules — how they share data, how workflows move across module boundaries, and how access, reporting, and multi-company operation are governed centrally.",
  heroScreenshotId: "crm-pipeline-board",
  sections: [
    {
      id: "who-its-for",
      eyebrow: "Who it's for",
      heading: "Built for businesses that outgrew a single-purpose tool.",
      supportingText:
        "Growing manufacturers coordinating production and inventory, distributors and multi-location retailers keeping stock and point-of-sale in sync, and project-based service businesses that need to know project profitability before the invoice goes out — not after.",
    },
    {
      id: "connected-architecture",
      eyebrow: "What makes it a connected ERP",
      heading: "A record moves through the business without being re-typed.",
      supportingText:
        "A CRM opportunity becomes a Sales quotation by reference, not by copy. A confirmed order generates an Accounting invoice request through an idempotent, auditable handoff. A Manufacturing work order posts real, FK-linked movements into the same Stock ledger Point of Sale checkout deducts from live. These are confirmed, wired connections in the codebase, not a marketing diagram of how ERPs are supposed to work.",
    },
    {
      id: "operational-domains",
      eyebrow: "Five operational domains",
      heading: "Twelve modules, grouped the way your teams actually think about the business.",
      items: [
        { title: "Revenue", description: "CRM, Sales, and Point of Sale — from first contact to the till." },
        { title: "Operations", description: "Procurement, Stock, Manufacturing, and Quality — what you build, buy, and ship." },
        { title: "Finance", description: "Accounting and Assets — the books and the assets that back them." },
        { title: "People & Service", description: "HR & Payroll and Support — the people running the business and the customers they serve." },
        { title: "Delivery", description: "Projects — billable work tracked against budget and margin while it's still in progress." },
      ],
    },
    {
      id: "shared-data",
      eyebrow: "Shared data, not synced data",
      heading: "Modules read and write the same tables — there's no sync job that can fail.",
      supportingText:
        "When Manufacturing posts a finished-goods receipt, it's the same Stock ledger row Point of Sale checks before a sale. There's no overnight batch process reconciling two separate inventory systems, because there's only one.",
    },
    {
      id: "automation-summary",
      eyebrow: "How workflows are automated",
      heading: "A governed command registry, not a maze of if-statements per module.",
      supportingText:
        "Approval routing, separation-of-duties enforcement, and status-transition guards are built on reusable primitives shared across Accounting, Sales, CRM, HR, Assets, Projects, POS, and Support — not reinvented per module. See the automation page for the full picture.",
    },
    {
      id: "access-governance",
      eyebrow: "Access and governance",
      heading: "Role-based, time-bound, and scoped — not all-or-nothing.",
      supportingText:
        "Twelve seeded system roles carry framework-neutral permission-key packages per module. Role assignments can expire automatically and be scoped to a specific company, branch, or department. See the security page for the full architecture.",
    },
    {
      id: "reporting-summary",
      eyebrow: "How reporting works",
      heading: "Reports read from the same live data every module writes to.",
      supportingText:
        "Module dashboards and cross-module reports aren't a separate warehouse that's a day behind — they query the same operational data in real time. See the analytics page for the reporting framework.",
    },
    {
      id: "multi-company",
      eyebrow: "Multi-company and localisation",
      heading: "Structural isolation between companies and branches, with India-default localisation.",
      supportingText:
        "Company and branch scoping is enforced at the data layer, not filtered in the application. Localisation defaults to en-IN, Asia/Kolkata, INR, and an April-start fiscal year — matching Indian GST and statutory compliance needs out of the box.",
    },
    {
      id: "mobile-integrations",
      eyebrow: "Mobile and integrations",
      heading: "Native mobile where it matters most, and a real API surface for the rest.",
      supportingText:
        "CRM leads, opportunities, activities, and pipeline are native and offline-capable on mobile. Selected Procurement and platform workspaces use a secure-browser handoff. See the mobile and integrations pages for the honest current scope.",
    },
    {
      id: "implementation-overview",
      eyebrow: "Getting live",
      heading: "A configurable platform still needs a structured rollout.",
      supportingText:
        "Organisation bootstrap seeds 12 roles and around 29 numbering series in one transaction, but a real go-live still means discovery, configuration, data migration, and phased rollout — see the module pages for what each one specifically needs.",
    },
  ],
  faqs: [
    { question: "Is Vercentlabs one application or twelve separate products bundled together?", answer: "One application — 12 modules run on one shared platform and data model. Module access is entitlement-gated per organisation, so you can enable what you need now and add more later without switching systems." },
    { question: "How does Vercentlabs handle multiple companies or branches?", answer: "Multi-company and branch-level data isolation is structural, enforced at the database layer — not an application-layer filter that could be bypassed by a bug." },
    { question: "Can we adopt modules gradually instead of all at once?", answer: "Yes — module access is entitlement-gated per organisation, so you can start with the modules you need and add more as you grow, on the same underlying platform and data model." },
  ],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
});

export const PLATFORM_PAGE = Object.freeze({
  slug: "/product/platform",
  title: "Platform Architecture",
  metaDescription:
    "The shared platform every Vercentlabs module runs on: multi-tenant and multi-company isolation, 12 seeded roles with time-bound permissions, a governed approval engine, and an immutable audit trail.",
  directDefinition:
    "Vercentlabs' platform architecture is the cross-cutting control plane every module runs on — multi-tenant and multi-company data isolation, role-based access control, a governed approvals and workflow engine, and an immutable audit trail, built once and inherited by all 12 modules rather than reimplemented per module.",
  eyebrow: "Platform architecture",
  heading: "One control plane, twelve modules.",
  supportingText:
    "Multi-tenant isolation, a real time-bound and risk-tiered role model, a database-level-immutable audit log, and governed maker-checker approvals are shared infrastructure every module inherits — not bolted on per module after the fact.",
  sections: [
    {
      id: "tenant-company-structure",
      heading: "Tenant & company structure",
      supportingText: "Organizations, companies, branches, departments, cost centers, and teams, with granular membership-scoped access.",
      items: [
        { title: "Structural isolation", description: "Company and branch scoping is enforced at the database layer, not filtered in the application." },
        { title: "Not all-or-nothing access", description: "Access can be scoped to a specific company, branch, or department rather than granted organisation-wide." },
      ],
    },
    {
      id: "roles-permissions",
      heading: "Roles & permissions",
      supportingText: "12 seeded system roles with time-bound assignments and framework-neutral, per-module permission packages.",
      items: [
        { title: "Time-bound role assignments", description: "A role assignment can carry a start and expiry date, so access doesn't outlive its purpose." },
        { title: "Per-module permission packages", description: "Permission keys are scoped per module, not one blanket 'admin' toggle." },
      ],
    },
    {
      id: "approvals-workflow-engine",
      heading: "Approvals & workflow engine",
      supportingText: "A generic approval-requests system plus a governed command registry with reusable decision and separation-of-duties primitives.",
      items: [
        { title: "Reused across 8 modules", description: "Accounting, Sales, CRM, HR, Assets, Projects, POS, and Support all build their approval chains on the same primitives." },
        { title: "Separation-of-duties by construction", description: "The registry makes self-approval blocking a shared capability, not something each module has to reimplement correctly on its own." },
      ],
    },
    {
      id: "audit-trail",
      heading: "Immutable audit trail",
      supportingText: "A database trigger makes the audit table immutable — UPDATE/DELETE are rejected at the Postgres level.",
      items: [
        { title: "Enforced below the application", description: "Even an application bug can't alter history, because the rejection happens at the database trigger level." },
      ],
    },
    {
      id: "onboarding-entitlement",
      heading: "Tenant onboarding & module entitlement",
      supportingText: "Organisation bootstrap and module access are governed the same way for every tenant.",
      items: [
        { title: "One-transaction bootstrap", description: "Signup seeds 12 roles and roughly 29 numbering series in a single transaction." },
        { title: "Entitlement-gated modules", description: "Each module's UI and API respect per-organisation entitlement — you only see and can use what you're licensed for." },
      ],
    },
  ],
  connectedModuleKeys: ["crm", "sales", "accounting", "hr-payroll"],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
  finalCtaHeading: "See the platform architecture in a live demo.",
});

export const AUTOMATION_PAGE = Object.freeze({
  slug: "/product/automation",
  title: "Workflow Automation",
  metaDescription:
    "Vercentlabs automates approval routing, separation-of-duties enforcement, status transitions, and cross-module handoffs through a governed command registry — real examples from CRM, Sales, and Procurement.",
  directDefinition:
    "Vercentlabs' workflow automation is a governed command registry — reusable, permission-checked primitives for approval routing, separation-of-duties enforcement, and status-transition guards, shared across modules rather than hand-coded per module as ad hoc if-statements.",
  eyebrow: "Workflow automation",
  heading: "Automated where it matters, governed everywhere.",
  supportingText:
    "Every automated action below is a real, evidenced behavior — event-driven rules, conditional approval routing, and status guards that are already running in the product, not a roadmap of what automation could eventually do.",
  sections: [
    {
      id: "event-triggered-actions",
      heading: "Event-triggered actions",
      items: [
        { title: "CRM lead scoring and assignment", description: "A captured lead is scored and routed by policy the moment it arrives — no manual triage queue." },
        { title: "Quality auto-hold", description: "A failed inspection automatically places an inventory hold on the affected batch, serial, receipt, work order, or return." },
        { title: "Sales approval auto-cancel", description: "Revising a quotation automatically cancels any pending approval on the prior version." },
      ],
    },
    {
      id: "conditional-workflows",
      heading: "Conditional and threshold-driven workflows",
      items: [
        { title: "Threshold-based quote approval", description: "Discounts above a configured threshold route to approval; everything below clears automatically." },
        { title: "Procurement exception routing", description: "A matching failure automatically opens an exception case in the governance control tower." },
        { title: "Manufacturing policy toggles", description: "allow_overproduction and backflush_materials policies govern how strictly production posting is enforced." },
      ],
    },
    {
      id: "approval-chains",
      heading: "Approval chains and separation of duties",
      items: [
        { title: "Self-approval blocking", description: "Enforced structurally across Accounting subledger postings, Procurement requisitions, Assets capitalization/disposal, Projects time entries, and HR leave/payroll — not a policy document, a system rule." },
        { title: "Maker-checker on payroll and journals", description: "The preparer of a payroll run or a journal entry cannot be its approver." },
      ],
    },
    {
      id: "status-transitions",
      heading: "Status transitions and guards",
      items: [
        { title: "State-machine-guarded lifecycles", description: "Manufacturing work orders, Procurement requisitions, and Sales orders move through defined states that can't be skipped out of order." },
        { title: "Completion guards", description: "A Projects entry can't be marked complete while tasks remain open; a Manufacturing work order can't release without proven component availability." },
      ],
    },
    {
      id: "cross-module-automation",
      heading: "Cross-module handoffs",
      items: [
        { title: "Idempotent Sales-to-Accounting handoff", description: "A confirmed order's invoice request is idempotency-keyed, so a retry can't create a duplicate invoice." },
        { title: "Manufacturing-to-Stock posting", description: "Material issues and finished-goods receipts post as real, FK-linked stock movements automatically as part of production posting." },
        { title: "Procurement-to-Accounting gating", description: "A vendor bill can only be created once matching against the purchase order and receipt actually clears." },
      ],
    },
  ],
  connectedModuleKeys: ["crm", "sales", "procurement", "manufacturing", "quality"],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
  finalCtaHeading: "See workflow automation in a live demo.",
});

export const ANALYTICS_PAGE = Object.freeze({
  slug: "/product/analytics",
  title: "Reporting & Analytics",
  metaDescription:
    "Vercentlabs reporting reads from the same live data every module writes to — module dashboards, cross-module reports, and injection-safe exports, not a separate warehouse that's a day behind.",
  directDefinition:
    "Vercentlabs' reporting and analytics framework is built on the same live operational data every module writes to — role-scoped dashboards and reports that reflect the current state of the business, not a nightly-refreshed copy in a separate system.",
  eyebrow: "Reporting & analytics",
  heading: "Reports read from the same data your teams work in — not a separate copy.",
  supportingText:
    "Every module carries its own real report set — pipeline and forecast reports in CRM, a 16-report registry in Accounting, spend and risk analytics in Procurement — plus shared export and document primitives every module uses the same way.",
  sections: [
    {
      id: "role-based-dashboards",
      heading: "Role-based dashboards",
      items: [
        { title: "Module-specific dashboards", description: "Stock's on-hand/reserved/valuation view, Manufacturing's shortage count, Quality's open-inspection and hold count — each module's dashboard reflects what that role actually needs to see." },
        { title: "Scoped by role and access", description: "What a dashboard shows respects the same role and company/branch scoping as the rest of the platform." },
      ],
    },
    {
      id: "module-reports",
      heading: "Module reports",
      items: [
        { title: "CRM — 14 report types", description: "Including pipeline, conversion, forecast, revenue-operations, account-health, and AI-governance reporting." },
        { title: "Accounting — 16-report registry", description: "Trial balance, GL, P&L, balance sheet, cash flow, aged AR/AP, tax summary, close status, and subledger reconciliation." },
        { title: "Procurement — 12-report registry", description: "Spend analysis, maverick-spend detection, matching exceptions, supplier risk, and cycle time." },
      ],
    },
    {
      id: "cross-module-reporting",
      heading: "Cross-module reporting",
      supportingText: "Dashboards read from the same live data every module writes to, not a separate reporting warehouse that's a day behind.",
      items: [],
    },
    {
      id: "exports-documents",
      heading: "Exports and document handling",
      items: [
        { title: "Injection-safe CSV export", description: "Export is hard-capped on pagination and sanitised against formula-injection, a common CSV-export vulnerability class." },
        { title: "Governed document storage", description: "Uploaded documents are MIME- and size-allow-listed, SHA-256-hashed, and moved through a quarantine lifecycle before being trusted." },
      ],
    },
  ],
  connectedModuleKeys: ["crm", "accounting", "procurement"],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
  finalCtaHeading: "See real-time reporting in a live demo.",
});

export const MOBILE_PAGE = Object.freeze({
  slug: "/product/mobile",
  title: "Mobile ERP",
  metaDescription:
    "Vercentlabs' mobile app delivers native, offline-capable CRM (leads, opportunities, activities, pipeline) with conflict-safe sync and device-bound security. See exactly which modules are — and aren't — on mobile.",
  directDefinition:
    "Vercentlabs' mobile experience delivers CRM as a native, offline-capable application — leads, opportunities, activities, and pipeline sync with conflict-safe queuing — with selected Procurement and platform workspaces available through a secure-browser handoff; it is not a full ERP-on-mobile claim, and this page says exactly where the line is.",
  eyebrow: "Mobile ERP",
  heading: "Native where it counts. Honest about where it doesn't, yet.",
  supportingText:
    "CRM is the one module built natively for the field. Everything else on mobile today is either a secure-browser handoff or not yet available — stated plainly, not glossed over.",
  sections: [
    {
      id: "native-mobile",
      heading: "What's native and offline",
      items: [
        { title: "CRM leads, opportunities, activities, and pipeline", description: "Full offline capability with a conflict-safe sync queue — a field rep can work without signal and reconcile automatically on reconnect." },
        { title: "Device-bound authentication", description: "Fingerprint-required login, secure-store tokens, and biometric re-lock after 15 seconds in the background." },
      ],
    },
    {
      id: "secure-browser-handoff",
      heading: "Secure-browser handoff",
      items: [
        { title: "Selected Procurement and platform workspaces", description: "Available through a secure, authenticated handoff to the browser experience — not a native rebuild, but not locked out of mobile either." },
      ],
    },
    {
      id: "mobile-gaps",
      heading: "Honest current gaps",
      supportingText: "No mobile presence exists today for Manufacturing, Quality, Assets, Projects, Point of Sale, Support, Stock, or HR & Payroll. Point of Sale and Support are explicitly disabled in the mobile module catalog — not just deprioritised, actively excluded. Stock and HR & Payroll are the two most notable gaps for field and workforce use cases.",
      items: [],
    },
  ],
  connectedModuleKeys: ["crm", "procurement"],
  faqs: [
    { question: "Can I run the full ERP from my phone?", answer: "Not today. CRM is native and offline-capable on mobile. Selected Procurement and platform workspaces use a secure-browser handoff. Manufacturing, Quality, Assets, Projects, Point of Sale, Support, Stock, and HR & Payroll have no mobile presence." },
    { question: "Is Point of Sale available on a tablet or phone?", answer: "No — Point of Sale is explicitly excluded from the mobile module catalog, not just missing. It's a desktop/terminal workflow." },
  ],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
  finalCtaHeading: "See what mobile access actually covers in a live demo.",
});

export const INTEGRATIONS_PAGE = Object.freeze({
  slug: "/product/integrations",
  title: "Integrations & APIs",
  metaDescription:
    "Vercentlabs connects to the rest of your stack through real webhooks, a public lead-capture API, and CSV import/export — separated clearly by what's a native integration versus what's a configurable API-supported connection.",
  directDefinition:
    "Vercentlabs' integration surface is built on real, evidenced mechanisms — signed inbound webhooks, a public HMAC-authenticated lead-capture endpoint, OAuth-connected email/calendar sync, and CSV import/export — separated clearly into native integrations, API-supported integrations, and configurable external connections, rather than presented as one undifferentiated 'integrates with everything' claim.",
  eyebrow: "Integrations & APIs",
  heading: "Real integration mechanisms, clearly labeled by what they actually are.",
  supportingText:
    "Every integration point named here is something already running in the product — not a capability roadmap. Where a connection requires custom configuration rather than a one-click setup, this page says so.",
  sections: [
    {
      id: "native-integrations",
      heading: "Native integrations",
      supportingText: "Built directly into a module, requiring no external configuration.",
      items: [
        { title: "CRM email & calendar sync", description: "OAuth-connected, syncing directly with the CRM record — not a separate connector product." },
        { title: "CRM telephony webhooks", description: "Signed webhooks power click-to-call and call transcription." },
      ],
    },
    {
      id: "api-supported-integrations",
      heading: "API-supported integrations",
      supportingText: "Real, documented endpoints your team or a partner can build against.",
      items: [
        { title: "Public lead-capture API", description: "An HMAC-signed, trusted-proxy-capable public endpoint accepts leads from any external form or system — the same endpoint this marketing site's own demo form uses." },
        { title: "Signed inbound webhooks", description: "CRM lead-acquisition connections and telephony both accept signed webhooks, verified before processing." },
        { title: "Subscription billing webhooks", description: "An idempotent, HMAC-verified, replay-protected Razorpay webhook pipeline, serialized under an advisory lock." },
      ],
    },
    {
      id: "configurable-connections",
      heading: "Configurable external connections",
      supportingText: "Data movement that requires setup, not a pre-built one-click connector.",
      items: [
        { title: "CSV import and export", description: "Preview-commit-rollback CSV import for CRM leads; injection-safe, paginated CSV export across modules." },
      ],
    },
    {
      id: "error-handling",
      heading: "Error handling and retries",
      items: [
        { title: "Idempotency keys", description: "Checkout, order conversion, and billing webhooks all use idempotency keys so a retried request can't double-process." },
        { title: "Replay protection", description: "Signed webhook payloads carry a timestamp and are rejected outside a defined validity window." },
      ],
    },
  ],
  connectedModuleKeys: ["crm"],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
  finalCtaHeading: "See the integration options in a live demo.",
});

export const SECURITY_PAGE = Object.freeze({
  slug: "/security",
  title: "Security & Governance",
  metaDescription:
    "Vercentlabs' security architecture: structural multi-tenant isolation, 12 seeded roles with time-bound and scoped permissions, an immutable database-triggered audit trail, and governed maker-checker approvals.",
  directDefinition:
    "Vercentlabs' security architecture is built on structural tenant isolation, a real role-based access model with time-bound and scoped assignments, a database-trigger-enforced immutable audit trail, and governed maker-checker approvals — the controls a buying committee actually asks about, explained plainly rather than as a generic security-policy page.",
  eyebrow: "Security & governance",
  heading: "The controls a buying committee actually asks about.",
  supportingText:
    "Every mechanism below is real and implemented — not a compliance-page template. Where something isn't yet enforced, this page says so plainly instead of implying it.",
  sections: [
    {
      id: "tenant-isolation",
      heading: "Tenant isolation",
      items: [
        { title: "Structural, not just filtered", description: "Every tenant's data is isolated at the database layer, enforced on every query — not assumed by application-layer convention." },
        { title: "Multi-company data isolation", description: "Company and branch scoping is structural, matching the same discipline as tenant isolation." },
      ],
    },
    {
      id: "authentication",
      heading: "Authentication",
      items: [
        { title: "Login hardening", description: "Failed-attempt lockout and password history are enforced." },
        { title: "MFA — schema-ready, not yet enforced", description: "MFA columns exist in the schema, explicitly described in-product as an 'MFA-ready foundation.' MFA is not yet an enforced control today — stated plainly, not implied as active." },
        { title: "Device-bound mobile auth", description: "Fingerprint-required login, secure-store tokens, and biometric re-lock after 15 seconds background on mobile." },
      ],
    },
    {
      id: "roles-record-field-access",
      heading: "Roles, record-level, and field-level access",
      items: [
        { title: "12 seeded system roles", description: "With framework-neutral, per-module permission-key packages." },
        { title: "Time-bound and scoped assignments", description: "A role assignment can expire automatically and be scoped to a specific company, branch, or department — not all-or-nothing." },
        { title: "Margin and cost redaction", description: "Sales margin figures are redacted from roles that shouldn't see them, consistently across every view, not just the ones someone remembered to gate." },
      ],
    },
    {
      id: "audit-history",
      heading: "Audit history",
      items: [
        { title: "Database-trigger-immutable", description: "A Postgres trigger rejects UPDATE/DELETE against the audit table, even from an application bug — enforced below the application layer." },
      ],
    },
    {
      id: "approval-controls",
      heading: "Approval controls",
      items: [
        { title: "Governed maker-checker", description: "A reusable command registry enforces separation of duties across Accounting, Sales, CRM, HR, Assets, Projects, POS, and Support." },
        { title: "Self-approval blocked by construction", description: "Not a policy reminder — the system itself prevents the preparer of a sensitive action from also approving it." },
      ],
    },
    {
      id: "data-retention-encryption",
      heading: "Data retention, encryption, and backup",
      items: [
        { title: "Session governance", description: "Session lifetime and idle timeout are enforced platform-wide." },
        { title: "Document integrity", description: "Uploaded documents are SHA-256-hashed and moved through a quarantine lifecycle before being trusted." },
      ],
    },
  ],
  connectedModuleKeys: ["accounting", "hr-payroll", "assets"],
  faqs: [
    { question: "Is multi-factor authentication available?", answer: "MFA columns exist in the schema as an 'MFA-ready foundation,' but MFA is not yet an enforced control today. We state this plainly rather than implying it's active." },
    { question: "How is one tenant's data kept separate from another's?", answer: "Isolation is structural — enforced at the database layer on every query — not an application-layer filter that a bug could bypass." },
    { question: "Can someone approve their own transaction?", answer: "No, for every governed action across Accounting, Sales, CRM, HR, Assets, Projects, POS, and Support — self-approval is blocked by the system itself, built on a shared, reusable command registry, not a per-module policy someone could forget to implement." },
  ],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
  finalCtaHeading: "See the security architecture in a live demo.",
});

export const PLATFORM_PAGES = Object.freeze([PLATFORM_PAGE, AUTOMATION_PAGE, ANALYTICS_PAGE, MOBILE_PAGE, INTEGRATIONS_PAGE, SECURITY_PAGE]);

export const MODULES_INDEX_PAGE = Object.freeze({
  slug: "/modules",
  title: "Modules",
  metaDescription:
    "All 12 Vercentlabs ERP modules, grouped by revenue, operations, finance, people & service, and delivery — with real operating-stack examples for manufacturing, distribution, retail, and project-based service businesses.",
  directDefinition:
    "Vercentlabs ERP is organised into 12 modules across five operational categories — Revenue, Operations, Finance, People & Service, and Delivery — that share one platform and data model, so you can adopt what you need now and add more later without switching systems.",
  eyebrow: "The complete module map",
  heading: "Twelve modules. One shared platform. Adopt what you need.",
  supportingText:
    "Every module below runs on the same data model, role system, and audit trail — module access is entitlement-gated per organisation, not a separately licensed product.",
  operatingStacks: [
    {
      id: "manufacturing-stack",
      name: "Manufacturing operating stack",
      description: "Plan and build against real component availability, with quality gates and finance connected to actual production, not a separate spreadsheet.",
      moduleKeys: ["manufacturing", "stock", "procurement", "quality", "accounting"],
    },
    {
      id: "distribution-stack",
      name: "Distribution operating stack",
      description: "Multi-location stock visibility feeding replenishment and sales, with a single customer record across every touchpoint.",
      moduleKeys: ["stock", "procurement", "sales", "crm", "accounting"],
    },
    {
      id: "retail-stack",
      name: "Retail operating stack",
      description: "Checkout that deducts real inventory in the same transaction as the sale, with the same stock ledger backing every store.",
      moduleKeys: ["point-of-sale", "stock", "procurement", "crm"],
    },
    {
      id: "project-service-stack",
      name: "Project-based service operating stack",
      description: "Know project profitability while the project is still open, with time, expense, and procurement actuals feeding one live margin calculation.",
      moduleKeys: ["projects", "crm", "sales", "accounting", "hr-payroll"],
    },
  ],
  primaryCta: { label: "Book a Demo", href: "/book-demo" },
});
