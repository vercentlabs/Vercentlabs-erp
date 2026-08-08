# Phase 8 Dependency and Supply-Chain Audit

## Method

`pnpm audit --prod` across the full monorepo (this repo has no per-app audit command; `pnpm audit` is workspace-wide), followed by `pnpm why <package> --filter @vercentlabs/landing` for every flagged package to determine actual reachability from `apps/landing` specifically, since the audit's own path output mixes findings from every app in the monorepo (`apps/web`, `apps/mobile`, `services/api`) together.

## Findings — 4 high-severity advisories, monorepo-wide

| Package | Advisory | Reachable from `apps/landing`? | Classification |
|---|---|---|---|
| `js-yaml` | Quadratic CPU consumption in `!!omap` parsing | Yes, but only via `eslint-config-next` → `eslint` → `@eslint/eslintrc` — a devDependency chain | **dev-only, not reachable in production runtime** |
| `image-size` (2 separate advisories: ICNS parser DoS, JXL/HEIF parser DoS) | Denial of service via infinite loop | **No** — `pnpm why image-size --filter @vercentlabs/landing` returns zero results; every path in the full-workspace audit goes through `apps/mobile`'s Expo/Metro toolchain | **false-positive for apps/landing** — this package isn't in landing's dependency graph at all |
| `nanoid` | Custom generators can loop indefinitely when `size` is zero | Yes — via `postcss` (used by both `@tailwindcss/postcss`, a devDependency, and `next` itself, a real `dependencies` entry) | **runtime-present but not runtime-reachable**: `nanoid` here is used internally by `postcss` to generate identifiers during CSS *compilation* (a build-time step, run once during `next build`), never during request handling. The vulnerable code path requires an application to call a custom nanoid generator with `size: 0` — this codebase never calls `nanoid` directly at all (confirmed via a repo-wide grep for `nanoid` in `apps/landing`'s own source — zero matches); it's purely an internal implementation detail of `postcss`'s own ID generation, invoked with `postcss`'s own fixed arguments, not attacker-influenced input. |

**No `runtime reachable` finding exists for `apps/landing`** in the sense the workstream's classification asks about (a package whose vulnerable code path is actually invoked while serving a real request with attacker-influenced input). All 4 advisories are either genuinely absent from landing's dependency tree, or present only in build-time/lint-time tooling that doesn't process untrusted input.

## Other checks

- **Abandoned packages / mismatched major versions:** not found — `apps/landing`'s own `package.json` dependencies are current, actively-maintained packages (`next@16.2.11`, `react@19.x`, `@axe-core/playwright`, `lighthouse`, `web-vitals`, `chrome-launcher`, all added or already present as of Phase 7).
- **Suspicious install scripts:** `pnpm-workspace.yaml`'s `allowBuilds: { sharp: true, unrs-resolver: true }` explicitly allowlists exactly 2 packages permitted to run install scripts — a real, deliberate allowlist (not a blanket `--ignore-scripts=false`), consistent with supply-chain-conscious defaults. No new package was added this phase that required a new entry here.
- **Duplicate major versions:** not specifically audited across the full monorepo (out of this phase's `apps/landing`-focused scope) — `apps/landing`'s own direct dependencies show no obvious duplication.

## What was NOT done

A full monorepo-wide dependency upgrade was explicitly out of scope, per the governing brief's own instruction not to destabilize the product immediately before launch. No dependency was upgraded this phase — only added (`lighthouse`, `chrome-launcher`, `web-vitals`, `@axe-core/playwright` in Phase 7; no new dependency in Phase 8's own work, only new devDependency browser binaries for Playwright's Firefox/WebKit, which aren't `package.json` entries at all — they're downloaded via `npx playwright install`, tracked by Playwright's own version pinning in the existing `@playwright/test` devDependency).

## Conclusion

**No release-blocking dependency finding.** All 4 flagged advisories are either not present in `apps/landing`'s dependency graph or present only in tooling that never processes untrusted runtime input. No fix was needed or applied. This conclusion should be re-checked periodically (a real CI dependency-audit step, if added per `ci-release-verification.md`, would do this automatically going forward rather than relying on a one-time manual check).
