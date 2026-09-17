# @vercentlabs/design-tokens

Canonical source of truth for Vercentlabs visual tokens, shared by
`packages/design-system`, `apps/web`, and (via the generated native
adapter) `apps/mobile`.

## Structure

```
tokens/theme.json      Raw token values (the only file to hand-edit for a
                        color/spacing/etc. change)
src/theme.ts            Typed loader for theme.json
src/primitives/         Thin typed wrappers over theme.json's raw sections
                         (colors, spacing, radius, typography, shadows,
                         motion, zIndex) — values only, no meaning attached
src/semantic/           The actual design decisions: which primitive means
                         "primary surface", "danger action", "compact
                         density", etc. Components should import from here,
                         not from primitives directly.
src/themes/light.ts      Assembles the semantic tokens into one theme object.
                         The only theme today — dark mode is out of scope
                         until it gets its own design pass.
src/index.ts             Public package API.
```

## Consumers

- `scripts/design/generate-tailwind-theme.mjs` reads `tokens/theme.json`
  directly (plain Node script, not a package consumer) and generates
  `apps/web/src/app/tokens.css`, a Tailwind v4 `@theme` block.
- `scripts/design/generate-theme.mjs` reads `tokens/theme.json` and
  generates `apps/mobile/src/shared/theme/tokens.ts`, the native adapter.
- `packages/design-system` and `apps/web` component code imports the typed
  `primitives`/`semantic`/`lightTheme` exports from `src/index.ts` directly
  (via the workspace dependency — Next.js transpiles the `.ts` source, no
  build step needed).

Run `pnpm design:generate` at the repo root after editing `theme.json` to
regenerate both downstream adapters, or `pnpm design:check` to verify they
match without writing.

## Why a value can look "off" from a round number

Some values (e.g. `control.standard = 42`) are the original approved
Vercentlabs brand values, not derived from a formula — see the comments in
`src/semantic/controlTokens.ts`. Don't retune them to match a stated
guideline range without an explicit design decision; the range is
guidance, the token is the approved value.
