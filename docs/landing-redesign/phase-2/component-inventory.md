# Component Inventory

Every reusable component shipped in Phase 2, what it's for, and its restrictions. Rendered live (every variant, every state) at `/design-system`.

**Testing note**: components containing JSX (`.tsx`) cannot be unit-tested by this repo's `node --test` convention without a build step (Node's native TypeScript execution strips types but does not transform JSX). Data-layer and plain-`.ts` logic (`lib/*.ts`, `packages/landing-content`) is unit-tested directly; component correctness is instead verified through the Playwright suite (`tests/e2e/production-smoke.spec.ts`) against the real production build, plus static-source checks (`tests/content-integrity.test.mjs`) for things like banned placeholder links that don't require rendering.

## Layout (`components/layout/container.tsx`)

| Component | Purpose | Responsive behaviour | Restrictions |
|---|---|---|---|
| `PageShell` | Root flex column wrapper | N/A | One per page (root layout) |
| `Container` | Standard content width (1600px max) | Gutters shrink at `sm`/`lg` | Default width container for all sections |
| `NarrowContainer` | 760px reading width | — | Long-form copy only (module/workflow body text) |
| `Section` | Full-bleed band with tone (`page`/`subtle`/`inverse`/`elevated`) | Vertical padding scales at `sm`/`lg` | — |
| `SectionHeader` | Eyebrow + title + description | Centers optionally | — |
| `Stack` / `Inline` / `Cluster` | Vertical / wrapping-horizontal / tight-horizontal flex primitives | Gap scale `0-8` | — |
| `Grid` | 2/3/4/12-column responsive grid | Collapses to 1 col below `sm` | — |
| `SplitLayout` | Two-column (even or primary-wide) | Stacks below `lg` | Hero-style layouts |
| `SidebarLayout` | Content + 280px rail | Stacks below `lg` | Resource/article pages (Phase 6) |
| `Bleed` | Escapes container width | — | Full-width screenshots/diagrams only |
| `Divider` | Hairline rule | — | — |

## Typography (`components/ui/text.tsx`)

`Heading` (levels `display`/`h1`-`h4`, `as` prop to override tag without changing style) and `Text` (variants `lead`/`bodyLarge`/`body`/`bodySmall`/`label`/`eyebrow`/`navigation`/`dataValue`/`dataLabel`/`caption`), plus `InlineCode` and `Prose` (long-form copy with consistent nested-element spacing). Restriction: exactly one `display`/`h1` per page (enforced by convention, not code — a future phase could add an eslint rule).

## Actions (`components/ui/button.tsx`)

| Component | Variants | Accessibility | Restrictions |
|---|---|---|---|
| `Button` | `primary`/`secondary`/`tertiary`/`inverse`, sizes `md`/`sm`, `loading` | Real `<button>`, `aria-busy` when loading, focus-visible ring | Use for actions (form submit, client handlers) — never for navigation |
| `ButtonLink` | Same variants, no `loading` (links have no loading state) | Real `<Link>`/`<a>`, external links get `target=_blank rel=noopener noreferrer` | `prefetch` defaults to **false** (see below) — pass `prefetch={true}` only once a destination is a real, built page |
| `IconButton` | — | Requires `label` prop (renders as `aria-label`) | Icon-only actions (e.g. mobile nav close button) |

**Why `ButtonLink` defaults `prefetch` to false**: a real bug this phase (see `decision-log.md`) — Next.js's default `Link` prefetching fires background requests to linked routes, which correctly 404 for the many IA-planned-but-not-yet-built pages this phase's navigation points to. Defaulting off avoids console-error noise; flip it on per-link once that destination is real.

## Structure (`components/ui/card.tsx`, `components/ui/tag.tsx`)

`Card` (discrete/browsable items only, not a default wrapper — accepts `accentColor` for a top border), `BorderedPanel` (no shadow, structural grouping), `InformationBand` (full-width row, the Control Surface alternative to a card grid), `FeatureList` / `Checklist` (bulleted lists with check/dot markers), `Metric` (label + tabular-numeral value — real evidence-backed numbers only), `Tag`/`Badge` (rectangular, toned `neutral`/`brand`/`success`/`warning`/`error`/`info`), `ModuleTag` (colour swatch + label, used for the module accent legend).

