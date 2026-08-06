# Design System Specification — Control Surface

Implements the creative direction selected in `docs/landing-redesign/phase-1/creative-direction.md`. Every token value here is defined once in `packages/landing-content/src/tokens.js` and copied verbatim into `apps/landing/app/globals.css`'s Tailwind v4 `@theme` block — `apps/landing/tests/tokens-sync.test.mjs` fails the test suite if the two ever drift.

## Design principles

Structured, operational, product-led. Real screenshots (not illustration) are the primary content. Flat, single non-gradient indigo accent. Tight radii, near-flat elevation, hairline borders, no glass/blur, disciplined motion.

## Colour

| Token | Value | Use |
|---|---|---|
| `--color-canvas` | `#f9fafb` | Page background |
| `--color-surface` | `#ffffff` | Card/panel background |
| `--color-ink` | `#101828` | Primary text |
| `--color-muted-ink` | `#667085` | Secondary/muted text |
| `--color-border` | `#e4e7ec` | Default hairline border |
| `--color-brand` | `#4338ca` | Primary accent (sourced from the real product's brand-mark gradient darker stop) |
| `--color-brand-strong` | `#3730a3` | Hover/emphasis accent |
| `--color-brand-soft` | `#eef2ff` | Accent-tinted background |
| `--color-signal-cyan` | `#0891b2` | Rare second signal ("live/connected" moments only) |
| `--color-success` / `--color-warning` / `--color-error` | `#15803d` / `#b45309` / `#b91c1c` | State colours |

Full semantic layer (background/text/border/state/product-presentation categories) is in `SEMANTIC_BACKGROUND`, `SEMANTIC_TEXT`, `SEMANTIC_BORDER`, `SEMANTIC_STATE`, `SEMANTIC_PRODUCT` in `packages/landing-content/src/tokens.js` — every value there resolves to one of the base tokens above or a documented, tested extension colour (see that file's integrity tests). Components consume the semantic layer (`text-(--color-text-primary)`), never raw hex values.

**Module accent colours**: 4 of 12 (CRM, Sales, Procurement, Accounting) are reused verbatim from the real product's `apps/web/src/app/enterprise-modules.css`. The other 8 are landing-original colours in the same palette family, explicitly flagged `sourcedFromProduct: false` in `packages/landing-content/src/modules.js` — never described as "the product's colours" in copy.

**Critical syntax note** (a real bug found and fixed this phase): Tailwind v4 requires **parentheses** for CSS-variable arbitrary values — `bg-(--color-bg-elevated)`, not `bg-[--color-bg-elevated]`. The square-bracket form silently compiles to invalid CSS (`background-color: --color-bg-elevated`, missing `var()`), which browsers discard, leaving the utility with no effect. This is enforced only by vigilance right now — see `component-inventory.md`'s note on this and consider an eslint/stylelint rule in a later phase.

## Typography

Single neutral system-first font stack (`Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` — no new webfont dependency; the product has never shipped one, see Phase 1 findings). Headline tracking `-0.045em`. Body line-height `1.65`. Tabular numerals (`.tabular-data` utility class) for all data values.

Roles (implemented in `components/ui/text.tsx`): `display`, `h1`-`h4` (via `Heading`), `lead`, `bodyLarge`, `body`, `bodySmall`, `label`, `eyebrow`, `navigation`, `dataValue`, `dataLabel`, `caption` (via `Text`), plus `InlineCode` and `Prose` for long-form content.

## Layout and spacing

- Max content width: `1600px` (`CONTAINER_TOKENS.maxWidth`), matching the product's own `--content-max` range.
- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 48, 64` (`SPACING_SCALE`).
- Breakpoints: `sm 480 / md 768 / lg 1024 / xl 1440` — the `lg` breakpoint is where desktop nav replaces mobile nav.
- Radius: `control 8px / card 12px / panel 16px` — the product's tighter workbench scale, deliberately less rounded than its softer marketing-adjacent surfaces.
- Shadow: `subtle` and `panel` tiers only — no glow, no heavy drop shadow.

## Motion

`hoverLiftPx: 2`, `durationFast: 120ms`, `durationBase: 200ms`, `easing: cubic-bezier(0.4, 0, 0.2, 1)`. All transitions respect `prefers-reduced-motion` via a global rule in `globals.css` that collapses animation/transition duration to near-zero. Motion is informational (hover lift, menu open/close, chevron rotation) — nothing loops, nothing marquees, nothing animates on page load beyond what's directly triggered by user interaction.

## Component rules (correct vs. incorrect use)

- **Cards are not a default section wrapper.** Use `Card` only for genuinely discrete, browsable items (a module tile, a workflow step). A plain `Section` + `Stack` is correct for ordinary content — Control Surface explicitly rejects "excessive card grids."
- **No pill shapes by default.** `Tag`/`Badge`/`ModuleTag` are rectangular (`--radius-control`), a deliberate correction of the real product's own pill-badge overuse (found during the Phase 1 design audit).
- **No gradients, ever** — not on buttons, not on the brand mark, not on section backgrounds. The one gradient in the entire real product (the brand-mark chip) is intentionally not reproduced on the marketing site.
- **No `backdrop-filter` (blur/glass) on any element.** Beyond the "no glass" creative-direction rule, this phase found a `backdrop-filter` on an ancestor breaks `position: fixed` descendants (see `decision-log.md` item 4) — a second, independent reason to avoid it.
- **`ProductFrame`/`ProductScreenshot` never fabricate a screenshot.** If no approved image exists for an id, the component renders nothing on public pages; the honest placeholder only appears on `/design-system`.

## Accessibility requirements baked into the tokens

- Every text/background semantic pairing must be verified WCAG AA before shipping a new one — the 8 landing-original module accent colours were chosen from Tailwind's 700-shade family specifically for AA-capable contrast on white, but have not yet been machine-verified (see `accessibility-validation.md`, "Remaining risks").
- Focus rings use `--color-border-focus` (`#4338ca`) at 2px with 2px offset, applied globally via `:focus-visible` in `globals.css`, not per-component.
