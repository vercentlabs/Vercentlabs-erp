# VercentLabs ERP — 12-Module Feature Register

> Generated automatically from repository static evidence on **2026-08-05T10:44:11.792Z**.
> This document distinguishes source-code evidence from runtime completion.

## Repository snapshot

- **Branch:** main
- **Commit:** 90ee1c8
- **Files scanned:** 1045
- **Capabilities assessed:** 236
- **Present — static evidence:** 89
- **Partial — verify manually:** 82
- **Not found:** 65

## Status rules

- ✅ **Present — static evidence:** matching evidence exists across at least three core implementation layers.
- 🟡 **Partial — verify manually:** some evidence exists, but the complete workflow is not proven.
- ❌ **Not found:** the scanner found no matching source evidence. Different terminology can still require manual review.

> Static matching does not prove that migrations run, APIs are secure, permissions are correct, calculations are accurate, or workflows pass end-to-end tests.

## Module summary

| Module | Total | Present | Partial | Not found |
|---|---:|---:|---:|---:|
| Shared Platform | 22 | 18 | 4 | 0 |
| CRM | 18 | 14 | 3 | 1 |
| Sales | 18 | 10 | 5 | 3 |
| Accounting | 22 | 16 | 6 | 0 |
| Procurement | 19 | 6 | 11 | 2 |
| Stock | 18 | 4 | 9 | 5 |
| Manufacturing | 18 | 3 | 6 | 9 |
| Projects | 16 | 1 | 8 | 7 |
| Assets | 15 | 1 | 8 | 6 |
| Point of Sale | 15 | 1 | 6 | 8 |
| Quality | 16 | 4 | 6 | 6 |
| Support | 15 | 2 | 6 | 7 |
| HR & Payroll | 24 | 9 | 4 | 11 |

# Shared Platform

**Total:** 22 · **Present:** 18 · **Partial:** 4 · **Not found:** 0

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-001 | Authentication and secure sessions | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Mobile, Other, Tests | `apps/landing/README.md`<br>`apps/landing/src/app/api-developers/page.tsx`<br>`apps/landing/src/app/book-demo/page.tsx`<br>`apps/landing/src/app/comparison/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/globals.css`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/industries/[slug]/page.tsx` |
| ERP-002 | Organisation, company and branch management | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other, Tests | `apps/landing/src/app/about/page.tsx`<br>`apps/landing/src/app/api-developers/page.tsx`<br>`apps/landing/src/app/book-demo/page.tsx`<br>`apps/landing/src/app/changelog/page.tsx`<br>`apps/landing/src/app/comparison/page.tsx`<br>`apps/landing/src/app/customers/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx` |
| ERP-003 | Users, invitations and membership lifecycle | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/mobile/src/app/(protected)/workspace/[area].tsx`<br>`apps/mobile/src/shared/components/access-manager.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/README.md`<br>`apps/web/src/app/(app)/crm/marketing/page.tsx`<br>`apps/web/src/app/(app)/dashboard/page.tsx` |
| ERP-004 | Roles and granular permissions | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other | `apps/landing/next.config.mjs`<br>`apps/landing/src/app/about/page.tsx`<br>`apps/landing/src/app/api-developers/page.tsx`<br>`apps/landing/src/app/book-demo/page.tsx`<br>`apps/landing/src/app/careers/page.tsx`<br>`apps/landing/src/app/changelog/page.tsx`<br>`apps/landing/src/app/comparison/page.tsx`<br>`apps/landing/src/app/customers/page.tsx` |
| ERP-005 | Company and branch data isolation | Mandatory | 🟡 Partial — verify manually | Backend, Database, Docs, Other | `apps/landing/src/app/changelog/page.tsx`<br>`database/tenant/functions/README.md`<br>`database/tenant/migrations/001_business_data_foundation.sql`<br>`database/tenant/migrations/002_crm_module.sql`<br>`database/tenant/migrations/003_crm_enterprise_core.sql`<br>`database/tenant/migrations/005_crm_completion_pack.sql`<br>`database/tenant/migrations/008_sales_module.sql`<br>`database/tenant/migrations/009_accounting_module.sql` |
| ERP-006 | Approval workflows and delegation | Mandatory | ✅ Present — static evidence | API, Database, Frontend, Mobile, Other | `apps/landing/src/app/book-demo/page.tsx`<br>`apps/landing/src/app/comparison/page.tsx`<br>`apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx`<br>`apps/web/src/app/(app)/approvals/page.tsx`<br>`apps/web/src/app/api/approvals/route.ts`<br>`apps/web/src/app/api/approvals/[id]/route.ts`<br>`apps/web/src/app/api/mobile/v1/approvals/[id]/route.ts`<br>`apps/web/src/components/crm-opportunity-actions.tsx` |
| ERP-007 | Audit trail and immutable evidence | Mandatory | ✅ Present — static evidence | API, Database, Docs, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/mobile/src/core/modules/navigation.ts`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/README.md`<br>`apps/web/src/app/(app)/accounting/assets/[id]/page.tsx`<br>`apps/web/src/app/(app)/audit-logs/page.tsx`<br>`apps/web/src/app/(app)/crm/privacy-retention/page.tsx`<br>`apps/web/src/app/(app)/dashboard/page.tsx` |
| ERP-008 | Notifications and reminders | Common | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/mobile/src/app/(protected)/(tabs)/_layout.tsx`<br>`apps/mobile/src/app/(protected)/notifications.tsx`<br>`apps/mobile/src/app/(protected)/_layout.tsx`<br>`apps/mobile/src/core/modules/navigation.ts`<br>`apps/mobile/src/core/modules/web-parity.ts` |
| ERP-009 | Module enablement and entitlements | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/security/page.tsx`<br>`apps/web/src/app/(app)/settings/roles/page.tsx`<br>`apps/web/src/app/(app)/settings/users/page.tsx`<br>`apps/web/src/app/api/mobile/v1/workspace/[area]/route.ts`<br>`apps/web/src/app/api/modules/[key]/route.ts`<br>`apps/web/src/app/api/roles/route.ts`<br>`apps/web/src/app/api/roles/[id]/route.ts` |
| ERP-010 | Numbering series | Mandatory | 🟡 Partial — verify manually | Backend, Database, Docs | `apps/web/src/lib/platform.ts`<br>`apps/web/src/lib/resources.ts`<br>`database/control-plane/migrations/002_platform_foundation.sql`<br>`database/control-plane/migrations/003_business_data_permissions.sql`<br>`database/control-plane/migrations/004_crm_permissions.sql`<br>`database/control-plane/migrations/009_crm_release_scope.sql`<br>`database/control-plane/migrations/012_sales_module_release.sql`<br>`database/control-plane/migrations/013_accounting_module_release.sql` |
| ERP-011 | Master data governance | Mandatory | ✅ Present — static evidence | Backend, Database, Docs, Frontend, Mobile, Other | `apps/landing/src/app/comparison/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/modules/page.tsx`<br>`apps/landing/src/app/modules/[slug]/page.tsx`<br>`apps/landing/src/app/pricing/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts` |
| ERP-012 | Import and export | Common | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other, Tests | `apps/landing/eslint.config.mjs`<br>`apps/landing/next.config.mjs`<br>`apps/landing/postcss.config.mjs`<br>`apps/landing/src/app/about/page.tsx`<br>`apps/landing/src/app/api/contact/route.ts`<br>`apps/landing/src/app/api/demo/route.ts`<br>`apps/landing/src/app/api/health/route.ts`<br>`apps/landing/src/app/api/signup/route.ts` |
| ERP-013 | Global search and saved filters | Common | 🟡 Partial — verify manually | Frontend, Mobile | `apps/mobile/src/app/(protected)/search.tsx`<br>`apps/web/src/app/(app)/search/page.tsx` |
| ERP-014 | Document and attachment management | Common | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Tests | `apps/web/src/app/api/business-data/[resource]/export/route.ts`<br>`apps/web/src/app/api/crm/reports/[report]/route.ts`<br>`apps/web/src/app/api/crm/[resource]/export/route.ts`<br>`apps/web/src/components/billing-workspace.tsx`<br>`apps/web/src/lib/hr-payroll-validation.ts`<br>`database/control-plane/migrations/002_platform_foundation.sql`<br>`database/tenant/migrations/051_hr_payroll_module.sql`<br>`packages/document-engine/README.md` |
| ERP-015 | Reporting and dashboard framework | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/industries/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/components/home/operating-system-demo.tsx`<br>`apps/landing/src/components/home/product-marketing-sections.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/mobile/README.md`<br>`apps/mobile/src/app/(protected)/(tabs)/index.tsx` |
| ERP-016 | Workflow and business rule engine | Common | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/web/src/app/(app)/crm/settings/page.tsx`<br>`apps/web/src/lib/crm.ts`<br>`database/control-plane/migrations/004_crm_permissions.sql`<br>`services/api/src/crm.js` |
| ERP-017 | Public API, webhooks and integrations | Common | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Other | `apps/landing/README.md`<br>`apps/landing/src/app/api-developers/page.tsx`<br>`apps/landing/src/lib/lead-delivery.ts`<br>`apps/web/package.json`<br>`apps/web/README.md`<br>`apps/web/src/app/(app)/crm/communications/page.tsx`<br>`apps/web/src/app/(app)/crm/conversation-intelligence/page.tsx`<br>`apps/web/src/app/(app)/crm/lead-acquisition/page.tsx` |
| ERP-018 | Localization, currency and timezone | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Mobile, Other, Tests | `apps/landing/src/app/layout.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/lib/metadata.ts`<br>`apps/landing/src/lib/site-config.ts`<br>`apps/mobile/src/app/(protected)/(tabs)/pipeline.tsx`<br>`apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx`<br>`apps/mobile/src/app/(protected)/notifications.tsx`<br>`apps/mobile/src/shared/components/billing-manager.tsx` |
| ERP-019 | Data retention, privacy and consent | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/globals.css`<br>`apps/landing/src/app/privacy/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/security/page.tsx`<br>`apps/landing/src/app/terms/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/components/forms/lead-form.tsx` |
| ERP-020 | Backup, restore and disaster recovery | Mandatory | ✅ Present — static evidence | Backend, Database, Docs, Mobile, Other | `apps/landing/src/app/security/page.tsx`<br>`apps/mobile/app.config.ts`<br>`apps/mobile/plugins/with-disable-android-backup.js`<br>`apps/mobile/src/core/auth/device.ts`<br>`apps/mobile/src/core/auth/token-store.ts`<br>`apps/mobile/src/core/database/database.ts`<br>`database/tenant/migrations/027_enterprise_release_governance.sql`<br>`package.json` |
| ERP-021 | Health, readiness and observability | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Mobile, Other, Tests | `apps/landing/README.md`<br>`apps/landing/src/app/changelog/page.tsx`<br>`apps/landing/src/app/contact/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/globals.css`<br>`apps/landing/src/app/status/page.tsx`<br>`apps/landing/src/components/home/hero-section.tsx`<br>`apps/landing/src/components/marketing/public-status-check.tsx` |
| ERP-022 | Release, migration and environment validation | Mandatory | 🟡 Partial — verify manually | Docs, Mobile, Other | `apps/landing/README.md`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/pricing/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/mobile/STORE_RELEASE.md`<br>`Readme.md` |

