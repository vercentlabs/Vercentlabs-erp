# Experience Kernel Component Contract

Status: `IMPLEMENTED_FOUNDATION`
Owner: Shared Platform / Experience Kernel
Canonical wave authority: `T01`; convergence execution continues as a cross-cutting AWP before W01 business expansion.

## Purpose

These components are the governed interaction primitives for new authenticated ERP web surfaces. They standardize visual language and accessibility without turning domain workflows into generic CRUD.

## Canonical primitives

| Primitive | Intended use |
|---|---|
| `PageHeader` | Page identity, context and page-level actions |
| `RecordHeader` | Business-record identity, status, metadata and actions |
| `SectionHeader` | Consistent subsection hierarchy and actions |
| `Surface` | Governed content container and elevation |
| `ActionButton` / `ActionLink` | Primary, secondary, quiet and destructive actions |
| `StatusBadge` | Compact lifecycle/status semantics |
| `MetricCard` | Small factual KPI/summary surface; never fabricated data |
| `StatePanel` family | Empty, error, permission, conflict and loading states |
| `FilterBar` | Search/filter/view controls and result context |
| `BulkActionBar` | Explicit selected-record actions |
| `FormField` / `FormSection` / `FormActions` | Consistent labels, native controls, validation/help text, form grouping and action placement |
| `Tabs` | Link-based record/workspace sections |
| `EnterpriseDataGrid` | Canonical table ownership with accessible semantics and optional mobile-card rendering |

## Hard rules

1. New module pages consume these primitives when the interaction matches their purpose.
2. Module-specific workflow UI may specialize beyond them, but must continue to use canonical tokens and responsive/accessibility rules.
3. `EnterpriseDataGrid` is the only new shared component allowed to own raw `<table>` markup. Consumer pages compose columns and cells rather than creating new tables.
4. Dense grids should provide `renderMobileCard` for critical mobile workflows; horizontal scrolling is a fallback, not the default mobile product strategy.
5. All component styles live in `experience-kernel.module.css` and consume `--erp-*` tokens.
6. Component focus, error, permission, loading and conflict behavior must remain visible and keyboard-operable.
7. No component may contain business-module authority, database access, tenant logic or permissions policy. Those remain with core/module/orchestration layers.

## Migration policy

Legacy global CSS and legacy page markup are compatibility debt. Their baseline is a ceiling. Migration proceeds route-by-route in later convergence packages and module waves; a route is not considered UX-converged merely because the shared primitives exist.

## Verification

Run:

```bash
corepack pnpm verify:experience
corepack pnpm test:web
corepack pnpm typecheck:web
corepack pnpm lint:web
```

Full integration still requires `corepack pnpm release:verify`.
