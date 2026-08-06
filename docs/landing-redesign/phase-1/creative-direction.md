> Vercentlabs Landing Redesign — Phase 1, Workstream I
> Status: Decided. Supersede only via a new decision entry in `decision-log.md`.
> Research conducted by the Brand and Digital Design Director agent (read-only code inspection of `apps/web` and `apps/mobile`; no live browser/screenshot tooling was available in this environment — see completion report "Remaining inputs").

## Part 1 — Current product visual identity (evidence)

The actual ERP product (`apps/web`, `apps/mobile`) — not the deleted landing site — is the real source of Vercentlabs' visual identity, and it was audited directly.

**No Tailwind in the product.** `apps/web` has no `tailwindcss` dependency and no `@theme`/config file — the app is hand-authored CSS with semantic class names and CSS custom properties. `apps/mobile` has no Tailwind/NativeWind either. The new landing app (Tailwind v4 is available at the workspace root per the frontend-architecture findings) is not inheriting a Tailwind token system from the product — it will define its own.

**Two competing color/spacing systems exist inside the product today**, and the redesign must pick one, not both:
- `apps/web/src/app/globals.css:4-62` — the foundation theme (auth, onboarding, dashboard-hero): indigo primary (`#4f46e5`/`#3730a3`), cyan secondary (`#0891b2`), ink `#101828`, canvas `#f4f6fa`, generous radii (10-28px), Inter-first system-font stack at 14px.
- `apps/web/src/app/operator-workbench.css:1-100` — loaded after every module stylesheet, explicitly documented as the shared cross-module skin: blue primary (`#315efb`, not indigo), tighter radii (8-16px), a Fluent/Windows-flavored font stack, tabular numerals.

**Resolution:** the indigo/cyan/navy/slate foundation palette is treated as canonical brand, not the workbench override — because the brand mark itself (`globals.css:215-231`, a `linear-gradient(145deg, #6257f6, #4338ca)` chip) and the entire mobile app theme (`apps/mobile/src/shared/theme/tokens.ts:1-24`, near-identical indigo/cyan/navy/slate values) both align with it. Mobile's theme file states explicitly: *"apps/web explicitly uses color-scheme: light. Keep the native shell on the same palette so screenshots and learned visual cues stay aligned"* — the team's own stated intent confirms indigo/cyan/navy/slate as the real brand, not the workbench's blue override.

**Real, systematic per-module color coding exists for 4 of 12 modules**: `apps/web/src/app/enterprise-modules.css:1-58` is explicitly headed "Final visual and interaction layer for CRM, Sales, Procurement and Accounting" and assigns a flat accent to exactly those four (CRM purple `#6956d9`, Sales blue `#2468d7`, Procurement teal `#087f6a`, Accounting slate-blue `#31566f`), applied via scoped workbench classes — a genuine, reusable design token, not decoration. The remaining 8 modules (Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) fall back to the generic `--module-accent: var(--color-primary)` (indigo) in the product today — they have no distinct color to "reuse." The landing site's module-color system (see the implementation-ready spec below) reuses the real 4 verbatim and defines 8 additional, clearly-labeled landing-original colors in the same family to complete the set of 12.

**No brand typeface is actually shipped.** Zero `next/font` usage, zero `@font-face` declarations, and the CSP (`apps/web/next.config.mjs`) only permits `font-src 'self' data:`. "Inter" is named first in the stack but never loaded as a webfont — the product renders in whatever system UI font the OS provides. This is a genuine gap, not a constraint: the new landing site is free to choose typography without contradicting an established brand font, because none exists yet.

**The product already violates several of this brief's creative constraints**, which is itself a useful finding: the topbar uses `backdrop-filter: blur(18px)` glassmorphism; the dashboard hero layers indigo/cyan radial gradients over a dark panel (a literal instance of the "generic blue-purple gradient" the brief prohibits); status badges and chips are pervasively pill-shaped; the module launcher is a conventional card grid. The marketing site should feel like it shares the product's bones (palette, radius family, restrained shadow scale, tabular numerals) while being *more disciplined* than the product currently is about gradients, glass, and pills — not a literal skin of the current app.

