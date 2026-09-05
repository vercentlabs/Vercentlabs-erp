# Web Experience Kernel design boundary

This directory is the canonical design-token and reusable web-experience boundary.

## Rules

- New shared Experience Kernel UI belongs under `apps/web/src/shared/design`.
- New component styling uses `*.module.css`; do not add another application-global stylesheet.
- New component CSS consumes `--erp-*` semantic tokens instead of hard-coded color literals.
- New media queries use the canonical breakpoint forms exported by `breakpoints.ts`.
- `:root` ownership belongs to `tokens.css`. Existing `:root` blocks in legacy application CSS are grandfathered debt and must only decrease.
- Module-specific workflows remain domain-owned. Shared visual primitives do not authorize generic CRUD.
- Existing application CSS remains a compatibility layer and is migrated incrementally.

Run `corepack pnpm verify:experience` before integrating web UI changes.