## Shared Platform — features requiring manual verification

- [ ] **ERP-005 — Company and branch data isolation**
- [ ] **ERP-010 — Numbering series**
- [ ] **ERP-013 — Global search and saved filters**
- [ ] **ERP-022 — Release, migration and environment validation**

# CRM

**Total:** 18 · **Present:** 14 · **Partial:** 3 · **Not found:** 1

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-023 | Lead capture and lead master | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/mobile/src/modules/crm/components/lead-capture.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/crm/page.tsx`<br>`apps/web/src/app/(app)/crm/settings/page.tsx`<br>`apps/web/src/app/api/crm/[resource]/import/route.ts`<br>`apps/web/src/components/module-context-bar.tsx` |
| ERP-024 | Lead sources, campaigns and attribution | Common | ✅ Present — static evidence | Backend, Database, Frontend, Mobile | `apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/crm/page.tsx`<br>`apps/web/src/app/(app)/crm/settings/page.tsx`<br>`apps/web/src/lib/crm.ts`<br>`apps/web/src/lib/platform.ts`<br>`database/control-plane/migrations/004_crm_permissions.sql`<br>`database/control-plane/migrations/009_crm_release_scope.sql`<br>`database/tenant/migrations/002_crm_module.sql` |
| ERP-025 | Lead assignment and ownership | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend | `apps/web/src/app/api/crm/public/meetings/[token]/availability/route.ts`<br>`apps/web/src/app/api/crm/public/meetings/[token]/bookings/route.ts`<br>`apps/web/src/components/sales-document-editor.tsx`<br>`database/tenant/migrations/002_crm_module.sql`<br>`database/tenant/migrations/003_crm_enterprise_core.sql`<br>`database/tenant/migrations/004_enterprise_tenant_integrity.sql`<br>`database/tenant/migrations/005_crm_completion_pack.sql`<br>`database/tenant/migrations/008_sales_module.sql` |
| ERP-026 | Lead scoring and qualification | Common | ✅ Present — static evidence | Backend, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/crm/page.tsx`<br>`apps/web/src/app/(app)/crm/settings/page.tsx`<br>`apps/web/src/lib/crm.ts`<br>`services/api/src/crm/lead-intelligence.js`<br>`services/api/src/crm.js` |
| ERP-027 | Duplicate detection and merge | Mandatory | 🟡 Partial — verify manually | API, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx`<br>`apps/web/src/app/api/crm/leads/[id]/merge/route.ts` |
| ERP-028 | Lead conversion | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/product/page.tsx`<br>`apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx`<br>`apps/web/src/components/crm-lead-actions.tsx`<br>`database/control-plane/migrations/004_crm_permissions.sql`<br>`services/api/src/crm.js` |
| ERP-029 | Account and customer management | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/mobile/src/app/(protected)/workspace/[area].tsx`<br>`apps/web/src/app/(app)/crm/accounts/[id]/page.tsx`<br>`apps/web/src/app/(app)/master-data/page.tsx`<br>`apps/web/src/app/(app)/search/page.tsx`<br>`apps/web/src/app/api/crm/accounts/[id]/hierarchy/route.ts` |
| ERP-030 | Contact management | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-031 | Opportunity and pipeline management | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Mobile, Other | `apps/landing/src/app/book-demo/page.tsx`<br>`apps/landing/src/app/comparison/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/globals.css`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/components/home/operating-system-demo.tsx`<br>`apps/landing/src/content/erp.ts` |
| ERP-032 | Activities, tasks, calls and meetings | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/landing.ts`<br>`apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx`<br>`apps/mobile/src/modules/crm/components/create-record-sheet.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/crm/ai-intelligence/page.tsx`<br>`apps/web/src/app/(app)/crm/communications/page.tsx` |
| ERP-033 | Email, calendar and communication history | Common | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/crm.ts`<br>`database/tenant/migrations/005_crm_completion_pack.sql`<br>`database/tenant/migrations/032_crm_telephony_conversation_intelligence.sql`<br>`services/api/src/crm/communications.js`<br>`services/api/src/crm/conversation-intelligence.js`<br>`services/api/src/crm.js` |
| ERP-034 | Telephony and call logging | Common | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/crm/conversation-intelligence/page.tsx`<br>`apps/web/src/app/api/crm/conversation-intelligence/connections/route.ts`<br>`apps/web/src/app/api/crm/conversation-intelligence/webhooks/[provider]/route.ts`<br>`apps/web/src/app/api/mobile/v1/workspace/[area]/route.ts`<br>`apps/web/src/lib/crm.ts`<br>`database/control-plane/migrations/006_crm_enterprise_permissions.sql`<br>`database/tenant/migrations/005_crm_completion_pack.sql` |
| ERP-035 | Campaigns and marketing execution | Common | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/mobile/src/shared/components/structured-field-editor.tsx`<br>`apps/web/src/app/(app)/accounting/assets/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/payables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx`<br>`apps/web/src/app/(app)/crm/customer-success/page.tsx` |
| ERP-036 | Sales forecasting and quotas | Common | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/modules/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/mobile/src/core/modules/web-parity.ts`<br>`apps/web/package.json` |
| ERP-037 | Territory and partner/channel management | Common | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/crm/settings/page.tsx`<br>`apps/web/src/lib/crm-api.ts`<br>`apps/web/src/lib/crm-validation.ts`<br>`apps/web/src/lib/crm.ts`<br>`database/tenant/migrations/003_crm_enterprise_core.sql`<br>`database/tenant/migrations/004_enterprise_tenant_integrity.sql`<br>`database/tenant/migrations/017_crm_lead_governance.sql`<br>`database/tenant/migrations/037_crm_partner_engagement.sql` |
| ERP-038 | Consent, privacy and communication preferences | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other, Tests | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/globals.css`<br>`apps/landing/src/app/privacy/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/security/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/components/forms/lead-form.tsx`<br>`apps/landing/src/content/landing.ts` |
| ERP-039 | CRM dashboards and reports | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/crm/reports/page.tsx`<br>`apps/web/src/lib/crm-api.ts`<br>`apps/web/src/lib/crm.ts`<br>`database/control-plane/migrations/004_crm_permissions.sql`<br>`services/api/src/crm.js` |
| ERP-040 | CRM mobile and offline sync | Common | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/crm-offline-route.ts`<br>`database/tenant/migrations/039_crm_offline_completion.sql`<br>`services/api/src/crm/offline-sync.js` |

## CRM — features not found

- [ ] **ERP-030 — Contact management** (Mandatory)

## CRM — features requiring manual verification

- [ ] **ERP-027 — Duplicate detection and merge**
- [ ] **ERP-033 — Email, calendar and communication history**
- [ ] **ERP-040 — CRM mobile and offline sync**

# Sales

**Total:** 18 · **Present:** 10 · **Partial:** 5 · **Not found:** 3

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-041 | Product and service catalogue | Mandatory | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/business-data.ts`<br>`database/control-plane/migrations/003_business_data_permissions.sql` |
| ERP-042 | Price lists and customer pricing | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/sales/settings/page.tsx`<br>`apps/web/src/components/point-of-sale/point-of-sale-dashboard.tsx`<br>`apps/web/src/components/sales-document-editor.tsx`<br>`apps/web/src/lib/business-data.ts`<br>`database/control-plane/migrations/003_business_data_permissions.sql`<br>`services/api/src/sales/index.js` |
| ERP-043 | Quotation creation and versions | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx`<br>`apps/web/src/app/(app)/sales/page.tsx`<br>`apps/web/src/components/sales-document-editor.tsx`<br>`database/control-plane/migrations/012_sales_module_release.sql`<br>`database/tenant/migrations/008_sales_module.sql`<br>`database/tenant/migrations/020_sales_quotation_governance.sql`<br>`services/api/src/crm/account-intelligence.js`<br>`services/api/src/sales/index.js` |
| ERP-044 | Discount, tax and margin controls | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/customers/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/payables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx`<br>`apps/web/src/app/(app)/sales/page.tsx`<br>`apps/web/src/app/(app)/sales/quotations/[id]/page.tsx` |
| ERP-045 | Quotation approvals | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/(app)/sales/orders/page.tsx`<br>`apps/web/src/app/(app)/sales/quotations/page.tsx`<br>`apps/web/src/app/enterprise-modules.css`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`database/tenant/migrations/008_sales_module.sql`<br>`database/tenant/migrations/009_accounting_module.sql`<br>`database/tenant/migrations/046_projects_module.sql` |
| ERP-046 | Customer quotation acceptance or rejection | Mandatory | 🟡 Partial — verify manually | Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts` |
| ERP-047 | Sales order creation and lifecycle | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/sales/orders/new/page.tsx`<br>`apps/web/src/app/(app)/sales/orders/page.tsx`<br>`apps/web/src/app/(app)/sales/orders/[id]/page.tsx`<br>`apps/web/src/app/(app)/sales/page.tsx` |
| ERP-048 | Sales order amendments and holds | Common | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/sales/reports/page.tsx`<br>`apps/web/src/lib/approval-commands.ts`<br>`database/control-plane/migrations/012_sales_module_release.sql`<br>`services/api/src/sales/order-governance.js` |
| ERP-049 | Credit limits and credit checks | Mandatory | 🟡 Partial — verify manually | Backend | `apps/web/src/lib/business-data.ts`<br>`services/api/src/sales/index.js` |
| ERP-050 | Delivery schedules and commitments | Common | ❌ Not found | None | No matching source evidence |
| ERP-051 | Inventory reservation and available-to-promise | Common | ❌ Not found | None | No matching source evidence |
| ERP-052 | Pick, pack, ship and fulfilment | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/components/home/product-marketing-sections.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/sales/orders/page.tsx`<br>`apps/web/src/app/(app)/sales/orders/[id]/page.tsx`<br>`apps/web/src/app/(app)/sales/page.tsx`<br>`apps/web/src/app/(app)/sales/reports/page.tsx` |
| ERP-053 | Returns, exchanges and credit notes | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/payables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx`<br>`apps/web/src/components/accounting/subledger-document-editor.tsx`<br>`database/tenant/migrations/011_accounting_integrity_and_compliance.sql`<br>`services/api/src/accounting/payables.js`<br>`services/api/src/accounting/receivables.js`<br>`services/api/src/sales/order-governance.js` |
| ERP-054 | Sales contracts and blanket orders | Common | 🟡 Partial — verify manually | Other | `apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts` |
| ERP-055 | Recurring and subscription billing | Common | 🟡 Partial — verify manually | Other | `apps/landing/src/app/privacy/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts` |
| ERP-056 | Commissions and incentives | Common | ❌ Not found | None | No matching source evidence |
| ERP-057 | Invoice handoff and revenue handoff | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/web/src/app/(app)/sales/orders/[id]/page.tsx`<br>`apps/web/src/app/api/accounting/receivables/sales-requests/[id]/import/route.ts`<br>`database/control-plane/migrations/012_sales_module_release.sql`<br>`services/api/src/accounting/receivables-governance.js`<br>`services/api/src/accounting/receivables.js` |
| ERP-058 | Sales dashboards and reports | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/sales/reports/page.tsx`<br>`database/control-plane/migrations/012_sales_module_release.sql`<br>`services/api/src/sales/index.js` |

## Sales — features not found

- [ ] **ERP-050 — Delivery schedules and commitments** (Common)
- [ ] **ERP-051 — Inventory reservation and available-to-promise** (Common)
- [ ] **ERP-056 — Commissions and incentives** (Common)

## Sales — features requiring manual verification

- [ ] **ERP-041 — Product and service catalogue**
- [ ] **ERP-046 — Customer quotation acceptance or rejection**
- [ ] **ERP-049 — Credit limits and credit checks**
- [ ] **ERP-054 — Sales contracts and blanket orders**
- [ ] **ERP-055 — Recurring and subscription billing**

# Accounting

**Total:** 22 · **Present:** 16 · **Partial:** 6 · **Not found:** 0

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-059 | Chart of accounts | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/settings/page.tsx`<br>`database/control-plane/migrations/013_accounting_module_release.sql`<br>`database/tenant/migrations/009_accounting_module.sql`<br>`database/tenant/migrations/010_accounting_advanced.sql`<br>`database/tenant/migrations/011_accounting_integrity_and_compliance.sql` |
| ERP-060 | Fiscal years and accounting periods | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/workflows/page.tsx`<br>`apps/web/src/app/(app)/accounting/banking/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/(app)/accounting/planning/page.tsx`<br>`apps/web/src/app/api/accounting/banking/operations/route.ts`<br>`apps/web/src/components/onboarding-form.tsx`<br>`apps/web/src/lib/business-data.ts` |
| ERP-061 | Journal entries and posting | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/journals/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/journals/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/(app)/accounting/tax/page.tsx`<br>`apps/web/src/app/api/accounting/journals/route.ts`<br>`database/control-plane/migrations/013_accounting_module_release.sql`<br>`database/tenant/migrations/009_accounting_module.sql`<br>`database/tenant/migrations/010_accounting_advanced.sql` |
| ERP-062 | General ledger and trial balance | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/journals/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/journals/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`database/control-plane/migrations/013_accounting_module_release.sql` |
| ERP-063 | Accounts receivable and customer invoices | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/tax/page.tsx`<br>`apps/web/src/components/accounting/accounting-policy-editor.tsx`<br>`apps/web/src/components/accounting/subledger-document-editor.tsx` |
| ERP-064 | Accounts payable and supplier bills | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/(app)/accounting/payables/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/payables/page.tsx`<br>`apps/web/src/app/(app)/accounting/payables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/settings/page.tsx`<br>`apps/web/src/app/(app)/accounting/tax/page.tsx`<br>`apps/web/src/app/api/accounting/payables/operations/route.ts` |
| ERP-065 | Receipts, payments and allocations | Mandatory | 🟡 Partial — verify manually | Backend, Database | `database/control-plane/migrations/013_accounting_module_release.sql`<br>`database/tenant/migrations/011_accounting_integrity_and_compliance.sql`<br>`services/api/src/accounting/payables.js`<br>`services/api/src/accounting/receivables.js` |
| ERP-066 | Credit notes and debit notes | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/payables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx`<br>`apps/web/src/components/accounting/subledger-document-editor.tsx`<br>`database/tenant/migrations/011_accounting_integrity_and_compliance.sql`<br>`services/api/src/accounting/payables.js`<br>`services/api/src/accounting/receivables.js` |
| ERP-067 | Bank accounts and bank reconciliation | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/banking/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/api/accounting/banking/operations/route.ts`<br>`database/control-plane/migrations/013_accounting_module_release.sql`<br>`services/api/src/accounting/banking-governance.js`<br>`services/api/src/accounting/banking.js` |
| ERP-068 | Cash position and cash-flow forecasting | Common | 🟡 Partial — verify manually | Backend, Frontend | `apps/web/src/app/(app)/accounting/banking/page.tsx`<br>`services/api/src/accounting/banking-governance.js` |
| ERP-069 | GST and indirect tax calculation | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/tax/page.tsx`<br>`apps/web/src/app/(app)/sales/quotations/new/page.tsx`<br>`apps/web/src/app/(app)/sales/settings/page.tsx`<br>`apps/web/src/lib/business-data-validation.ts`<br>`apps/web/src/lib/business-data.ts` |
| ERP-070 | TDS, TCS and withholding tax | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/tax/page.tsx`<br>`apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`database/tenant/migrations/009_accounting_module.sql`<br>`database/tenant/migrations/051_hr_payroll_module.sql`<br>`services/api/src/accounting/foundation.js`<br>`services/api/src/accounting/tax.js` |
| ERP-071 | E-invoice and E-Way Bill integration | Mandatory | 🟡 Partial — verify manually | Backend, Frontend, Other | `apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/tax/page.tsx`<br>`services/api/src/accounting/advanced.js` |
| ERP-072 | Multi-currency and exchange revaluation | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/operations/page.tsx`<br>`apps/web/src/app/(app)/accounting/settings/page.tsx`<br>`apps/web/src/app/api/accounting/fx/revaluations/route.ts`<br>`apps/web/src/app/api/accounting/fx/revaluations/[id]/post/route.ts`<br>`apps/web/src/components/sales-document-editor.tsx` |
| ERP-073 | Budgets and budget control | Common | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/approval-commands.ts`<br>`database/control-plane/migrations/013_accounting_module_release.sql` |
| ERP-074 | Accruals, deferrals and recurring entries | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/planning/page.tsx`<br>`apps/web/src/app/api/accounting/accruals/route.ts`<br>`apps/web/src/app/api/accounting/accruals/run/route.ts`<br>`apps/web/src/components/accounting/recurring-editor.tsx`<br>`apps/web/src/lib/accounting-validation.ts` |
| ERP-075 | Fixed asset accounting | Common | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/assets/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/api/accounting/assets/route.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/assets/assets-dashboard.tsx` |
| ERP-076 | Intercompany accounting | Common | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/web/src/app/(app)/accounting/operations/page.tsx`<br>`apps/web/src/app/api/accounting/intercompany/postings/route.ts`<br>`apps/web/src/app/api/accounting/intercompany/rules/route.ts`<br>`apps/web/src/lib/access-control.ts`<br>`apps/web/src/lib/accounting-validation.ts`<br>`apps/web/src/lib/authorization.ts` |
| ERP-077 | Consolidation and eliminations | Common | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/web/src/app/(app)/accounting/operations/page.tsx`<br>`apps/web/src/app/api/accounting/consolidation/groups/route.ts`<br>`apps/web/src/app/api/accounting/consolidation/runs/route.ts`<br>`apps/web/src/app/api/accounting/consolidation/runs/[id]/actions/route.ts`<br>`apps/web/src/lib/access-control.ts`<br>`apps/web/src/lib/accounting-validation.ts` |
| ERP-078 | Period close and lock controls | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/web/src/app/(app)/accounting/banking/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/operations/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx`<br>`apps/web/src/app/(app)/accounting/reports/page.tsx`<br>`apps/web/src/components/accounting/accounting-policy-editor.tsx` |
| ERP-079 | Financial statements and statutory reports | Mandatory | 🟡 Partial — verify manually | Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/page.tsx` |
| ERP-080 | Subledger reconciliation and audit trail | Mandatory | 🟡 Partial — verify manually | Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/content/landing.ts`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/sales/quotations/[id]/page.tsx`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`database/control-plane/migrations/013_accounting_module_release.sql`<br>`database/control-plane/migrations/024_quality_module_release.sql` |

## Accounting — features requiring manual verification

- [ ] **ERP-065 — Receipts, payments and allocations**
- [ ] **ERP-068 — Cash position and cash-flow forecasting**
- [ ] **ERP-071 — E-invoice and E-Way Bill integration**
- [ ] **ERP-073 — Budgets and budget control**
- [ ] **ERP-079 — Financial statements and statutory reports**
- [ ] **ERP-080 — Subledger reconciliation and audit trail**

# Procurement

**Total:** 19 · **Present:** 6 · **Partial:** 11 · **Not found:** 2

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-081 | Supplier master and contacts | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/mobile/src/app/(protected)/workspace/[area].tsx`<br>`apps/web/src/app/(app)/master-data/page.tsx`<br>`apps/web/src/app/(app)/search/page.tsx`<br>`apps/web/src/lib/business-data.ts`<br>`apps/web/src/lib/crm.ts` |
| ERP-082 | Supplier onboarding and qualification | Mandatory | 🟡 Partial — verify manually | Backend, Database, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/lib/access-control.ts`<br>`database/control-plane/migrations/018_enterprise_roles_permissions.sql`<br>`services/api/src/procurement/governance.js`<br>`services/api/src/procurement/index.js` |
| ERP-083 | Supplier risk and compliance | Common | 🟡 Partial — verify manually | Frontend, Mobile | `apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/components/procurement/procurement-workspace.tsx` |
| ERP-084 | Purchase requisitions | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/workflows/page.tsx`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`apps/web/src/lib/access-control.ts`<br>`database/control-plane/migrations/018_enterprise_roles_permissions.sql`<br>`database/tenant/migrations/012_procurement_module.sql`<br>`database/tenant/migrations/013_procurement_enterprise_completion.sql`<br>`database/tenant/migrations/014_procurement_integrity_hardening.sql`<br>`services/api/src/procurement/governance.js` |
| ERP-085 | Requisition approvals and budget check | Mandatory | 🟡 Partial — verify manually | Backend, Other | `apps/landing/src/content/erp.ts`<br>`services/api/src/procurement/governance.js` |
| ERP-086 | RFQ, RFP and sourcing events | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`apps/web/src/lib/procurement-validation.ts`<br>`database/control-plane/migrations/014_procurement_module_release.sql`<br>`services/api/src/procurement/governance.js`<br>`services/api/src/procurement/index.js` |
| ERP-087 | Supplier bids and bid comparison | Mandatory | 🟡 Partial — verify manually | Backend, Database, Other | `apps/landing/src/app/product/page.tsx`<br>`apps/web/src/lib/access-control.ts`<br>`database/control-plane/migrations/018_enterprise_roles_permissions.sql`<br>`services/api/src/procurement/governance.js` |
| ERP-088 | Purchase agreements and contracts | Common | ❌ Not found | None | No matching source evidence |
| ERP-089 | Purchase orders and lines | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/api/mobile/v1/workspace/[area]/route.ts`<br>`apps/web/src/components/accounting/vendor-match-form.tsx`<br>`apps/web/src/components/app-shell.tsx` |
| ERP-090 | Purchase order amendments and approvals | Mandatory | 🟡 Partial — verify manually | Backend | `services/api/src/procurement/index.js` |
| ERP-091 | Supplier confirmations and advance shipping notice | Common | 🟡 Partial — verify manually | Backend, Database | `database/control-plane/migrations/014_procurement_module_release.sql`<br>`services/api/src/procurement/index.js` |
| ERP-092 | Goods receipt | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/accounting/vendor-match-form.tsx`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`apps/web/src/lib/access-control.ts`<br>`database/control-plane/migrations/018_enterprise_roles_permissions.sql`<br>`services/api/src/accounting/matching.js`<br>`services/api/src/accounting/payables.js`<br>`services/api/src/manufacturing/index.js`<br>`services/api/src/procurement/index.js` |
| ERP-093 | Service receipt and service entry | Common | 🟡 Partial — verify manually | Backend | `services/api/src/procurement/index.js` |
| ERP-094 | Purchase returns | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-095 | Two-way, three-way and four-way matching | Mandatory | ✅ Present — static evidence | API, Backend, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/accounting/payables/page.tsx`<br>`apps/web/src/app/api/mobile/v1/workspace/[area]/route.ts`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`services/api/src/accounting/matching.js`<br>`services/api/src/accounting/payables-governance.js`<br>`services/api/src/accounting/payables.js` |
| ERP-096 | Supplier invoice handoff | Mandatory | 🟡 Partial — verify manually | Backend, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/receivables/page.tsx`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`services/api/src/accounting/payables-governance.js`<br>`services/api/src/procurement/index.js`<br>`services/api/src/sales/order-governance.js` |
| ERP-097 | Supplier scorecards and performance | Common | 🟡 Partial — verify manually | Backend, Frontend | `apps/web/src/components/procurement/procurement-workspace.tsx`<br>`services/api/src/procurement/governance.js`<br>`services/api/src/procurement/index.js` |
| ERP-098 | Spend analytics and procurement reports | Common | 🟡 Partial — verify manually | Backend, Frontend | `apps/web/src/components/procurement/procurement-workspace.tsx`<br>`services/api/src/procurement/index.js` |
| ERP-099 | Supplier portal | Common | 🟡 Partial — verify manually | Frontend, Other | `apps/landing/src/app/product/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/procurement/settings/page.tsx` |

