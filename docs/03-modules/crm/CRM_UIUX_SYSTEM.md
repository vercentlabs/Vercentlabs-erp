# CRM unified UI/UX system

This is the implementation contract for the September 2026 CRM presentation convergence.

## Single-source rules

1. `packages/shared-ui/tokens/theme.json` is the authoritative semantic theme for web and native. `scripts/design/generate-theme.mjs` generates platform adapters.
2. `apps/web/src/modules/crm/ui/crm.css` is the only route-level CRM stylesheet. CRM presentation CSS must not return to `apps/web/src/app`.
3. CRM CSS may consume `--erp-*` tokens but may not define competing `:root` tokens, literal colors, or `!important` overrides.
4. CRM responsive behavior uses one breakpoint grammar: 480, 768, 1024 and 1280. Features reflow or progressively disclose; they do not disappear on smaller screens.
5. Shared `src/shared/design/Dialog` and `ConfirmDialog` own modal/drawer behavior. CRM feature code may not create native `<dialog>`, `showModal()`, browser `alert/confirm/prompt`, or duplicate focus traps.
6. `crm-route-registry.ts` is the page-archetype contract. Route files own data/domain composition, not independent page geometry.
7. Web and mobile both map exactly F001-F030. A mobile capability may deliberately open the governed web workspace, but it may not disappear from discovery.
8. Web interaction targets remain at least 44px; native interaction targets remain at least 48px. Visible focus and reduced-motion behavior are mandatory.

## Information architecture

- Home
- Customers: Leads, Accounts, Contacts
- Pipeline: Opportunities, Pipeline board, Forecast
- Work: My work, Tasks, Calls, Meetings, Follow-ups, Calendar, Activity timeline
- Engagement: Team inbox
- Insights: Reports
- Administration: Data management, All CRM features, CRM setup

CRM Setup owns lead management, pipeline governance, revenue operations, and customization. `All CRM features` remains the deterministic discovery fallback.

## Page archetypes

Every CRM route resolves to one of: Home, List/Work Queue, Record 360, Board, Calendar, Inbox, Analytics, Data Operations, Setup Catalogue, Setup Rule, or Feature Directory. The shared route wrapper standardizes content geometry, skip navigation, responsive gutters, focus behavior and page density.

## Verification

Dependency-free gate:

```bash
node scripts/validation/verify-crm-uiux.mjs
node --test apps/web/tests/crm-uiux-system.test.mjs
```

Repository gate when running the declared Node 24 toolchain with dependencies installed:

```bash
corepack pnpm verify:crm
```

The UI/UX validator is fail-closed for token drift, legacy CRM CSS layers, raw CRM CSS colors, noncanonical breakpoints, `!important`, competing CRM `:root` blocks, duplicate native dialogs, missing F001-F030 web/mobile mappings, broken canonical navigation, and stale generated theme adapters.
