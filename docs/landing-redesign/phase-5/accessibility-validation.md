# Accessibility Validation — Phase 5

## Target

WCAG AA minimum, per CLAUDE.md — unchanged from prior phases.

## Inherited, proven-accessible primitives (no new accessibility risk)

Every new page composes components already validated in Phase 2-4: `Breadcrumbs` (semantic `<nav>` + `<ol>`, `aria-current="page"`), `FaqAccordion` (native `<details>`/`<summary>`, keyboard-operable with zero custom JS, full answer text present in server-rendered HTML regardless of open/closed state), `TrackedCtaLink`/`ButtonLink` (real focus-visible outlines), `NavMenu`/`MobileNav` (disclosure pattern, Escape-to-close, focus trap, focus return — unchanged this phase).

## New components' accessibility

- **`WorkflowSequence`**: the numbered sequence uses a real `<ol>` (screen readers announce step order and count), each step's module tag is a real link when rendered inline in related-modules sections. Headings inside (`Approvals`, `Automated actions`, `Exceptions & honest limits`, `Visibility`, `Business value`) use `<h3>` consistently, nested correctly under the page's `<h2>` section heading and single `<h1>`.
- **`RolePerspective`**: each card uses `<h4>` for the role title, nested correctly under the section's `<h2>`. Verified no heading level is skipped (h1 → h2 → h3 → h4, never h1 → h3).
- **`RecommendedModuleStack`**: reuses `InformationBand` (proven in `/modules` index) with a real `<Link>` per module, not a click-handler on a non-interactive element.
- **`ImplementationTimeline`**: the 8 phases render as a real `<ol>`; each phase's numbered badge is `aria-hidden="true"` with the phase name itself as the accessible heading text (matching `ModuleWorkflow`'s established pattern for numbered badges).
- **`BeforeAfterSystem`**: two plain panels with real heading text ("Before"/"After" as `Text variant="eyebrow"`, not color-only differentiation — the "After" panel also gets a distinct border color, not relying on position alone).

## Heading hierarchy check

Every one of the 19 new pages was verified to have exactly one real `<h1>` (enforced by `phase5-routes.spec.ts`'s `toHaveCount(1)` assertion on every route) and a logical, non-skipping heading structure beneath it (spot-checked directly via `page.getByRole("heading", ...)` queries during Cycle 1).

## Known pre-existing gap, not introduced this phase

MFA is schema-present but not enforced platform-wide (a real, documented product limitation, not a landing-site accessibility issue) — irrelevant to this document, noted only to avoid confusion with any future audit.