## Procurement — features not found

- [ ] **ERP-088 — Purchase agreements and contracts** (Common)
- [ ] **ERP-094 — Purchase returns** (Mandatory)

## Procurement — features requiring manual verification

- [ ] **ERP-082 — Supplier onboarding and qualification**
- [ ] **ERP-083 — Supplier risk and compliance**
- [ ] **ERP-085 — Requisition approvals and budget check**
- [ ] **ERP-087 — Supplier bids and bid comparison**
- [ ] **ERP-090 — Purchase order amendments and approvals**
- [ ] **ERP-091 — Supplier confirmations and advance shipping notice**
- [ ] **ERP-093 — Service receipt and service entry**
- [ ] **ERP-096 — Supplier invoice handoff**
- [ ] **ERP-097 — Supplier scorecards and performance**
- [ ] **ERP-098 — Spend analytics and procurement reports**
- [ ] **ERP-099 — Supplier portal**

# Stock

**Total:** 18 · **Present:** 4 · **Partial:** 9 · **Not found:** 5

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-100 | Item, unit and inventory classification | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/sales-document-editor.tsx`<br>`apps/web/src/lib/business-data.ts`<br>`database/control-plane/migrations/003_business_data_permissions.sql`<br>`services/api/src/accounting/payables.js`<br>`services/api/src/accounting/receivables.js`<br>`services/api/src/accounting/setup.js`<br>`services/api/src/procurement/index.js` |
| ERP-101 | Warehouses, locations and bins | Mandatory | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/business-data-validation.ts`<br>`apps/web/src/lib/business-data.ts`<br>`database/control-plane/migrations/003_business_data_permissions.sql`<br>`database/tenant/migrations/001_business_data_foundation.sql` |
| ERP-102 | Inventory balances and stock ledger | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/manufacturing/manufacturing-dashboard.tsx`<br>`database/tenant/migrations/044_stock_module.sql`<br>`services/api/src/manufacturing/index.js`<br>`services/api/src/point-of-sale/index.js`<br>`services/api/src/stock/index.js` |
| ERP-103 | Receipts and issues | Mandatory | 🟡 Partial — verify manually | Backend, Database, Other | `apps/landing/src/app/workflows/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`database/control-plane/migrations/019_stock_module_release.sql`<br>`packages/shared-types/src/modules.js` |
| ERP-104 | Warehouse transfers | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-105 | Adjustments and stock counts | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/019_stock_module_release.sql` |
| ERP-106 | Reservations and allocations | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/stock/stock-dashboard.tsx`<br>`database/tenant/migrations/008_sales_module.sql`<br>`database/tenant/migrations/044_stock_module.sql`<br>`database/tenant/migrations/045_manufacturing_module.sql`<br>`services/api/src/manufacturing/index.js`<br>`services/api/src/point-of-sale/index.js`<br>`services/api/src/sales/index.js`<br>`services/api/src/sales/order-governance.js` |
| ERP-107 | Reorder levels and safety stock | Common | ❌ Not found | None | No matching source evidence |
| ERP-108 | Replenishment planning | Common | 🟡 Partial — verify manually | Backend, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/stock/stock-dashboard.tsx`<br>`packages/shared-types/src/modules.js` |
| ERP-109 | Batch and lot tracking | Mandatory | 🟡 Partial — verify manually | Backend, Database | `database/tenant/migrations/044_stock_module.sql`<br>`services/api/src/stock/index.js` |
| ERP-110 | Serial number tracking | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/assets/new/page.tsx`<br>`apps/web/src/components/app-shell.tsx`<br>`database/tenant/migrations/044_stock_module.sql`<br>`services/api/src/stock/index.js` |
| ERP-111 | Expiry and shelf-life control | Common | 🟡 Partial — verify manually | Database | `database/tenant/migrations/044_stock_module.sql` |
| ERP-112 | Inventory valuation and costing | Mandatory | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/business-data-validation.ts`<br>`apps/web/src/lib/business-data.ts`<br>`database/tenant/migrations/001_business_data_foundation.sql`<br>`database/tenant/migrations/044_stock_module.sql`<br>`packages/shared-types/src/stock.js`<br>`services/api/src/stock/index.js` |
| ERP-113 | Landed cost allocation | Common | ❌ Not found | None | No matching source evidence |
| ERP-114 | Consignment and owned inventory | Common | ❌ Not found | None | No matching source evidence |
| ERP-115 | Traceability and recall | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-116 | Barcode and mobile warehouse operations | Common | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/business-data-validation.ts`<br>`apps/web/src/lib/business-data.ts`<br>`database/tenant/migrations/001_business_data_foundation.sql`<br>`services/api/src/index.js` |
| ERP-117 | Inventory reports and aging | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/019_stock_module_release.sql` |

## Stock — features not found

- [ ] **ERP-104 — Warehouse transfers** (Mandatory)
- [ ] **ERP-107 — Reorder levels and safety stock** (Common)
- [ ] **ERP-113 — Landed cost allocation** (Common)
- [ ] **ERP-114 — Consignment and owned inventory** (Common)
- [ ] **ERP-115 — Traceability and recall** (Mandatory)

## Stock — features requiring manual verification

- [ ] **ERP-101 — Warehouses, locations and bins**
- [ ] **ERP-103 — Receipts and issues**
- [ ] **ERP-105 — Adjustments and stock counts**
- [ ] **ERP-108 — Replenishment planning**
- [ ] **ERP-109 — Batch and lot tracking**
- [ ] **ERP-111 — Expiry and shelf-life control**
- [ ] **ERP-112 — Inventory valuation and costing**
- [ ] **ERP-116 — Barcode and mobile warehouse operations**
- [ ] **ERP-117 — Inventory reports and aging**

# Manufacturing

**Total:** 18 · **Present:** 3 · **Partial:** 6 · **Not found:** 9

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-118 | Bill of materials and versions | Mandatory | 🟡 Partial — verify manually | Backend, Database | `database/control-plane/migrations/020_manufacturing_module_release.sql`<br>`database/tenant/migrations/045_manufacturing_module.sql`<br>`services/api/src/manufacturing/index.js` |
| ERP-119 | Routings and operations | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/manufacturing/manufacturing-dashboard.tsx`<br>`apps/web/src/components/support/support-dashboard.tsx`<br>`apps/web/src/lib/authorization.ts`<br>`apps/web/src/lib/manufacturing-validation.ts`<br>`apps/web/src/lib/platform.ts` |
| ERP-120 | Work centres and calendars | Mandatory | 🟡 Partial — verify manually | Backend, Frontend | `apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/manufacturing/manufacturing-dashboard.tsx`<br>`packages/shared-types/src/modules.js` |
| ERP-121 | Capacity planning | Common | ❌ Not found | None | No matching source evidence |
| ERP-122 | Material requirements planning | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-123 | Master production schedule and production plan | Common | ❌ Not found | Other | `apps/landing/src/content/erp.ts` |
| ERP-124 | Work orders | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/manufacturing/manufacturing-dashboard.tsx`<br>`database/control-plane/migrations/020_manufacturing_module_release.sql`<br>`database/tenant/migrations/045_manufacturing_module.sql`<br>`packages/shared-types/src/modules.js`<br>`services/api/src/manufacturing/index.js` |
| ERP-125 | Material issue and material return | Mandatory | 🟡 Partial — verify manually | Backend | `services/api/src/manufacturing/index.js` |
| ERP-126 | Backflush consumption | Common | 🟡 Partial — verify manually | Backend, Database | `apps/web/src/lib/manufacturing-validation.ts`<br>`database/tenant/migrations/045_manufacturing_module.sql` |
| ERP-127 | Job cards and shop-floor execution | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-128 | Production receipt and finished goods | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-129 | Scrap, rework and by-products | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/assets/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/banking/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/page.tsx`<br>`apps/web/src/app/(app)/accounting/close/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/journals/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/journals/page.tsx` |
| ERP-130 | Subcontract manufacturing | Common | ❌ Not found | Other | `apps/landing/src/content/erp.ts` |
| ERP-131 | Work in progress | Mandatory | 🟡 Partial — verify manually | Backend | `apps/web/src/lib/business-data.ts` |
| ERP-132 | Production costing and variance | Mandatory | ❌ Not found | Other | `apps/landing/src/content/erp.ts` |
| ERP-133 | Batch and serial genealogy | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-134 | Quality and maintenance integration | Common | ❌ Not found | None | No matching source evidence |
| ERP-135 | Manufacturing reports and efficiency | Common | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/020_manufacturing_module_release.sql` |

## Manufacturing — features not found

- [ ] **ERP-121 — Capacity planning** (Common)
- [ ] **ERP-122 — Material requirements planning** (Mandatory)
- [ ] **ERP-123 — Master production schedule and production plan** (Common)
- [ ] **ERP-127 — Job cards and shop-floor execution** (Mandatory)
- [ ] **ERP-128 — Production receipt and finished goods** (Mandatory)
- [ ] **ERP-130 — Subcontract manufacturing** (Common)
- [ ] **ERP-132 — Production costing and variance** (Mandatory)
- [ ] **ERP-133 — Batch and serial genealogy** (Mandatory)
- [ ] **ERP-134 — Quality and maintenance integration** (Common)

## Manufacturing — features requiring manual verification

- [ ] **ERP-118 — Bill of materials and versions**
- [ ] **ERP-120 — Work centres and calendars**
- [ ] **ERP-125 — Material issue and material return**
- [ ] **ERP-126 — Backflush consumption**
- [ ] **ERP-131 — Work in progress**
- [ ] **ERP-135 — Manufacturing reports and efficiency**

# Projects

**Total:** 16 · **Present:** 1 · **Partial:** 8 · **Not found:** 7

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-136 | Project master and templates | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-137 | Work breakdown structure, milestones and tasks | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/changelog/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/crm/customer-success/page.tsx`<br>`apps/web/src/app/(app)/crm/opportunity-revenue/page.tsx`<br>`apps/web/src/app/api/crm/customer-success/accounts/[id]/route.ts`<br>`apps/web/src/app/api/mobile/v1/workspace/[area]/route.ts`<br>`apps/web/src/components/app-shell.tsx` |
| ERP-138 | Task dependencies and scheduling | Common | ❌ Not found | None | No matching source evidence |
| ERP-139 | Project teams, roles and resources | Mandatory | 🟡 Partial — verify manually | Backend, Database | `database/control-plane/migrations/021_projects_module_release.sql`<br>`services/api/src/projects/index.js` |
| ERP-140 | Time tracking and timesheets | Mandatory | 🟡 Partial — verify manually | Backend | `services/api/src/projects/index.js` |
| ERP-141 | Project expenses | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/021_projects_module_release.sql` |
| ERP-142 | Project budgets and forecasts | Mandatory | 🟡 Partial — verify manually | Database, Other | `apps/landing/src/content/erp.ts`<br>`database/control-plane/migrations/021_projects_module_release.sql` |
| ERP-143 | Project procurement and commitments | Common | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/021_projects_module_release.sql` |
| ERP-144 | Project materials and inventory | Common | ❌ Not found | None | No matching source evidence |
| ERP-145 | Project billing | Mandatory | 🟡 Partial — verify manually | Database, Other | `apps/landing/src/content/erp.ts`<br>`database/control-plane/migrations/021_projects_module_release.sql` |
| ERP-146 | Project revenue recognition | Common | ❌ Not found | None | No matching source evidence |
| ERP-147 | Risks, issues and change requests | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-148 | Project documents and collaboration | Common | ❌ Not found | None | No matching source evidence |
| ERP-149 | Project accounting and cost control | Mandatory | 🟡 Partial — verify manually | Frontend | `apps/web/src/components/projects/projects-dashboard.tsx` |
| ERP-150 | Profitability and utilization reports | Mandatory | 🟡 Partial — verify manually | Database, Other | `apps/landing/src/content/erp.ts`<br>`database/control-plane/migrations/021_projects_module_release.sql` |
| ERP-151 | Project dashboards and status reporting | Mandatory | ❌ Not found | None | No matching source evidence |

