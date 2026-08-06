# Visual Review Log

Three mandatory review cycles, per the governing brief — each against real screenshots of a booted production server, not source code alone.

## Cycle 1 — Structural review

**Method:** Built production (`next build`), booted the real server, captured screenshots at all required viewports plus book-demo/thank-you/design-system states, and inspected them directly.

**Defects found and fixed:**
1. **Thank-you page appeared completely blank.** Root cause: the visible confirmation content lived inside a Client Component gated behind a `Suspense` boundary required by `useSearchParams()`; Playwright's screenshot could fire before hydration resolved the boundary, capturing the `null` fallback. Fixed by rendering the confirmation heading/text server-side directly, reducing the client component to a logic-only, invisible-output component. Verified fixed via rebuild + rescreenshot.
2. **Empty hero and flagship-workflow columns.** Before any screenshot was approved, both sections rendered a two-column grid with one column completely blank — reproducing the "huge empty hero space" pattern Control Surface prohibits. Fixed with conditional single/two-column layout based on real screenshot availability.
3. **Missing space in book-demo copy** ("...balance sheet.Book a demo..."). Fixed defensively with an explicit template-literal string instead of relying on JSX text-node whitespace handling.

## Cycle 2 — Independent expert critique

Four specialized reviewer subagents examined real screenshots (not code) in sequence: UX/CRO, brand/design, SEO/AEO/GEO, then frontend-quality as the final technical pass.

