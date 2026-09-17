# ADR-003 — Accessible Primitive Layer Correction (supersedes two rows of ADR-002)

Status: `APPROVED_FOR_IMPLEMENTATION`
Supersedes: `docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md`'s
`Accessible primitives` row, `Component ownership model` row, and the
`packages/ui-web` path in its "Ownership structure" tree, and the
drag-and-drop row's default. Everything else in ADR-002 (Tailwind CSS v4,
TanStack Form/Query/Table/Virtual, Recharts, FullCalendar, React Flow,
Tiptap, Dexie, Serwist, Storybook, Playwright, axe, the Gantt/DHTMLX
carve-out, the anti-drift rule, the migration discipline) is unchanged and
remains in force.

Authorized by: explicit product-owner decision, 2026-09-14, given directly
in the rebuild instruction that continued this rewrite after ADR-002 was
recorded. The owner's rebuild brief explicitly named Base UI as
disqualified ("Do NOT use Base UI in the new frontend") and named React
Aria Components as the required accessible-primitive foundation, with
CVA and `tailwind-merge` added for variant/class composition. This was
confirmed a second time when the implementing session found that real,
tested Base UI work already existed (`packages/ui-web`, a working
`leads-next` CRM golden reference with passing E2E) and asked explicitly
whether to keep it or discard it for React Aria; the owner chose to
discard it and follow the React Aria mandate.

## Decision

| Layer | ADR-002 said | ADR-003 says |
|---|---|---|
| Accessible primitives | Base UI (`@base-ui-components/react`) | **React Aria Components** (`react-aria-components`) |
| Component ownership model | shadcn-style open-code, copied into `packages/ui-web/src/primitives` | Same open-code model (components are owned, not consumed as an opaque library), copied into **`packages/design-system/src`** — package renamed from `ui-web` to `design-system` to match the rebuild's canonical naming |
| Variant/class composition | not specified | `class-variance-authority` (CVA) for variant definitions, `tailwind-merge` for safe class merging |
| Drag-and-drop | `@dnd-kit/core` + `@dnd-kit/sortable` as the default | **React Aria's accessible drag-and-drop patterns are the default.** `@dnd-kit` is used only where React Aria cannot satisfy a specialist requirement (e.g. certain freeform canvas/board interactions). Every critical drag interaction must ship a non-drag alternative regardless of which library implements it — `ACCESSIBILITY_STANDARD.md` is unchanged. |

Rationale: React Aria Components provides the deepest coverage in this
repo's actual interaction surface — accessible ComboBox, ARIA-compliant
grid/table semantics, calendar/date-field accessibility, and collection/
selection behavior needed across CRM, Sales, Procurement and the
EnterpriseDataGrid — without the visual opinions of a Spectrum-derived
system; Vercentlabs still owns 100% of the visual layer via
`packages/design-tokens` and Tailwind v4.

## Ownership structure (supersedes ADR-002's tree for these two rows)

```
packages/
  design-tokens/     DTCG-compatible-in-spirit JSON token source + generators (web Tailwind theme, native)
  design-system/     Vercentlabs-owned web component system (primitives, enterprise components, archetypes) — React Aria Components + CVA + tailwind-merge
  ui-mobile/          (future) native component system sharing tokens/vocabulary with design-system, not DOM code
  ux-contracts/       Shared TypeScript types/schemas for UX state (loading/empty/error/forbidden/stale/conflict/offline), permission-aware field/column contracts, archetype prop contracts
```

`packages/shared-ui` was deleted outright (not kept as a shim) as part of
this rewrite; its real token values were migrated verbatim into
`packages/design-tokens/tokens/theme.json` first and mobile's generated
native theme output was verified byte-identical before deletion. See
`docs/frontend-rebuild/README.md`.

## What stays frozen

Everything ADR-002 froze remains frozen. This ADR narrows scope further:
it touches only the accessible-primitive library, the design-system
package name, and the DnD default. No backend/API contract, business
rule, permission rule, tenant boundary, or state-machine semantic change
is authorized by this ADR either.

## Anti-drift rule

Unchanged from ADR-002: do not add a further competing design system, a
second accessible-primitives library (no Radix/shadcn-on-Radix, no
Headless UI, no Ark UI, etc.), a second data-grid library, a second form
library, a second charting library, or a second drag-and-drop default on
top of this list. `@dnd-kit` remains available only for the narrow
specialist-requirement carve-out above, not as a general alternative.
Extending this list again requires another ADR.