## Projects — features not found

- [ ] **ERP-136 — Project master and templates** (Mandatory)
- [ ] **ERP-138 — Task dependencies and scheduling** (Common)
- [ ] **ERP-144 — Project materials and inventory** (Common)
- [ ] **ERP-146 — Project revenue recognition** (Common)
- [ ] **ERP-147 — Risks, issues and change requests** (Mandatory)
- [ ] **ERP-148 — Project documents and collaboration** (Common)
- [ ] **ERP-151 — Project dashboards and status reporting** (Mandatory)

## Projects — features requiring manual verification

- [ ] **ERP-139 — Project teams, roles and resources**
- [ ] **ERP-140 — Time tracking and timesheets**
- [ ] **ERP-141 — Project expenses**
- [ ] **ERP-142 — Project budgets and forecasts**
- [ ] **ERP-143 — Project procurement and commitments**
- [ ] **ERP-145 — Project billing**
- [ ] **ERP-149 — Project accounting and cost control**
- [ ] **ERP-150 — Profitability and utilization reports**

# Assets

**Total:** 15 · **Present:** 1 · **Partial:** 8 · **Not found:** 6

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-152 | Asset categories and asset register | Mandatory | 🟡 Partial — verify manually | Backend, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/accounting/assets/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/page.tsx`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/assets/assets-dashboard.tsx`<br>`packages/shared-types/src/modules.js`<br>`services/api/src/accounting/assets.js`<br>`services/api/src/assets/index.js` |
| ERP-153 | Asset acquisition and capitalization | Mandatory | 🟡 Partial — verify manually | Database, Frontend | `apps/web/src/app/(app)/accounting/assets/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/page.tsx`<br>`apps/web/src/app/(app)/accounting/assets/[id]/page.tsx`<br>`database/control-plane/migrations/022_assets_module_release.sql` |
| ERP-154 | Multiple depreciation books and schedules | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend | `apps/web/src/app/(app)/accounting/assets/[id]/page.tsx`<br>`apps/web/src/app/api/accounting/assets/[id]/actions/route.ts`<br>`database/control-plane/migrations/022_assets_module_release.sql`<br>`services/api/src/accounting/assets.js` |
| ERP-155 | Asset assignment and custody | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/022_assets_module_release.sql` |
| ERP-156 | Asset transfer | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-157 | Physical verification and audit | Common | ❌ Not found | None | No matching source evidence |
| ERP-158 | Preventive and corrective maintenance | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-159 | Maintenance work orders and spare parts | Common | 🟡 Partial — verify manually | Backend, Frontend | `apps/web/src/components/assets/assets-dashboard.tsx`<br>`services/api/src/assets/index.js` |
| ERP-160 | Meter readings and usage | Common | ❌ Not found | None | No matching source evidence |
| ERP-161 | Warranty and service contract | Common | ❌ Not found | Other | `apps/landing/src/app/changelog/page.tsx` |
| ERP-162 | Impairment and revaluation | Common | ❌ Not found | None | No matching source evidence |
| ERP-163 | Asset retirement and disposal | Mandatory | 🟡 Partial — verify manually | Backend | `services/api/src/accounting/assets.js` |
| ERP-164 | Asset accounting integration | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/022_assets_module_release.sql` |
| ERP-165 | Asset history and audit trail | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/022_assets_module_release.sql` |
| ERP-166 | Asset reports | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/022_assets_module_release.sql` |

