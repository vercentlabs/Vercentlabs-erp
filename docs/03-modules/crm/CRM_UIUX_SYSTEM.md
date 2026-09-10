# CRM UI/UX System

This file is the implementation contract for the CRM presentation layer introduced by the September 2026 UI/UX reconstruction pass.

## Product rules

1. Every one of the 30 canonical CRM capabilities must have a deliberate UI surface in `crm-surface-registry.ts`.
2. Daily work belongs in the CRM navigation; administration belongs under CRM Setup; contextual record actions stay inside Record 360 rather than bloating the sidebar.
3. `All CRM features` is the discoverability fallback. It shows the whole product contract but respects permission-based access.
4. CRM feature CSS is route-owned. The ERP root layout must not globally load CRM feature styles.
5. `crm-ui-system.css` is the canonical final CRM visual/interaction layer and consumes the shared `--erp-*` design tokens.
6. Browser-native `alert`, `confirm`, and `prompt` are not permitted for CRM product workflows. Use the CRM command-dialog provider/shared dialog primitives.
7. No capability may disappear at smaller viewports. Responsive layouts may reflow, stack, scroll, move filters into drawers/sheets, or progressively disclose secondary information.
8. Keyboard focus, reduced-motion behavior and a 44px baseline touch target are release requirements.

## Navigation

- Home
- Customers: Leads, Accounts, Contacts
- Pipeline: Opportunities, Pipeline board, Forecast
- Work: My work, Tasks, Calls, Meetings, Follow-ups, Calendar, Activity timeline
- Engagement: Team inbox
- Insights: Reports
- Administration: Data management, All CRM features, CRM setup

CRM Setup owns lead management, pipeline governance, sales organization/coverage, and data/customization configuration so administrative resources remain discoverable without producing a flat sidebar.

## Responsive contract

The canonical CRM layer uses four content-driven ranges:

- `<480px`: narrow mobile; single-column task-first layouts and full-width controls.
- `480-767px`: mobile/wide-phone layouts.
- `768-1023px`: tablet/compact workspace layouts.
- `>=1024px`: desktop layouts; split panes and multi-column compositions may be used when content supports them.

Reusable components should prefer container-aware behavior when their available width matters more than the viewport.

## Canonical surface archetypes

The CRM routes compose a small set of interaction patterns rather than inventing per-screen behavior:

- CRM Home / operational dashboard
- Entity List / saved views / bulk actions / preview
- Record 360
- Pipeline board
- Work queue / agenda
- Team Inbox
- Calendar / meetings
- Reports / forecast
- Setup / rule configuration
- Data management / import-export / data quality

## Accessibility

Target WCAG 2.2 AA. Interactive CRM surfaces must remain usable with keyboard only, expose visible focus, avoid drag-only actions, preserve focus around dialogs/drawers, announce mutation status, avoid color-only meaning, respect reduced motion, and reflow without hiding functionality.

## Verification

Run:

```bash
corepack pnpm verify:crm:uiux
```

The static gate checks 30/30 feature mapping, route-owned CRM styling, required navigation/setup destinations, canonical responsive/focus/motion rules, and the absence of browser-native CRM dialogs. The broader `verify:crm` gate continues to cover CRM architecture, web/API tests, typechecking and linting when the repository is running on its declared Node 24 toolchain with dependencies installed.
