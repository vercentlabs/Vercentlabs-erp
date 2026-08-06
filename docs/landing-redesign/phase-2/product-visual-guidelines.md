# Product Visual Guidelines

Governs how real Vercentlabs product UI is captured, cropped, annotated, and shown on the marketing site — and what must never be fabricated (Evidence and Honesty Rules).

## Current state: zero approved screenshots

`packages/... lib/product/screenshots.ts`'s `APPROVED_SCREENSHOTS` array is empty. This is the honest, correct state for Phase 2 — no screenshots have been captured, reviewed, or approved yet. `ProductScreenshot` renders **nothing** on any indexable page until entries are added here with `approvedForMarketing: true`. The only place a placeholder is visible is `/design-system` (noindex, unlinked from public nav), and only because that route explicitly passes `allowPlaceholder`.

## Approval workflow (for Phase 3+)

1. Capture a real screenshot from `apps/web`, using a test/demo tenant with no real customer data — never a production tenant screenshot without explicit data-redaction review.
2. Crop to the meaningful region (a table, a panel, an approval flow) — not a full, cluttered browser window. No OS window chrome, no browser toolbar, no 3D tilt (Control Surface's `ProductFrame` supplies the plain frame; the screenshot itself should be a clean content crop).
3. Redact or replace any real names/emails/amounts that aren't already synthetic demo data.
4. Add a `ProductScreenshot` entry to `lib/product/screenshots.ts`: `id`, `src` (place the file under `public/product/`), `alt` (describes what the screen shows, not decorative), `width`/`height` (exact pixel dimensions — required to prevent layout shift), `module`, optional `workflow`, optional `caption`, and `approvedForMarketing: true` only once a human has actually reviewed it for the above.
5. Reference it by `id` from a `ProductScreenshot` component on a real page.

## Annotation rules

Use `ProductCallout` for numbered annotations — every callout must carry a real text label, never a bare numbered dot (colour/number alone is not an acceptable accessible signal, per WCAG 1.4.1). Callout numbering should match the left-to-right or top-to-bottom reading order of the workflow being illustrated.

## Caption rules

`ProductFrame`'s `caption` prop is a one-line, factual description of what the screen shows (e.g. "Purchase order matching, procurement workspace") — not marketing copy, not a claim. If a caption would need to assert a metric or outcome, that claim belongs in surrounding page copy (traceable to `docs/landing-redesign/phase-1/product-intelligence.md`), not baked into the image caption.

## Responsive behaviour

`ProductScreenshot` uses `next/image` with explicit `width`/`height` and a `sizes` attribute (`(min-width: 1024px) 800px, 100vw`) — never crop or hide meaningful screenshot detail on mobile; if a screenshot is too dense to be legible at mobile width, prefer a narrower, more focused crop over shrinking a wide one.

## Prohibited

- Fabricated UI (mockups presented as real product screens).
- Any screenshot containing a real customer's data.
- Fake performance numbers, fake user counts, or fake activity overlaid on a screenshot.
- Marking a screenshot `approvedForMarketing: true` without an actual human review step.

## Known limitations (flag for follow-up, not blockers for Phase 2)

- **No exported brand asset files exist.** The logo/wordmark used in `components/brand/logo.tsx` and `app/icon.svg` is a functional reconstruction of the product's CSS-drawn "V" mark (same letterform, flattened to remove the gradient per Control Surface), not a design-team-approved export. Replace the moment real brand files are provided — see `public/brand/README.md`.
- **No Apple touch icon / high-resolution PNG manifest icons.** Only an SVG icon exists (`app/icon.svg`, `public/icons/icon.svg`). Modern browsers and most PWA install flows accept SVG, but a dedicated PNG export would be more broadly compatible — deferred, not attempted with fabricated/low-fidelity raster output this phase.
- **No product screenshots exist at all** — this is the single biggest content gap standing between the current site and a persuasive Phase 3 homepage. Recommend prioritizing screenshot capture before or alongside Phase 3 implementation.