## Assets — features not found

- [ ] **ERP-156 — Asset transfer** (Mandatory)
- [ ] **ERP-157 — Physical verification and audit** (Common)
- [ ] **ERP-158 — Preventive and corrective maintenance** (Mandatory)
- [ ] **ERP-160 — Meter readings and usage** (Common)
- [ ] **ERP-161 — Warranty and service contract** (Common)
- [ ] **ERP-162 — Impairment and revaluation** (Common)

## Assets — features requiring manual verification

- [ ] **ERP-152 — Asset categories and asset register**
- [ ] **ERP-153 — Asset acquisition and capitalization**
- [ ] **ERP-155 — Asset assignment and custody**
- [ ] **ERP-159 — Maintenance work orders and spare parts**
- [ ] **ERP-163 — Asset retirement and disposal**
- [ ] **ERP-164 — Asset accounting integration**
- [ ] **ERP-165 — Asset history and audit trail**
- [ ] **ERP-166 — Asset reports**

# Point of Sale

**Total:** 15 · **Present:** 1 · **Partial:** 6 · **Not found:** 8

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-167 | Store, terminal and register configuration | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/023_point_of_sale_module_release.sql` |
| ERP-168 | Cashier and shift management | Mandatory | 🟡 Partial — verify manually | Backend, Database | `database/control-plane/migrations/023_point_of_sale_module_release.sql`<br>`packages/shared-types/src/modules.js`<br>`services/api/src/point-of-sale/index.js` |
| ERP-169 | Opening cash and cash drawer | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-170 | Product lookup and barcode scanning | Mandatory | 🟡 Partial — verify manually | Frontend | `apps/web/src/app/(app)/point-of-sale/[resource]/page.tsx` |
| ERP-171 | Prices, taxes and promotions | Mandatory | 🟡 Partial — verify manually | Docs, Frontend, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/crm/marketing/page.tsx`<br>`Readme.md` |
| ERP-172 | Customer and loyalty management | Common | ❌ Not found | None | No matching source evidence |
| ERP-173 | Cash, card, UPI and split payments | Mandatory | 🟡 Partial — verify manually | Backend, Database, Other | `apps/landing/src/app/privacy/page.tsx`<br>`apps/web/src/lib/point-of-sale-validation.ts`<br>`database/tenant/migrations/009_accounting_module.sql`<br>`database/tenant/migrations/048_point_of_sale_module.sql`<br>`packages/shared-types/src/point-of-sale.js`<br>`services/api/src/accounting/payables.js`<br>`services/api/src/accounting/receivables.js` |
| ERP-174 | Suspended and resumed transactions | Common | ❌ Not found | None | No matching source evidence |
| ERP-175 | Offline selling and synchronization | Common | ❌ Not found | None | No matching source evidence |
| ERP-176 | Returns, refunds and exchanges | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/api-developers/page.tsx`<br>`apps/landing/src/app/product/page.tsx`<br>`apps/mobile/STORE_RELEASE.md`<br>`apps/web/src/app/(app)/accounting/operations/page.tsx`<br>`apps/web/src/components/sales-document-editor.tsx`<br>`apps/web/src/lib/accounting-validation.ts`<br>`apps/web/src/lib/business-data-validation.ts`<br>`apps/web/src/lib/business-data.ts` |
| ERP-177 | Receipt printing and digital receipts | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-178 | Real-time inventory update | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-179 | Accounting posting | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-180 | Shift close and reconciliation | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-181 | POS reports and cashier variance | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/023_point_of_sale_module_release.sql` |