## Forms (`components/forms/field.tsx`, `components/forms/inputs.tsx`)

`FieldWrapper` (wires `label`/`description`/`error` into the correct `aria-describedby` chain — the single accessibility-critical primitive in this set), `FormAlert` (form-level status, not per-field), `Input`/`Textarea`/`Select`/`Checkbox`/`RadioGroup` (native elements, `aria-invalid` support, disabled/placeholder states). All states are shown on `/design-system` including the error and disabled variants. Restriction: no page in this phase submits a real form — these are primitives for Phase 3's demo-request form to compose, not a finished flow.

## Product presentation (`components/product/product-frame.tsx`)

`ProductFrame` (thin plain-chrome frame — deliberately **not** a fake browser/OS window; Control Surface rejects skeuomorphic dashboard illustrations), `ProductScreenshot` (looks up a typed manifest in `lib/product/screenshots.ts`; renders nothing on public pages if no screenshot is approved, an honest placeholder only when `allowPlaceholder` is explicitly passed — which only `/design-system` does), `ProductCallout` (numbered marker with a mandatory text label — never colour/number alone), `WorkflowConnector` (horizontal module-coloured pipeline for cross-module workflow storytelling).

**Restriction — do not add a screenshot casually**: adding an entry to `APPROVED_SCREENSHOTS` in `lib/product/screenshots.ts` is a marketing-content decision (is this screenshot real, current, and safe to show publicly?), not a routine code change — see `product-visual-guidelines.md`.

## Navigation (`components/navigation/*`, `components/brand/logo.tsx`)

| Component | Purpose | Accessibility | Notes |
|---|---|---|---|
| `Logo` / `LogoMark` | Brand mark + wordmark, links home | `aria-label` on the link | Placeholder mark — see `product-visual-guidelines.md` |
| `NavMenu` | Disclosure primitive for header dropdowns | Plain button + labelled `role="region"` (not ARIA `menu`/`menuitem` — a deliberate choice, see code comment), Escape closes + returns focus, click-outside closes, closes on route change (via render-time state adjustment, not an effect, avoiding a React `set-state-in-effect` cascading-render warning) | Panel is centered under its trigger (`left-1/2 -translate-x-1/2`), not left-anchored — a real overflow bug this phase (see `decision-log.md`) |
| `ModuleMegaMenuContent` | The 5-group, 12-module mega menu body | Real links with module description text, colour dot is decorative (`aria-hidden`) | Never a flat 12-item list, per the brief |
| `Header` | Sticky header, desktop nav, mobile trigger | Solid background, **no `backdrop-filter`** (see below) | — |
| `MobileNav` | Full-screen dialog, two-level accordion | `role="dialog"` `aria-modal`, focus moves in on open and restores on close, Escape closes, background scroll locked, **portalled to `document.body`** | Portal + no-backdrop-filter are both fixes for the same real bug — see `decision-log.md` item 3 |
| `Footer` | Product/Modules/Industries/Company/Legal links, brand statement, CTA | Real internal links only — no `#` placeholders, no invented social/certification badges (enforced by `tests/content-integrity.test.mjs`) | — |
| `Breadcrumbs` | Ordered trail + `BreadcrumbList` JSON-LD | `aria-current="page"` on the last item, `nav aria-label="Breadcrumb"` | Never rendered on the homepage |

**Why `Header` has no `backdrop-filter`**: beyond the Control Surface "no glass" rule, a `backdrop-filter` on an ancestor creates a new CSS containing block for `position: fixed` descendants — this silently broke `MobileNav`'s full-viewport positioning (it collapsed to the header's own 64px height). Documented so a future "let's add a subtle blur to the sticky header" change doesn't reintroduce this bug; the `MobileNav` portal is a second, independent safeguard.

## Brand assets (`public/brand/`, `app/icon.svg`)

No exported brand asset files exist in the repository (the product's mark is drawn directly in CSS, never shipped as a file — see Phase 1 findings). `Logo`/`LogoMark` and `app/icon.svg`/`public/icons/icon.svg` reproduce the same "V" letterform flatly (no gradient), without altering proportions or inventing a new symbol. This is a functional placeholder, not a final brand-approved asset — see `product-visual-guidelines.md`, "Known limitations."
