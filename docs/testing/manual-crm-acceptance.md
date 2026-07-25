# Manual CRM acceptance — real-user journey

This checklist validates the released public website, platform foundation,
master data and CRM through the same screens and APIs a customer uses. It does
not require or create a demo user, demo company or sample business records.

## Test safety

- Use a non-production database and email destination.
- Keep `BILLING_CHECKOUT_ENABLED=false` and
  `BILLING_ENFORCEMENT_MODE=observe` until payment operations are approved.
- Start from a clean browser profile and record the exact commit, browser and
  date in the test evidence.
- Test with at least two organisations and two roles to prove isolation and
  permission denial, not only successful owner flows.
- Do not use real customer personal data during pre-production testing.

## 1. Start and basic availability

1. Run the local PostgreSQL infrastructure and both applications.
2. Open the landing site and authenticated application in desktop and mobile
   browser widths.
3. Confirm `/api/health` for both applications returns success.
4. Confirm the web `/api/readiness` endpoint reports `ready` only after the
   latest control and tenant migrations have been applied.
5. Check the browser console and server output for uncaught errors.

## 2. Registration, verification and recovery

1. Register a new account through `/signup` using an email you control.
2. Confirm duplicate registration does not reveal unnecessary account details.
3. Open the verification message or the development-only verification link.
4. Verify the account once and confirm a replay cannot verify it again.
5. Sign in with the correct password and verify an incorrect password is
   rejected without identifying whether another account exists.
6. Request a password reset, use it once, and confirm the token cannot be reused.
7. Change the password from Account Security.
8. Review active sessions, revoke a second session and confirm it loses access.
9. Sign out and confirm protected pages redirect to login.

## 3. Organisation onboarding

1. Complete onboarding through the UI with a real test-company name, code,
   primary company, branch, country, timezone and base currency.
2. Confirm the dashboard opens in the correct organisation, company and branch
   context.
3. Confirm the following mandatory configuration exists without manual SQL:
   - CRM enabled and the eleven roadmap modules unavailable;
   - a standard pipeline with usable open, won and lost stages;
   - lead sources, lost reasons, tags and CRM settings;
   - a primary sales team;
   - numbering for leads, opportunities, campaigns and activities;
   - normal organisation roles, permissions and master-data defaults.
4. Refresh and sign in again to confirm onboarding is idempotent and does not
   create duplicate foundations.

## 4. Organisation structure and access

1. Review and update company and branch details.
2. Create a department, team and cost centre where permitted.
3. Invite a second user through the UI and accept the invitation as that user.
4. Assign a restricted role that can view CRM but cannot administer users,
   roles, billing or organisation settings.
5. Confirm restricted navigation items are absent.
6. Attempt direct URLs for hidden administration and CRM-management pages;
   confirm access is denied rather than merely hidden.
7. Confirm users from another organisation cannot be selected as CRM owners,
   assignees, managers, reviewers or sponsors.

## 5. Master data

1. Create a business party and contact.
2. Create an item group, unit of measure and item.
3. Create or review currencies, payment terms, tax configuration and warehouse
   setup appropriate to the current release foundation.
4. Export a resource to CSV and verify headings and data.
5. Import a small valid CSV.
6. Import a CSV containing one invalid database row between valid rows. Confirm
   the invalid row is reported while valid rows continue, proving per-row
   savepoint recovery.
7. Confirm a restricted user cannot import or mutate resources without the
   required permission.

## 6. CRM lead lifecycle

1. Create a lead with source, contact information, owner and consent context.
2. Confirm its generated lead number is unique and correctly formatted.
3. Edit the lead and verify the activity/audit history reflects the change.
4. Create a similar lead and run duplicate detection.
5. Merge only after reviewing the survivor and source records.
6. Add and complete calls, meetings, tasks or notes.
7. Test lead scoring and assignment rules using fields you enter through the UI.
8. Convert a qualified lead. Confirm linked party/contact/opportunity records
   are created or selected exactly once.
