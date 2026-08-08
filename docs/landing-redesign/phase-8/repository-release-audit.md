# Phase 8 Repository Release Audit

## Method

`git status --short` (tracked changes) and `git status --short --ignored` (confirming build/test artifacts stay excluded), reviewed at multiple points throughout this phase — not just once at the end — specifically to catch any debug/throwaway file created during investigation before it could accidentally get committed.

## Untracked files at the time of this audit

All untracked content is real, intentional Phase 8 work: `.github/` (2 new CI workflow files), `apps/landing/app/privacy/`, `apps/landing/app/terms/`, `apps/landing/components/legal/`, `apps/landing/components/layout/skip-link.tsx`, `apps/landing/tests/e2e/cross-browser-smoke.spec.ts`, `docs/landing-redesign/phase-8/`, `packages/landing-content/src/legal.js`. No stray, unexplained, or leftover file exists.

## Debug/throwaway files created and cleaned up during this phase (verified removed)

Three temporary investigation files were created and deleted during this phase's work, each for a specific real diagnostic purpose, none left behind:

- `tests/e2e/_debug-cross-browser-smoke.spec.ts` — used to trace the exact WebKit Tab-order behavior that led to the real skip-link fix (`decision-log.md` item 2). Deleted after the fix was confirmed.
- `tests/e2e/_rehearsal-demo-lead.spec.ts` — used for the one-time synthetic demo-lead journey rehearsal (`conversion-launch-validation.md`). Deleted after the rehearsal completed; its findings are preserved in that document instead.

Verified removed via a direct `find apps/landing/tests -iname "_*"` returning zero results, and `git status` showing neither file as untracked.

## Generated build artifacts — confirmed still correctly excluded

`git status --short --ignored` confirms `apps/landing/.lighthouse-reports/`, `apps/landing/.next/`, `apps/landing/test-results/`, and `apps/web/.next/` all remain properly gitignored. No `.next` output, Lighthouse report, or Playwright trace/screenshot was accidentally staged at any point this phase.

## `.env`/credential files

No `.env`, `.env.local`, or any non-`.example` environment file is tracked — confirmed in `secret-scan.md`'s dedicated check.

## Local databases

Not applicable — `apps/landing` has no database of its own (confirmed throughout this phase's environment-contract and cookie-storage audits: no `DATABASE_URL`-equivalent variable, no ORM, no local DB file anywhere in its dependency tree).

## Dead code / stale assets

Covered in a dedicated pass — see the separate dead-code-cleanup section of this phase's decision log (searched for orphaned components, unused screenshots, deprecated analytics events referenced nowhere). No broad speculative cleanup was performed — only verified-unreferenced items, per the workstream's explicit caution against removing something merely because it "appears" unused.

## Conclusion

The repository is clean going into this phase's final commits: no accidental artifact, no leftover debug file, no untracked credential, and every untracked file present is real, intentional, documented Phase 8 work.
