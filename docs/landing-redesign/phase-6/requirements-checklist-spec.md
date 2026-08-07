# ERP Requirements Checklist — Spec

## What it is

`/resources/erp-requirements-checklist` — a real, structured evaluation tool built directly from the product's actual capability model (`packages/landing-content/src/capability-registry.js`'s `CAPABILITY_GROUPS`: 73 real groups summing to the settled 1,039-requirement total), not a generic checklist someone wrote by hand. Explicitly framed to be useful for evaluating any ERP, whether or not the reader ends up choosing Vercentlabs.

## Data source, not new content

Zero new content-truth was invented for this page — every group's `name`, `description`, `requirementCount`, and `publicPage` link comes directly from the existing capability registry, which itself derives module-specific groups from `modules.js` (the single source of truth already used by every module page) and platform groups from `product-intelligence.md`'s shared-platform profile.

## Architecture: server-rendered base + client-side progressive enhancement

The full list (all 73 groups, full name/description/requirement-count text, and a link to the real product page for each) is rendered server-side and present in the initial HTML — verified via a Playwright test asserting all 73 `<input type="checkbox">` elements and their surrounding text exist before any JS executes. Interactivity (module filtering, checkbox state, print) is a `"use client"` island (`apps/landing/components/resources/requirements-checklist.tsx`) that hydrates on top of that same server-rendered content — nothing is JS-only or hidden from a crawler.

## Filtering

Client-side only, filtering the already-rendered 73 groups by `filterKey` (a module key or a platform area). Default state is "All" — meaning the un-hydrated, pre-JS page shows everything, and the filter is a pure narrowing convenience, never a way to reveal content that wasn't already there.

## Progress persistence

`localStorage` only, under a versioned key (`vercentlabs-requirements-checklist-progress-v1`). Never sent to a server, never sent to analytics — a buyer's specific evaluation-checklist selections are exactly the kind of confidential signal `.claude/rules/landing-content.md` and this spec treat as private by default. Verified via a real Playwright test: check a box, reload the page, confirm the check state survives (proving it round-trips through `localStorage`, not just component state).

## No login gate

The entire checklist — read and interactive — is available with no account, no email-gate, no "unlock to see the rest" pattern. Consistent with the site's broader "genuinely useful even to a competitor's prospective buyer" positioning for evaluation-stage content.

## What IS tracked (and what explicitly is not)

- `requirements_filter` fires when a module filter is clicked, with the filter key as the only property — tells you which module people are interested in, nothing about their specific selections.
- `requirements_print` fires on the Print button click.
- Individual checkbox check/uncheck actions are **never** tracked — this is the one interaction on this page explicitly excluded from analytics, by design, not by oversight.

## Print support

The Print button calls `window.print()`; `print:hidden` utility classes hide the filter bar and per-item "see how Vercentlabs implements this" links in the printed output, leaving a clean, printable requirement list.

## Testing

`apps/landing/tests/e2e/phase6-routes.spec.ts`'s "ERP requirements checklist" block: real 200 + single H1 + exactly 73 rendered checkboxes + the literal "1039 requirements across 73 capability groups" summary line; module-filter narrowing the visible set with zero console errors; checkbox-state persistence across a real page reload.
