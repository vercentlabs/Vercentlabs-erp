# Phase 2 Decision Log

## 1. Operating model: single implementer instead of parallel subagents

**Decision:** Implemented Phase 2 directly rather than dispatching four parallel subagents (Design-System Engineer, Navigation Engineer, Frontend/Deployment Engineer, Accessibility Reviewer) as literally described in the brief.
**Evidence:** Phase 1's research workstreams (product intelligence, frontend architecture audit, brand/design audit) were genuinely independent, read-only investigations well-suited to parallel background agents. Phase 2 is the opposite: a single new codebase where the design tokens, components, navigation, and production config are all tightly coupled and load-bearing for each other (e.g. the token syntax bug affected every component simultaneously; the mega-menu fix depended on understanding the header's CSS).
**Alternatives considered:** Spawn 4 parallel agents against the same fresh `apps/landing` tree.
**Reason selected:** Parallel agents editing the same small set of interdependent files (`globals.css`, shared layout primitives, the header/mobile-nav pair) risk conflicting edits and — critically — would have made the actual defect-finding process in this phase (build → boot → screenshot → diagnose → fix → rebuild, repeated 4 times) much harder to execute coherently, since each bug's root cause spanned "design system" and "navigation" and "frontend/deployment" categories simultaneously (e.g. the `backdrop-filter` bug was simultaneously a design-direction violation, a navigation-component bug, and a CSS-architecture issue).
**Risks:** Slower wall-clock time than true parallelism for independent chunks; less "second opinion" diversity than genuinely separate reviewer perspectives.
**Mitigation:** The five Phase-1-established reviewer subagents (`.claude/agents/*.md`) remain available and were effectively "worn" sequentially during self-review (checking against each one's stated criteria — design-system compliance, navigation a11y, frontend build health) before considering the phase done. A future phase with more independent, less-coupled work (e.g. Phase 4's many module pages) is a better fit for genuine parallel dispatch.

## 2. Styling stack: Tailwind v4 (CSS-first `@theme`)

**Decision:** `apps/landing` uses Tailwind CSS v4 with a CSS-first `@theme` block, not `apps/web`'s hand-rolled CSS custom-properties approach.
**Evidence:** `phase-2-brief.md` (Phase 1's own output) flagged this as an explicit decision point for Phase 2, recommending Tailwind for build velocity across ~40 planned pages; Tailwind v4 was already resolved in the workspace lockfile.
**Alternatives considered:** Mirror `apps/web`'s hand-rolled CSS exactly (higher consistency with the existing app, slower to build many pages); a CSS-in-JS solution (rejected — not established anywhere in this monorepo, adds a runtime dependency the brief's performance constraints discourage).
**Reason selected:** Velocity for Phases 3-6's large page count, while still expressing every visual decision through the same semantic token layer (`packages/landing-content`) so the "look" stays governed centrally regardless of the styling mechanism underneath.
**Risks:** A real, serious risk materialized — Tailwind v4's CSS-variable arbitrary-value syntax (`bg-(--token)` vs. the `bg-[--token]` this session initially used) is a footgun that silently produces invalid, no-op CSS with no build error. See item 4.
**Mitigation:** Fixed globally this phase (231 occurrences); `tests/tokens-sync.test.mjs` now guards the token *values* stay in sync, though it does not (yet) guard the *syntax* is correct — a stylelint rule or a grep-based CI check for the `[--` anti-pattern is a worthwhile Phase 3 addition.

## 3. Palette reconciliation: kept Phase 1's evidence-grounded tokens over this prompt's illustrative starter values

