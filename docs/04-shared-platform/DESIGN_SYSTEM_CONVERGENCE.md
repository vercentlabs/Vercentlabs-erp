# Vercentlabs ERP Design System Convergence

Status: `FOUNDATION_GUARDRAIL_ACTIVE`

This plan operationalizes the frozen Experience Kernel without creating a new
canonical implementation wave. Canonical wave authority remains `T00`, `T01`,
`W01`–`W15`.

## Problem

The authenticated web application currently contains several generations of
global styling and module-local interaction patterns. The reviewed
2026-09-05 snapshot contains:

- 23 application-global CSS files under `apps/web/src/app`;
- 20 legacy global CSS imports from the root layout;
- 6 legacy `:root` blocks;
- 37 normalized legacy media-query forms across 111 file/query pairs;
- 1,255 hard-coded color literals in legacy application CSS;
- 39 raw `<table>` occurrences across 30 TSX files.

These numbers are debt baselines, not quality targets.

## Target architecture

1. `apps/web/src/shared/design/tokens.css` owns canonical semantic web tokens.
2. Shared Experience Kernel React primitives live under
   `apps/web/src/shared/design`.
3. New component styling uses CSS Modules and canonical tokens.
4. Module-specific workflows remain domain-owned and may specialize layout,
   but must not create another incompatible design system.
5. Legacy application-global CSS is a compatibility layer that only shrinks.
6. Responsive behavior converges on compact, mobile, tablet, desktop and wide
   breakpoints plus reduced-motion and print variants.
7. Visual regression, responsive and accessibility evidence become required
   as the shared primitives and page archetypes are implemented.

## Convergence goes

### Go 1 — foundation and guardrails

- canonical tokens and breakpoints;
- reviewed experience-debt baseline;
- `verify:experience` fail-closed validator;
- release-gate integration;
- no intentional business-flow or visual redesign.

### Go 2 — shared Experience Kernel primitives

Implement the canonical page/record headers, surfaces, action bars, metrics,
data grid, filters, saved views, structured forms, status and feedback states,
dialogs/drawers/tabs and an internal design-system gallery.

### Go 3 — shell and top-level convergence

Migrate the authenticated shell, shared platform/settings surfaces and module
overview pages onto the shared primitives while deleting replaced legacy CSS.

### Go 4 — page archetypes and visual gates

Standardize list/work-queue, Record 360, transaction document, board and
operations-workspace archetypes; add authenticated ERP visual regression,
responsive and accessibility gates.

## Debt policy

`verify:experience` enforces **debt must not increase**.

Grandfathered debt may be removed or reduced. New global stylesheets, new
noncanonical `:root` ownership, new hard-coded colors in CSS Modules, new
noncanonical media queries and new raw tables are rejected.

The baseline may only be changed as part of an explicitly reviewed convergence
change. It must never be regenerated automatically from a failing tree.

## Completion

Design convergence is not complete because this guardrail exists. It is
complete only after the Go 2–Go 4 primitives, migrations and browser evidence
are implemented and the legacy debt reaches the accepted launch threshold.