## Part 2 — Three creative directions

### Direction A — Control Surface

A structured, blueprint-grade site that treats the product as an instrument panel: real, annotated screenshots are the content; a visible grid, hairline borders (matching `--color-line`), and flat single-accent indigo (pulled from the real brand-mark gradient's `#4338ca`/`#4f46e5`) carry the rest. Near-flat elevation (`--shadow-subtle`/`--shadow-panel` only), tight radii (8-16px, matching `operator-workbench.css`'s tighter scale — deliberately less rounded than the product's own softer marketing-adjacent surfaces), one typeface at a disciplined scale with tabular numerals for data. Hero *is* a large annotated real screenshot, not empty space with copy over it. Modules shown as a colored index/table of contents (using the real per-module accent tokens) rather than a card grid. Workflows shown as a literal horizontal pipeline diagram, module-colored segment by segment. Motion is informational only (count-up numbers, sequential callout highlights, 1-2px hover lift, respects `prefers-reduced-motion` as the product itself already does).

### Direction B — The Ledger

An editorial, financial-report-grade site: serif display type paired with the product's existing neutral system-font stack for body copy, paper-toned canvas, numbered "exhibit" screenshots captioned in small-caps, an asymmetric editorial column grid, almost no rounding, hairline rules used as typographic dividers rather than card containers. The most distinctive and memorable of the three, and the least like any competitor's marketing site — but it introduces a second font family the product has never needed, carries real performance/implementation overhead across 40+ pages, and risks reading as a media site rather than software if not executed with restraint.

### Direction C — Live Operations

A dark, mission-control site built from the product's own sidebar/dashboard-hero DNA, but flattened (no radial gradients) and centered on making the real per-module accent-color system the visible spine of the whole site — module-colored tiles, a workflow connector line that shifts color as it crosses module boundaries, real screenshots shown bright/light-mode inside dark "monitor" tiles. The most viscerally "real product" direction and the clearest visualization of "one system, many modules" — but it sits closest to the exact territory (dark gradients, glow, glass) the brief rules out, and carries the highest accessibility risk (module accent colors like teal/slate on navy need lightened on-dark variants to pass WCAG AA) and performance risk (multiple live-feeling widgets, heaviest hero) of the three.

## Scoring

| Criterion (1-10) | A — Control Surface | B — The Ledger | C — Live Operations |
|---|---|---|---|
| Brand distinctiveness | 7 | 9 | 8 |
| Enterprise credibility | 9 | 9 | 7 |
| Product clarity | 9 | 7 | 8 |
| Conversion suitability | 8 | 6 | 7 |
| Scalability across ~40+ pages | 9 | 7 | 6 |
| Mobile quality | 8 | 7 | 6 |
| Accessibility | 9 | 7 | 5 |
| Performance | 9 | 8 | 5 |
| Implementation feasibility (Tailwind v4 + Next.js, no inherited token debt) | 9 | 7 | 6 |
| Memorability | 6 | 8 | 8 |
| **Average** | **8.3** | **7.5** | **6.6** |

## Recommendation: Direction A — Control Surface

ERP buying committees visit dozens of pages, compare screenshots, load pages from locked-down corporate networks, and frequently rely on keyboard/screen-reader navigation somewhere in the evaluation chain. Direction A wins on exactly the dimensions that matter most for that journey — product clarity, scalability, accessibility, performance — while still being genuinely distinctive: no named competitor (Linear, Stripe, SAP, Salesforce, NetSuite, etc.) uses a literal blueprint-grid layout with numbered-exhibit screenshot annotation as its whole identity. It is also the most honest extension of the *evidenced* product identity — it draws on the light-mode workspace patterns (panels, hairline borders, restrained shadows, tabular numerals, indigo/cyan accent) that are the more consistent half of the product's split personality, rather than the dark gradient hero that already risks violating this brief's own "no generic blue-purple gradients" rule.

**Rejected from B (Ledger):** the full serif/editorial system is not adopted — it costs a second font family the product has never needed and the highest execution risk of drifting into "media site" territory. If more gravitas is wanted later, borrow at most one device (numbered section markers), not the full voice.

**Rejected from C (Live Operations):** the dark canvas and glow-adjacent visual territory is not adopted, since it sits closest to the brief's explicit prohibitions and carries the highest a11y/perf risk. Its best idea — the real per-module accent-color system as a visible, structural signal — is carried into Direction A as a targeted device (module-colored tags on screenshots, a colored workflow pipeline diagram), not as a site-wide dark identity.

## Direction A — implementation-ready specification (for Prompt 2)

- **Typography**: one neutral system/grotesque family (no new webfont dependency — the product has never shipped one; a single, carefully chosen variable sans is acceptable if a genuine upgrade over system-ui is wanted, but must not block Prompt 2 on font licensing/perf tradeoffs). Tabular numerals wherever data appears. Headline tracking -0.04 to -0.05em; body line-height 1.6-1.7.
- **Colour**: off-white/near-white canvas, ink-dark text (`#101828`-class, never pure black). One flat, non-gradient accent — indigo, from the real brand-mark's darker stop (`#4338ca`/`#4f46e5` family). Cyan (`#0891b2`) as a rare second signal for "live/connected" moments only. Per-module accent tokens: the 4 that exist in the product (CRM, Sales, Procurement, Accounting) are reused verbatim from `enterprise-modules.css`; the other 8 modules get new, landing-only colors in the same family (documented as such, not claimed as product-sourced) — never blended into a gradient.
- **Grid**: a visible column grid with thin hairline verticals; content and screenshots snap to it; max content width in the 1520-1680px range the product itself already uses.
- **Shape**: rectangles, 8-16px radius (the product's tighter workbench scale, not its softer 20-28px marketing scale); no circles except small, meaningful status dots; no pill-shaped elements as a default UI pattern (a deliberate correction of the product's own pill overuse).
- **Borders/elevation**: 1px hairline borders doing real structural work; shadows limited to the product's own subtle/panel tiers; no blur, no glass.
- **Product-UI treatment**: real screenshots, thin plain-chrome frame (no OS window furniture, no 3D tilt), cropped to the meaningful region, numbered callouts, one-line caption beneath.
- **Illustration**: none except literal system/workflow diagrams built from the same line/rectangle/dot vocabulary as the UI.
- **Photography**: none, ever (also required by the Evidence and Honesty Rules).
- **Motion**: count-up numbers once on scroll-into-view, sequential callout reveals, 1-2px hover lift, respects `prefers-reduced-motion`; nothing loops or marquees.
- **Hero**: a large annotated real screenshot above the fold beside a short headline/subhead — not centered copy over empty gradient space.
- **Modules**: colored index/table-of-contents treatment using real per-module accent tokens.
- **Workflows**: horizontal pipeline diagram, module-colored segment by segment, each segment linking to its annotated screenshot.
- **Mobile**: grid collapses to one column; screenshots become the full-width focal element; callouts move below the image as a numbered list.
- **Accessibility**: high-contrast text-on-white by construction; verify hairline/border contrast against the off-white canvas; callout markers need text alternatives, not just numbered dots.
- **Performance**: no video/blur/3D by default; the only real cost is screenshot images, managed via `next/image` with explicit dimensions.

## Limitation

No browser automation, screenshot, or visual-diff tooling was available in this environment, so this direction was selected from code-level evidence (CSS tokens, component structure) and static reasoning about the buyer journey, not from rendered screenshots or live competitor browsing. Rendering a working prototype of Direction A's hero and one module page is a recommended first validation step in Prompt 2 before committing further pages to it.