**Decision:** Used `packages/landing-content`'s existing tokens (brand indigo `#4338ca`, cool off-white canvas `#f9fafb`) rather than the alternate palette this prompt's brief text suggested inline (`--paper: #f6f3ec`, `--brand-indigo: #2454d3`, plus new `operational-teal`/`signal-yellow` accents).
**Evidence:** Workstream E of this prompt explicitly says to use `packages/landing-content` as the source of truth for "design tokens where already provided." Phase 1's indigo value was specifically sourced from the real product's brand-mark gradient (`apps/web/src/app/globals.css`); the prompt's alternate values weren't grounded in any repository evidence.
**Alternatives considered:** Adopt the prompt's literal CSS snippet as a hard override.
**Reason selected:** The brief's own instruction ("do not reopen the creative-direction selection unless implementation reveals a serious accessibility or technical blocker") combined with the more specific "use already-provided tokens" instruction outweighs an inline illustrative snippet that wasn't written against the actual repository state.
**Risks:** A reviewer expecting the literal suggested hex values might read this as a deviation.
**Mitigation:** Documented explicitly here and in `design-system-specification.md`; the semantic *category* structure the prompt asked for (backgrounds/text/borders/states/product-presentation) was still built in full, just with the evidence-grounded values.

## 4. Four real defects found and fixed (full detail)

Each was found by actually building and running the app, not by code review — see `implementation-summary.md` for the summary and `responsive-validation.md`/`accessibility-validation.md` for the validation runs that caught them.

### 4a. CSP blocked Next.js's own inline scripts
**Decision:** `script-src` includes `'unsafe-inline'` in every environment, matching `apps/web`'s already-proven CSP.
**Evidence:** First Playwright run against the real production build showed 16 CSP violation console errors, all "Executing inline script violates... script-src 'self'" — Next.js's hydration bootstrap scripts are inline by default.
**Alternatives considered:** A nonce-based CSP (stricter, no `unsafe-inline`) via middleware minting a per-request nonce.
**Reason selected:** Nonce middleware is a real engineering task (request-scoped nonce generation, propagation into every emitted `<script>` tag) disproportionate to this phase's scope; `apps/web` already ships `unsafe-inline` in production today, so this doesn't regress the monorepo's overall security posture.
**Risks:** `unsafe-inline` is a real, if industry-standard-for-Next.js, XSS-defense-in-depth reduction.
**Mitigation:** Flagged explicitly in `production-deployment.md` and `phase-3-brief.md` as a candidate for a nonce-based CSP once a phase has budget for the middleware work.

### 4b. Link prefetching 404s against not-yet-built routes
**Decision:** `ButtonLink` defaults `prefetch={false}`; every `next/link` `Link` in nav/footer components explicitly sets `prefetch={false}`.
**Evidence:** Second Playwright run showed 2-4 "Failed to load resource: 404" console errors on homepage load — traced to Next.js's automatic RSC prefetch requests against `/about`, `/pricing`, `/modules/accounting`, etc., none of which exist yet (correctly, per this phase's scope).
**Alternatives considered:** Weaken the test's "no console errors" assertion to tolerate expected prefetch 404s; build stub pages for every linked route to make prefetch succeed.
**Reason selected:** Both alternatives paper over the real issue — prefetching a route you know 404s is wasteful and noisy regardless of testing, and stub pages would violate the explicit "do not create module/industry/SEO pages yet" instruction.
**Risks:** Real, built pages need `prefetch` explicitly re-enabled (`prefetch={true}`) once they exist, or Next's default (prefetch on viewport visibility) silently stays off — a small ongoing discipline cost.
**Mitigation:** Documented in `component-inventory.md` and `navigation-specification.md` as the explicit rule; low risk since the earliest a real cost appears is Phase 4, and it's a one-line change per link at that point.

