# ADR-002 — Frontend Design-System Rewrite (supersedes frontend rows of ADR-001)

Status: `APPROVED_FOR_IMPLEMENTATION`
Supersedes: `docs/01-standards/TECH_STACK_ADR.md` (web/shared-UI rows only — backend,
database, worker, mobile-runtime, permissions, workflows, reporting, documents,
localization and observability rows are unchanged and remain frozen) and the
"Design-system rule" section of `docs/01-standards/WEB_FRONTEND_ARCHITECTURE.md`.
Authorized by: explicit product-owner decision, 2026-09-14, recorded after the
implementing session surfaced the conflict between ADR-001's freeze and a
directive to perform a complete frontend rewrite, and asked the owner to choose
between (a) staying inside the frozen `@vercentlabs/shared-ui` + Experience
Kernel stack, (b) a full new stack, or (c) a narrow hybrid. The owner chose
(b), full new stack.

## Decision

Replace the ad hoc, three-generation CSS system (`globals.css` +
`navigation-v2.css` + `workspace-redesign-v3.css` + per-module
`*-extension.css` files, ~9,000 lines, with `--color-*`, `--v2-*` and
`--erp-*` tokens all live simultaneously) and the minimal `@vercentlabs/shared-ui`
package (3 helper components) with one owned design system built on:

| Layer | Adopted |
|---|---|
| Styling engine | Tailwind CSS v4 (`@tailwindcss/postcss`), CSS-first `@theme` config |
| Accessible primitives | Base UI (`@base-ui-components/react`) |
| Component ownership model | shadcn-style open-code — primitives copied into `packages/ui-web/src/primitives`, not consumed as an opaque npm component library |
| Icons | `lucide-react` |
| Forms | `@tanstack/react-form` + Zod 4 (already frozen/kept) |
| Data grid | `@tanstack/react-table` + `@tanstack/react-virtual` |
| Server-state fetching (client-side only, where genuinely needed) | `@tanstack/react-query` |
| Charts | Recharts v3 |
| Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` (every drag interaction must ship a non-drag command/menu alternative per `ACCESSIBILITY_STANDARD.md`) |
| Calendar | FullCalendar |
| Graph/lineage/workflow diagrams | React Flow |
| Rich text | Tiptap (headless core only) |
| Web offline storage | Dexie (IndexedDB) |
| Service worker / PWA | Serwist, only where a workflow's dossier requires offline capability (SP034) |
| Design-system documentation/contract | Storybook |
| E2E | Playwright (unchanged) |
| Accessibility testing | axe (`@axe-core/playwright`, `@axe-core/react` in Storybook) |

Gantt: DHTMLX Gantt requires a commercial license for production use outside
GPL terms this repository cannot accept for a closed-source product. Do not
introduce it without a signed commercial license recorded by the business
owner. Until then, build Projects/Manufacturing scheduling surfaces on
FullCalendar's resource-timeline view plus a thin `SchedulingAdapter`
interface (`packages/ui-web/src/archetypes/schedule/`) so a licensed Gantt
engine can be swapped in later without a second rewrite.

## Ownership structure

```
packages/
  design-tokens/     DTCG-compatible JSON token source + generators (web CSS, Tailwind theme, native)
  ui-web/             Vercentlabs-owned web component system (primitives, enterprise components, archetypes)
  ui-mobile/          (future) native component system sharing tokens/vocabulary with ui-web, not DOM code
  ux-contracts/       Shared TypeScript types/schemas for UX state (loading/empty/error/forbidden/stale/conflict/offline), permission-aware field/column contracts, archetype prop contracts
```

`packages/shared-ui` is deprecated in favor of `packages/design-tokens` +
`packages/ui-web`. It is not deleted in this pass (`apps/mobile` still
consumes `packages/shared-ui/tokens/theme.json`); it becomes a thin
re-export shim once `ui-mobile` exists, tracked in
`docs/ux/UI_REWRITE_TRACKER.md`.

## What stays frozen (ADR-001 rows NOT superseded)

Runtime, package manager, Next.js/React versions, database, `services/api`
domain architecture, `services/worker`, mobile runtime (Expo/React Native —
gains shared tokens/vocabulary only, no DOM-component reuse), permissions,
workflows, reporting-engine, document-engine, localization, observability,
containers, CI. This ADR is scoped to the **web presentation layer only**.
No backend/API contract, business rule, permission rule, tenant boundary, or
state-machine semantic changes are authorized by this ADR — see
`docs/01-standards/WEB_FRONTEND_ARCHITECTURE.md`'s "Business-authority
boundary" section, which remains in force unchanged.

## Anti-drift rule (carried forward from ADR-001, narrowed to this list)

Do not add a further competing design system, a second data-grid library, a
second form library, a second charting library, or a second drag-and-drop
library on top of this list. Extending this list again requires another ADR.

## Migration discipline

Full-codebase migration is tracked feature-by-feature in
`docs/ux/UI_REWRITE_TRACKER.md` and `docs/ux/UX_TRACEABILITY_REGISTER.csv`,
following the phased order in that tracker. Legacy CSS files are deleted
only after every selector they define has a migrated replacement in active
use — never left duplicated indefinitely per module.
