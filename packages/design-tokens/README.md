# @vercentlabs/design-tokens

Canonical source of truth for Vercentlabs visual tokens, shared by the web
app, the design system, and the mobile app's native theme. Replaces
`packages/shared-ui/tokens/theme.json` (moved here verbatim during the
clean-slate frontend rebuild — see `docs/frontend-rebuild/README.md`).

`tokens/theme.json` is consumed by `scripts/design/generate-theme.mjs`,
which generates:

- `apps/web/src/shared/design/tokens.css` (`--erp-*` CSS custom properties)
- `apps/mobile/src/shared/theme/tokens.ts` (native palette/spacing/type
  scale constants)

**Pending**: split `tokens/theme.json` into the typed module layout
described in the rebuild brief (`src/colors.ts`, `typography.ts`,
`spacing.ts`, `radius.ts`, `shadows.ts`, `motion.ts`, `density.ts`,
`z-index.ts`) and wire it directly into the Tailwind v4 `@theme` block in
`packages/design-system`, instead of generating CSS custom properties via
a separate build step. Tracked as a design-system foundation task.