### UX/CRO findings and resolution
- **Demo form over-collected required fields** (9 required vs. the spec's 4) — confirmed as a real regression against `docs/landing-redesign/phase-1/conversion-architecture.md`. Fixed by reverting to the originally-specified required set. See `decision-log.md` item 3.
- **320px header/wordmark overlap** — independently confirmed via a targeted debug screenshot. Root cause: `ButtonLink`'s base `inline-flex` class and a passed-in `hidden` override were equal-specificity, so which one won depended on Tailwind's compiled stylesheet order, not HTML class order. Fixed by moving the visibility toggle to a wrapper `<div>` with no competing `display` utility.
- **Missing CTAs** on the Connected Platform and Implementation sections — fixed by adding "See how the platform connects" and "Talk to an ERP Specialist" respectively.
- **Footer CTA styling** — restyled from a solid primary button to the outline/secondary variant, reserving the solid treatment for the hero and final-CTA's genuinely primary conversion moments.
- **Sticky mobile CTA bar** — added as a new component, visible only below `lg`.

### Brand/design findings and resolution
Reviewed against `docs/landing-redesign/phase-1/creative-direction.md` and the Phase 2 design-system spec. Confirmed strong: the module accent-color system (verbatim-sourced from the real product, WCAG-AA-verified), the module index / pipeline diagram (a literal, correct execution of "no card grids"), and the book-demo form's accessible error states. Five ranked defects:
1. **320px header overlap** (independently confirmed — see UX findings above, same root cause, same fix).
2. **Hero empty space** — same root cause and fix as Cycle 1 defect #2; the brand reviewer's independent confirmation strengthened the case that this was worth root-cause-fixing (conditional layout) rather than deprioritizing.
3. **Inconsistent numbered-step marker shapes** — the "Lead → Support" pipeline used filled rounded squares, the "Lead to cash" workflow used filled circles, and the "Getting live" rollout used outlined rounded squares — three different treatments of the same UI idea on the same page. Fixed by standardizing every numbered-sequence marker to the filled, module-colored rounded square.
4. **`ProductCallout` chips rendered as full pills** despite a coded 8px control radius — at the component's original small size, the radius was close enough to half the element's height to read as a stadium shape. Fixed by increasing horizontal/vertical padding so the fixed radius reads clearly as a rounded rectangle.
5. **Mid-page monotony** (six consecutive heading+list sections with no visual break) — noted as a legitimate, largely unavoidable consequence of not yet having screenshots for every section; deprioritized as a judgment call given the phase's scope and time budget, documented as a Phase 4 candidate rather than fixed this phase.

### SEO/AEO/GEO findings and resolution
- **CTA label inconsistency** — `packages/landing-content/src/navigation.js`'s `CTAS.primary.label` was the shorter "Book a Demo," inconsistent with the hero/final-CTA copy and `CLAUDE.md`'s stated conversion objective. Fixed.
- **Meta description length** trimmed to ~150 characters to survive real SERP truncation.
- **Sitemap `lastModified`** was using build-time `new Date()` instead of a stable, content-tied date. Fixed to read `HOMEPAGE_METADATA.lastReviewed`.
- **Missing `FAQPage` structured data** for the real buyer-questions section. Added, generated directly from the same content the visible accordion renders (see `decision-log.md` item 4).
- **Hero copy lacked explicit audience naming** — fixed by changing the hero eyebrow to name the ICP directly ("Connected ERP for manufacturers and distributors").

### Frontend-quality findings and resolution (final technical pass)
Twelve ranked findings — see `implementation-summary.md`'s defect list and `decision-log.md` items 6-9 for the full detail. Summary of what changed as a direct result:
- The analytics event type contract was silently non-functional (`ANALYTICS_EVENTS` typed as `string[]` collapsed the whole union to `string`) — fixed and proven with a positive control.
- A suspected phone/mobile data-loss bug was investigated, disproven against the real `services/api/src/crm.js` mapping and schema, and the speculative fix reverted — recorded as a caught misdiagnosis, not a real defect.
- No automated test covered the actual HMAC proxy contract (headers, signature correctness) — added, verified against an independent re-implementation of `apps/web`'s route-side verification logic.
- Multiple code comments cited `docs/landing-redesign/phase-3/*.md` files that didn't exist yet at review time — resolved by this documentation set now existing, with two additional Decision Log entries added specifically so two previously-uncovered citations (rate-limiting choice, no-zod choice) resolve to real content rather than being retroactively deleted.
- `FaqAccordion`'s comment was stale against the newly-added FAQPage JSON-LD — corrected.
- Demo form hardcoded an incomplete, hand-typed 6-of-12 module list instead of deriving from the canonical `LANDING_MODULES` catalog — fixed to derive from the real catalog (now shows all 12).
- A repeated inline "label + description" grid pattern across four homepage sections was flagged as a candidate for extraction into a shared component — not fixed this phase (a Phase 4 candidate; see `phase-4-brief.md`), since it's a maintainability suggestion, not a correctness defect.
- Mobile nav dialog had no Tab/Shift+Tab focus trap — fixed.
- A redundant nested `role="alert"` in the demo form's error summary — fixed.
- Unused `.webp` screenshot siblings and the excluded opportunity-detail screenshot's files were still shipping in `public/product/` — removed (~896KB).
- A stale comment on `APP_URL` (described as client-only when `crm-capture.ts` also uses it server-side) — corrected.
- Sticky mobile CTA bar's safe-area padding wasn't matched by its page spacer, and it used a plain `<a>` instead of `next/link` — both fixed.

## Cycle 3 — Final polish and regression

After applying every fix above: rebuilt production, restarted the server, and re-ran the full 54-test Playwright suite (functional + visual capture) — **all 54 passed**, confirming no regression was introduced by the fix batch. Directly re-inspected the specific screenshots tied to each fix:
- 320px header: clean wordmark, no overlap, sticky mobile CTA bar renders correctly beneath it.
- Demo form: only 4 fields (+ consent) show a required asterisk; the rest correctly show "Optional."
- Footer CTA: renders as the outline/secondary variant.
- Flagship workflow: renders its full two-column layout with real product screenshots and standardized square numbered markers.
- Implementation section: "Talk to an ERP Specialist" CTA visible.
- `/design-system`'s `ProductCallout` chips: render as clear rounded rectangles, not pills.
- Demo form's module checkboxes: all 12 real modules render (verified via a direct DOM query, not just a screenshot).

One transient flake was observed and resolved during this process: a single Playwright worker's w1440-viewport screenshot timed out on one run immediately after a fresh server restart (many parallel workers hitting a just-booted server). A re-run of the same test in isolation passed cleanly, and the full 54-test suite subsequently passed twice in a row — consistent with Phase 2's documented experience of the same class of transient issue, not a real defect.