## Point of Sale — features not found

- [ ] **ERP-169 — Opening cash and cash drawer** (Mandatory)
- [ ] **ERP-172 — Customer and loyalty management** (Common)
- [ ] **ERP-174 — Suspended and resumed transactions** (Common)
- [ ] **ERP-175 — Offline selling and synchronization** (Common)
- [ ] **ERP-177 — Receipt printing and digital receipts** (Mandatory)
- [ ] **ERP-178 — Real-time inventory update** (Mandatory)
- [ ] **ERP-179 — Accounting posting** (Mandatory)
- [ ] **ERP-180 — Shift close and reconciliation** (Mandatory)

## Point of Sale — features requiring manual verification

- [ ] **ERP-167 — Store, terminal and register configuration**
- [ ] **ERP-168 — Cashier and shift management**
- [ ] **ERP-170 — Product lookup and barcode scanning**
- [ ] **ERP-171 — Prices, taxes and promotions**
- [ ] **ERP-173 — Cash, card, UPI and split payments**
- [ ] **ERP-181 — POS reports and cashier variance**

# Quality

**Total:** 16 · **Present:** 4 · **Partial:** 6 · **Not found:** 6

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-182 | Quality plans and inspection templates | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/quality/quality-dashboard.tsx`<br>`database/control-plane/migrations/024_quality_module_release.sql`<br>`packages/shared-types/src/modules.js`<br>`services/api/src/quality/index.js` |
| ERP-183 | Sampling plans | Common | ❌ Not found | None | No matching source evidence |
| ERP-184 | Incoming inspection | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-185 | In-process inspection | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-186 | Final inspection | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/024_quality_module_release.sql` |
| ERP-187 | Supplier quality | Common | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/quality/quality-dashboard.tsx`<br>`database/control-plane/migrations/024_quality_module_release.sql`<br>`packages/shared-types/src/modules.js` |
| ERP-188 | Customer complaints and quality cases | Common | ❌ Not found | None | No matching source evidence |
| ERP-189 | Inspection results and certificates | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-190 | Quality hold and release | Mandatory | 🟡 Partial — verify manually | Database, Frontend | `apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/quality/quality-dashboard.tsx`<br>`database/control-plane/migrations/024_quality_module_release.sql` |
| ERP-191 | Non-conformance management | Mandatory | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/quality/[resource]/page.tsx`<br>`apps/web/src/app/api/quality/resources/[resource]/route.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/quality/quality-dashboard.tsx`<br>`apps/web/src/lib/authorization.ts`<br>`apps/web/src/lib/platform.ts`<br>`apps/web/src/lib/quality-validation.ts` |
| ERP-192 | Corrective and preventive action | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Infrastructure, Mobile, Other | `apps/landing/src/app/careers/page.tsx`<br>`apps/landing/src/app/comparison/page.tsx`<br>`apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/globals.css`<br>`apps/landing/src/app/industries/page.tsx`<br>`apps/landing/src/app/industries/[slug]/page.tsx`<br>`apps/landing/src/app/modules/[slug]/page.tsx`<br>`apps/landing/src/app/partner/page.tsx` |
| ERP-193 | Root-cause analysis | Mandatory | 🟡 Partial — verify manually | Frontend | `apps/web/src/components/quality/quality-dashboard.tsx` |
| ERP-194 | Deviation and concession management | Common | ❌ Not found | None | No matching source evidence |
| ERP-195 | Calibration and test equipment | Common | 🟡 Partial — verify manually | Database | `database/tenant/migrations/047_assets_module.sql` |
| ERP-196 | Quality audits and traceability | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/024_quality_module_release.sql` |
| ERP-197 | Statistical process control and reports | Common | 🟡 Partial — verify manually | Database, Other | `apps/landing/src/content/erp.ts`<br>`database/control-plane/migrations/024_quality_module_release.sql`<br>`pnpm-lock.yaml` |

## Quality — features not found

- [ ] **ERP-183 — Sampling plans** (Common)
- [ ] **ERP-184 — Incoming inspection** (Mandatory)
- [ ] **ERP-185 — In-process inspection** (Mandatory)
- [ ] **ERP-188 — Customer complaints and quality cases** (Common)
- [ ] **ERP-189 — Inspection results and certificates** (Mandatory)
- [ ] **ERP-194 — Deviation and concession management** (Common)

## Quality — features requiring manual verification

- [ ] **ERP-186 — Final inspection**
- [ ] **ERP-190 — Quality hold and release**
- [ ] **ERP-193 — Root-cause analysis**
- [ ] **ERP-195 — Calibration and test equipment**
- [ ] **ERP-196 — Quality audits and traceability**
- [ ] **ERP-197 — Statistical process control and reports**

# Support

**Total:** 15 · **Present:** 2 · **Partial:** 6 · **Not found:** 7

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-198 | Ticket and case management | Mandatory | 🟡 Partial — verify manually | Backend, Database, Other | `apps/landing/src/app/workflows/page.tsx`<br>`database/control-plane/migrations/025_support_module_release.sql`<br>`services/api/src/support/index.js` |
| ERP-199 | Email-to-ticket and inbound channels | Common | ❌ Not found | None | No matching source evidence |
| ERP-200 | Customer support portal | Common | ❌ Not found | None | No matching source evidence |
| ERP-201 | Queues, categories and priorities | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Mobile, Other | `apps/landing/src/app/login/page.tsx`<br>`apps/landing/src/app/pricing/page.tsx`<br>`apps/landing/src/app/sitemap.ts`<br>`apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx`<br>`apps/mobile/src/shared/components/crm-list-screen.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/src/app/(app)/accounting/banking/page.tsx`<br>`apps/web/src/app/(app)/accounting/payables/page.tsx` |
| ERP-202 | Assignment and ownership | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-203 | Service-level agreements | Mandatory | 🟡 Partial — verify manually | Database, Other | `apps/landing/src/app/help/page.tsx`<br>`apps/landing/src/content/erp.ts`<br>`database/control-plane/migrations/005_billing_and_razorpay.sql`<br>`database/control-plane/migrations/009_crm_release_scope.sql`<br>`database/control-plane/migrations/025_support_module_release.sql` |
| ERP-204 | Escalation rules | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-205 | Communication timeline and attachments | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-206 | Knowledge base | Common | 🟡 Partial — verify manually | Database, Frontend | `apps/web/src/components/support/support-dashboard.tsx`<br>`database/control-plane/migrations/025_support_module_release.sql` |
| ERP-207 | Canned responses and response templates | Common | ❌ Not found | None | No matching source evidence |
| ERP-208 | Entitlements, warranty and service contracts | Common | 🟡 Partial — verify manually | Backend, Database, Other | `apps/landing/src/app/changelog/page.tsx`<br>`apps/landing/src/app/terms/page.tsx`<br>`apps/web/src/lib/assets-validation.ts`<br>`database/tenant/migrations/047_assets_module.sql`<br>`services/api/src/assets/index.js` |
| ERP-209 | Customer and product history | Mandatory | 🟡 Partial — verify manually | Backend, Frontend, Other | `apps/landing/src/components/home/product-marketing-sections.tsx`<br>`apps/landing/src/content/erp.ts`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/support/support-dashboard.tsx`<br>`packages/shared-types/src/modules.js` |
| ERP-210 | Problem and incident management | Common | ❌ Not found | None | No matching source evidence |
| ERP-211 | Customer satisfaction | Common | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/app/(app)/crm/customer-success/page.tsx`<br>`database/tenant/migrations/030_crm_customer_success.sql`<br>`services/api/src/crm/customer-success.js`<br>`services/api/src/crm/marketing-execution.js` |
| ERP-212 | Support automation and reports | Mandatory | 🟡 Partial — verify manually | Database | `database/control-plane/migrations/025_support_module_release.sql` |

## Support — features not found

- [ ] **ERP-199 — Email-to-ticket and inbound channels** (Common)
- [ ] **ERP-200 — Customer support portal** (Common)
- [ ] **ERP-202 — Assignment and ownership** (Mandatory)
- [ ] **ERP-204 — Escalation rules** (Mandatory)
- [ ] **ERP-205 — Communication timeline and attachments** (Mandatory)
- [ ] **ERP-207 — Canned responses and response templates** (Common)
- [ ] **ERP-210 — Problem and incident management** (Common)

## Support — features requiring manual verification

- [ ] **ERP-198 — Ticket and case management**
- [ ] **ERP-203 — Service-level agreements**
- [ ] **ERP-206 — Knowledge base**
- [ ] **ERP-208 — Entitlements, warranty and service contracts**
- [ ] **ERP-209 — Customer and product history**
- [ ] **ERP-212 — Support automation and reports**

# HR & Payroll

**Total:** 24 · **Present:** 9 · **Partial:** 4 · **Not found:** 11

| ID | Feature | Importance | Status | Evidence layers | Evidence files |
|---|---|---|---|---|---|
| ERP-213 | Employee master and employment lifecycle | Mandatory | 🟡 Partial — verify manually | Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`database/control-plane/migrations/026_hr_payroll_module_release.sql` |
| ERP-214 | Organisation structure, jobs and positions | Mandatory | ✅ Present — static evidence | API, Backend, Database, Docs, Frontend, Mobile, Other | `apps/landing/src/app/features/page.tsx`<br>`apps/landing/src/app/how-it-works/page.tsx`<br>`apps/mobile/src/core/modules/navigation.ts`<br>`apps/mobile/src/shared/components/access-manager.tsx`<br>`apps/mobile/src/shared/components/workspace-page.tsx`<br>`apps/web/README.md`<br>`apps/web/src/app/(app)/accounting/assets/new/page.tsx`<br>`apps/web/src/app/(app)/accounting/journals/new/page.tsx` |
| ERP-215 | Recruitment and applicant tracking | Common | ✅ Present — static evidence | API, Backend, Database, Frontend, Other | `apps/landing/src/lib/lead-security.ts`<br>`apps/landing/src/lib/site-config.ts`<br>`apps/web/src/app/(app)/accounting/payables/[id]/page.tsx`<br>`apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx`<br>`apps/web/src/app/(app)/crm/ai-intelligence/page.tsx`<br>`apps/web/src/app/api/billing/webhooks/razorpay/route.ts`<br>`apps/web/src/components/accounting/credit-allocation-form.tsx`<br>`apps/web/src/components/crm-section-tabs.tsx` |
| ERP-216 | Onboarding and offboarding | Mandatory | ❌ Not found | Other | `apps/landing/src/content/erp.ts` |
| ERP-217 | Attendance and biometric import | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Mobile, Other | `apps/landing/src/content/erp.ts`<br>`apps/mobile/app.config.ts`<br>`apps/mobile/STORE_RELEASE.md`<br>`apps/web/src/app/(app)/hr-payroll/[resource]/page.tsx`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`apps/web/src/lib/authorization.ts`<br>`database/control-plane/migrations/026_hr_payroll_module_release.sql` |
| ERP-218 | Shifts and rosters | Mandatory | 🟡 Partial — verify manually | Frontend | `apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx` |
| ERP-219 | Leave management | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`database/control-plane/migrations/026_hr_payroll_module_release.sql`<br>`services/api/src/hr-payroll/index.js` |
| ERP-220 | Timesheets and overtime | Common | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`database/tenant/migrations/051_hr_payroll_module.sql`<br>`services/api/src/hr-payroll/index.js` |
| ERP-221 | Employee expenses and reimbursements | Common | 🟡 Partial — verify manually | Frontend | `apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx` |
| ERP-222 | Performance goals and reviews | Common | ❌ Not found | None | No matching source evidence |
| ERP-223 | Learning, skills and certifications | Common | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/app/partner/page.tsx`<br>`apps/landing/src/app/pricing/page.tsx`<br>`apps/landing/src/app/security/page.tsx`<br>`apps/web/src/components/procurement/procurement-workspace.tsx`<br>`apps/web/src/lib/procurement-validation.ts`<br>`database/tenant/migrations/012_procurement_module.sql`<br>`database/tenant/migrations/013_procurement_enterprise_completion.sql`<br>`database/tenant/migrations/014_procurement_integrity_hardening.sql` |
| ERP-224 | Compensation and benefits | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`apps/web/src/lib/authorization.ts`<br>`database/control-plane/migrations/026_hr_payroll_module_release.sql`<br>`database/tenant/migrations/051_hr_payroll_module.sql`<br>`packages/permissions/src/hr-payroll.js`<br>`packages/shared-types/src/modules.js`<br>`services/api/src/hr-payroll/index.js` |
| ERP-225 | Loans and salary advances | Common | ❌ Not found | None | No matching source evidence |
| ERP-226 | Payroll structures and salary components | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-227 | Earnings, deductions and arrears | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-228 | Provident Fund, ESIC and professional tax | Mandatory | 🟡 Partial — verify manually | Frontend | `apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx` |
| ERP-229 | Payroll TDS and income tax | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-230 | Payroll processing and validation | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend | `apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`database/control-plane/migrations/026_hr_payroll_module_release.sql`<br>`services/api/src/hr-payroll/index.js` |
| ERP-231 | Payslips and payroll register | Mandatory | ✅ Present — static evidence | Backend, Database, Frontend, Other | `apps/landing/src/content/erp.ts`<br>`apps/web/src/app/(app)/hr-payroll/[resource]/page.tsx`<br>`apps/web/src/components/app-shell.tsx`<br>`apps/web/src/components/hr-payroll/hr-payroll-dashboard.tsx`<br>`apps/web/src/lib/authorization.ts`<br>`database/control-plane/migrations/026_hr_payroll_module_release.sql`<br>`database/tenant/migrations/051_hr_payroll_module.sql`<br>`packages/permissions/src/hr-payroll.js` |
| ERP-232 | Bank transfer and payment file | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-233 | Final settlement | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-234 | Employee and manager self-service | Common | ❌ Not found | None | No matching source evidence |
| ERP-235 | Payroll accounting posting | Mandatory | ❌ Not found | None | No matching source evidence |
| ERP-236 | HR and statutory reports | Mandatory | ❌ Not found | None | No matching source evidence |

## HR & Payroll — features not found

- [ ] **ERP-216 — Onboarding and offboarding** (Mandatory)
- [ ] **ERP-222 — Performance goals and reviews** (Common)
- [ ] **ERP-225 — Loans and salary advances** (Common)
- [ ] **ERP-226 — Payroll structures and salary components** (Mandatory)
- [ ] **ERP-227 — Earnings, deductions and arrears** (Mandatory)
- [ ] **ERP-229 — Payroll TDS and income tax** (Mandatory)
- [ ] **ERP-232 — Bank transfer and payment file** (Mandatory)
- [ ] **ERP-233 — Final settlement** (Mandatory)
- [ ] **ERP-234 — Employee and manager self-service** (Common)
- [ ] **ERP-235 — Payroll accounting posting** (Mandatory)
- [ ] **ERP-236 — HR and statutory reports** (Mandatory)

## HR & Payroll — features requiring manual verification

- [ ] **ERP-213 — Employee master and employment lifecycle**
- [ ] **ERP-218 — Shifts and rosters**
- [ ] **ERP-221 — Employee expenses and reimbursements**
- [ ] **ERP-228 — Provident Fund, ESIC and professional tax**

# Release discipline

A feature should be changed from static evidence to released only after all applicable items pass:

- [ ] Product scope and acceptance criteria
- [ ] Database migration and rollback/forward-fix strategy
- [ ] Tenant isolation and row-level security
- [ ] Backend business rules and transaction safety
- [ ] API authentication, permission, origin and input validation
- [ ] Web frontend
- [ ] Required mobile workflow
- [ ] Audit events and notifications
- [ ] Unit, API, database, permission and concurrency tests
- [ ] Browser or device workflow acceptance
- [ ] Demo data and user documentation
- [ ] Known limitations recorded

---

Generated using Node.js by `generate-vercent-feature-register-node.sh`.