9. Confirm conversion cannot be repeated accidentally.

## 7. Opportunity and pipeline lifecycle

1. Create an opportunity directly and from a converted lead.
2. Confirm its opportunity number is generated.
3. Move it across pipeline stages using the board and detail view.
4. Confirm probability and forecast category reflect the selected stage.
5. Add products, stakeholders, competitors, team members and activities where
   available.
6. Mark one opportunity won and another lost with a reason.
7. Confirm invalid transitions, missing required lost reasons and cross-tenant
   references are rejected.
8. Review forecast, pipeline and stale-opportunity reports.

## 8. Governed approvals

1. As a CRM manager, choose a different opportunity stage and request approval
   instead of moving it immediately.
2. Confirm the request appears in the approval centre for another user with
   `approvals.manage`, and that the requester cannot approve their own request.
3. Approve with the expected version and confirm the opportunity moves exactly
   once inside the same transaction as the immutable decision record and audit
   event.
4. Repeat with an activity-completion request and confirm rejection requires a
   note while leaving the activity unchanged.
5. Repeat from the native client and confirm the same tenant, permission, billing,
   version and separation-of-duties boundaries apply.

## 9. Campaigns, communications and automation

1. Create a campaign and confirm its campaign number.
2. Create a sequence or workflow using only the capabilities shown as released.
3. Queue a test communication using the fake provider in local testing.
4. Run the CRM jobs and outbox commands once and review delivery, suppression,
   retry and dead-letter behaviour.
5. Confirm outbound delivery is suppressed when explicit consent is required
   but missing.
6. Do not claim Gmail, Microsoft 365, WhatsApp, telephony or AI connectivity
   unless a real provider adapter and credentials have separately passed an
   acceptance test.

## 10. Public website to CRM

1. In CRM settings, create a public capture form and copy its public URL/key.
2. Configure the landing application's `CRM_CAPTURE_URL` and use the same
   32-character-or-longer proxy secret in both applications.
3. Submit Contact and Early Access forms through the public website.
4. Confirm each accepted submission creates one lead with the expected source,
   campaign metadata and consent context.
5. Confirm tampered signatures, expired timestamps, oversized bodies, invalid
   origins and repeated abuse are rejected.
6. Confirm direct public capture still uses the real client fingerprint and the
   trusted landing proxy uses only a verified signed fingerprint.

## 11. Search, reports and privacy

1. Search for a lead, opportunity, business party and item.
2. Repeat as a restricted user and confirm results obey CRM, master-data,
   company and branch scope.
3. Review CRM dashboard, pipeline, conversion, activity, source and forecast
   reports against manually known totals.
4. Export CRM resources and inspect encoding, delimiters and access control.
5. Exercise privacy/consent records and verify sensitive actions are audited.

## 12. Billing and release scope

1. Confirm CRM is the only enabled business module.
2. Confirm all eleven future modules are visibly marked as roadmap and cannot be
   enabled through either UI or API, including by an owner.
3. Review plan summaries and confirm they promise only CRM/platform capability.
4. Keep checkout disabled unless test-mode checkout, signature verification,
   webhook replay, invoice/tax handling, cancellation, refund, failed-payment
   recovery and customer support procedures have passed separately.

## 13. Isolation and destructive tests

1. Create a second test organisation through the normal product flow.
2. Create recognisable records in both organisations.
3. Switch context and confirm lists, detail URLs, search, export, import,
   reports, assignments and public capture never expose the other tenant.
4. Attempt to reuse IDs from the other organisation through request editing;
   expect not-found or validation responses.
5. Confirm the application database role is not a superuser, table owner or
   `BYPASSRLS` role.

## Acceptance evidence

Capture screenshots or a test log for every section, the exact failing request
for every defect, database-verifier output, production build output and the
final deployment smoke result. A release is accepted only when every critical
item passes or has an explicitly approved, time-bounded exception.
