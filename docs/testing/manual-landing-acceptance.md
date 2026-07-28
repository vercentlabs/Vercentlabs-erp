# Public website end-to-end acceptance

Complete this checklist in staging from the exact release commit after the
production build, API journey verifier and Chromium browser verifier pass. Record the commit,
deployment URL, browser versions, tester and evidence links.

## Release truth

- The homepage, product, features, workflows, modules, pricing and demo pages
  state that CRM, Sales, Accounting and Procurement are released early-access
  modules and eight modules are roadmap.
- Synthetic product data is visibly labelled and is not presented as customer
  proof, usage analytics or commercial performance.
- Pricing shows **Start 14-day trial** only when the secure ERP application URL
  is configured; otherwise it shows **Request early access**.
- Submitting a public form never claims that a trial, account or verification
  token was created.

## Responsive layouts

Check every public page at 320, 360, 390, 768, 1024 and 1440 CSS pixels.

- No horizontal page overflow, clipped text or unreachable controls.
- Header, footer, tables, workflow preview, pricing, forms and legal content
  reflow without relying on browser zoom.
- Touch targets are at least 44 CSS pixels where practical.
- Content remains readable at 200% browser zoom and with enlarged system text.
- Portrait and landscape orientation changes preserve the current route and
  interaction state.

## Navigation and keyboard

- The skip link moves focus to the main content.
- Every header, footer and in-page link resolves without a 4xx/5xx response.
- Mobile navigation moves focus into the dialog, traps Tab/Shift+Tab, closes on
  Escape, restores focus to the menu button and prevents background scrolling.
- The product preview tabs work with click, Enter/Space, Left/Right, Home and
  End, and expose the active panel to assistive technology.
- Focus is always visible and follows the visual reading order.

## Contact and demo journeys

Use controlled QA identities, not real prospects.

- Valid contact submission returns a visible success state and creates exactly
  one contact enquiry at the configured CRM or webhook destination.
- Valid demo submission creates exactly one demo request and continues to the
  truthful request-received page.
- Required fields, invalid email, invalid phone, missing consent, stale form,
  too-fast submission and unsupported selection produce clear errors.
- Invalid origin, invalid content type, oversized body and missing trusted
  proxy identity fail closed.
- Honeypot submission returns a neutral response without creating a lead.
- Distributed rate limiting returns HTTP 429 with `Retry-After` and the public
  fallback email remains usable.
- A destination outage produces a non-success response and does not show a
  false completion message.

## Accessibility and motion

- Run an automated accessibility scan on the homepage, product, pricing,
  contact, demo, security and legal pages with no critical violations.
- Test keyboard-only operation and one screen reader on desktop and mobile.
- Headings are hierarchical, landmarks are named and form errors are associated
  with their fields.
- With reduced motion enabled, reveals are immediate and no essential meaning
  depends on animation.
- Text and interactive states meet the approved contrast target.

## Metadata and production surface

- Canonical URLs, page titles, descriptions, Open Graph image, icon, manifest,
  robots and sitemap use the production origin and current operator identity.
- Security headers are present on public HTML routes.
- `/api/health` reports only the public deployment health; the status page does
  not claim an SLA or product availability it cannot measure.
- The deployed smoke verifier passes with `LANDING_URL` and `WEB_URL`.
- A controlled `SMOKE_LEAD_EMAIL` run returns HTTP 202 and the resulting record
  is confirmed at the real destination, then archived.

## Approval

Do not promote the deployment until all failures are resolved or explicitly
accepted by the product, engineering, security and business owners. Automated
source tests and local mocks do not replace this deployed acceptance.