### 4c. `backdrop-filter` broke the mobile nav dialog's positioning
**Decision:** Removed `backdrop-saturate` from the sticky header; additionally portalled `MobileNav` to `document.body`.
**Evidence:** `boundingBox()` on the open mobile-nav dialog measured `{width: 375, height: 64}` instead of the full viewport — traced to the header's `backdrop-filter` creating a new CSS containing block for the dialog's `fixed` positioning (a documented but easy-to-forget CSS behaviour: `transform`/`filter`/`backdrop-filter`/`contain` on an ancestor all do this).
**Alternatives considered:** Keep the backdrop-filter and only fix via the portal (would have worked, since portalling escapes the header's DOM subtree entirely).
**Reason selected:** Did both — removing the backdrop-filter is independently required by the Control Surface "no glass/blur" rule (this was a design-direction violation regardless of the functional bug), and the portal is genuinely better practice for any modal/dialog (robust against any *future* ancestor gaining a transform/filter/contain property, not just this specific case).
**Risks:** None identified — portalling a dialog to `document.body` is a standard, low-risk pattern.
**Mitigation:** N/A.

### 4d. Tailwind v4 bracket-vs-parens syntax made every token utility a no-op
**Decision:** Global find-and-replace of `[--token]` → `(--token)` across all 231 occurrences in 17 files; verified against the compiled CSS output directly (not just "tests pass").
**Evidence:** Compiled CSS showed `.bg-\[--color-bg-elevated\]{background-color:--color-bg-elevated}` — invalid CSS (missing `var()`), silently discarded by the browser, leaving the mega-menu panel with no visible background and hero text showing through it.
**Alternatives considered:** Rewrite every instance to the fully-explicit `bg-[var(--color-bg-elevated)]` form instead of adopting the parens shorthand.
**Reason selected:** The parens shorthand (`bg-(--token)`) is Tailwind v4's documented, intended syntax for this exact case and is shorter/more consistent across the 231 call sites; the explicit `var()` form works too but is unnecessarily verbose for the very common case of directly referencing a design token.
**Risks:** This class of bug (wrong bracket type) produces no build error and no lint error — it's silent until visually inspected.
**Mitigation:** Fixed globally and re-verified against compiled CSS output as part of this phase's validation. Recommended follow-up (not done this phase): a lint rule or CI grep check that fails the build if `[--` appears inside a Tailwind class-name string, to prevent regression.

## 5. Mega-menu ARIA pattern: disclosure region, not ARIA `menu`

**Decision:** `NavMenu`'s open panel is `role="region"` with real, normally-tabbable `<a>` links — not `role="menu"`/`menuitem` with roving-tabindex arrow-key navigation.
**Evidence:** WAI-ARIA's `menu` pattern is designed for application-style menus (like a desktop app's File menu) where every item is a command; mega menus with descriptive text and heterogeneous content are widely documented (including by WAI-ARIA authoring practice critiques) as working better for real users as a disclosure of normal navigable content.
**Alternatives considered:** Full ARIA `menu`/`menuitem` implementation with roving tabindex.
**Reason selected:** Screen-reader and keyboard users get standard, predictable Tab-order navigation through real links; implementing correct roving-tabindex behavior correctly is also meaningfully more code for a mega menu with module descriptions (not a good fit for the `menu` pattern's command-oriented semantics).
**Risks:** A screen-reader user won't hear "menu with N items" framing — they'll hear a labelled region instead.
**Mitigation:** The region has a clear `aria-label` matching the trigger's visible label, and the trigger itself has `aria-expanded`/`aria-controls`, giving equivalent orientation information through a different (and, per current a11y guidance, more appropriate) mechanism.

## 6. Single `ProductFrame` instead of separate `BrowserFrame`/`AppFrame`

**Decision:** One `ProductFrame` component covers what the brief's component list named as two (`BrowserFrame`, `AppFrame`).
**Evidence:** Control Surface's spec explicitly rejects fake OS-window/browser-chrome furniture around screenshots — both named components would have rendered identically (a thin plain frame) under this creative direction.
**Alternatives considered:** Build both as named aliases of the same implementation, for literal compliance with the brief's component list.
**Reason selected:** Two identical components with different names adds maintenance surface with zero visual or functional difference — the repository's own "avoid deeply nested folders with only one file" and general anti-duplication guidance favors one real component.
**Risks:** None — this is purely a naming/consolidation decision, not a scope reduction (the visual treatment both would have had is fully implemented).
**Mitigation:** N/A.
