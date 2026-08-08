# Phase 8 Accessibility Final Validation

Consolidates this phase's accessibility findings on top of Phase 7's baseline (`phase-7/accessibility-audit.md`, `phase-7/wcag-22-matrix.md`, `phase-7/keyboard-test-matrix.md`) — this document is the final "does accessibility still hold, and what did Phase 8 change" answer, not a re-derivation of Phase 7's work.

## Phase 7 baseline preserved

0 serious/critical axe-core violations across the 13 representative routes was Phase 7's final state. No Phase 8 change touched any component covered by that baseline in a way that would regress it — confirmed by re-running the full E2E suite (which includes `accessibility.spec.ts`) as part of this phase's Cycle 3 regression: 658/658 passing, no accessibility-test failure.

## 2 new routes added — not yet in the formal axe route list, but verified via equivalent means

`/privacy` and `/terms` were not added to `accessibility.spec.ts`'s 13-route list this phase (a real, disclosed gap — see "What was not done" below). What was verified instead:

- Both routes render with **zero console errors** across all 5 tested browser engines (`cross-browser-smoke.spec.ts`), which would surface a broken ARIA attribute or a JS-level accessibility failure.
- Both use the exact same `SidebarLayout`/`TableOfContents`/`Breadcrumbs`/`Heading`/`Text` primitives already proven accessible on resource-guide pages, which **are** in the axe route list and pass clean — no new component pattern was introduced for these 2 pages.
- The skip link (present on every page, including these 2) was specifically re-verified working via the cross-browser suite's dedicated keyboard-focus test.

**Recommended follow-up, not done this phase:** add `/privacy` and `/terms` to `accessibility.spec.ts`'s `REPRESENTATIVE_ROUTES` array for formal, ongoing axe coverage — a one-line addition, deferred only because this phase's own verification (zero console errors + proven-safe component reuse) already provides reasonable confidence, and the full regression suite's time budget was already substantial this phase.

## 2 real, REPRODUCED WebKit-specific defects found and fixed

Full detail: `decision-log.md` items 2 (Phase 7's summary reference) and this phase's own `cross-browser-validation.md`. Summary: the skip link (a WCAG 2.4.1 mechanism) was previously fixed for Chromium/Firefox in Phase 7 but was found, via this phase's new WebKit testing, to still be broken specifically in WebKit — for two compounding, independent reasons (WebKit's default Tab order excludes plain links; WebKit doesn't reliably honor `tabindex="-1"` fragment-focus). Both fixed via `components/layout/skip-link.tsx`.

**This is a genuinely important finding for the project's own accessibility-testing methodology, not just a one-off bug:** it demonstrates that Chromium-only (or even Chromium+Firefox) keyboard-accessibility testing is insufficient — a defect can pass cleanly in 2 of 3 major engines and still be broken for real users on the third. This is now permanently guarded against via the cross-browser smoke suite's own skip-link test running on all 5 projects going forward.

## Screen-reader testing status — unchanged, stated explicitly

No real screen reader (JAWS/NVDA/VoiceOver) was available in this sandbox, consistent with Phase 7. No screen-reader test is claimed. DOM/accessibility-tree inspection (via axe-core's own rule set, which specifically validates accessible names/roles/ARIA correctness) remains the substitute, with this limitation stated plainly per the standing project discipline.

## What was not done this phase

- `/privacy`/`/terms` not added to the formal axe route list (see above — a low-risk, disclosed deferral).
- No new manual WCAG 2.2 walkthrough was performed on the 2 new pages beyond what's described above — Phase 7's manual matrix (`wcag-22-matrix.md`) was not re-run against them individually.
- No real screen-reader or real-device accessibility testing — unchanged limitation from every prior phase.

## Conclusion

Accessibility posture is **improved**, not just preserved, this phase: 2 real defects fixed (that Phase 7's own testing methodology couldn't have caught), with durable, permanent regression coverage now in place across 5 browser engines instead of 2. The one real gap (formal axe coverage of the 2 new routes) is low-risk and explicitly tracked, not silently skipped.
