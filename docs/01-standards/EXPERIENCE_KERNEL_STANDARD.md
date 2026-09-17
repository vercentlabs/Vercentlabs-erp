# Experience Kernel Standard

Status: `ARCHITECTURE_FROZEN_PASS_E` — the literal `apps/web/src/shared/design`
Experience Kernel implementation this standard originally described was
deleted 2026-09-14 as part of the clean-slate frontend rewrite (see
`docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md` and `ADR_003`);
implementation authority now sits with `packages/design-system`. The
UX-contract requirements below (state coverage, responsive behavior,
accessibility) are stack-agnostic and remain in force unchanged.

`EXPERIENCE_KERNEL_REGISTER.csv` is the canonical reusable UX contract. Modules reuse these primitives but retain domain-specific workflows; reusable UI never means generic CRUD. Every major screen must define loading, empty, error, permission, stale/conflict, saving/pending, partial-failure and offline states where relevant. Desktop/tablet/phone behavior preserves critical actions or explicitly classifies them as not applicable. WCAG 2.2 AA intent, keyboard/focus, screen-reader status/errors, target sizing, zoom/reflow, reduced motion and non-drag alternatives are implementation requirements.

Major modules may compose specialized workbenches, but cannot create a parallel design system without an approved ADR.
