# ERP Navigation Registry Foundation & Server Page Gating (Prompt 6 of 102)

Date: 2026-08-09
Scope: extract the existing sidebar's inline nav arrays into one central typed registry, wire Prompt 4/5's module-access resolver into navigation filtering, close Prompt 5's documented direct-URL page-gating gap at the narrowest shared layout boundary, fix "only one module expands at a time," and consolidate three duplicate active-route matchers. No full IA build-out, no Ctrl+K, no Quick Create, no CRM visual convergence, no mobile shell changes.

Starting git state: branch `main`, all Prompt 1-5 work present and untouched (161 changed paths at start). No commits made. No destructive git operations used.

---

## 1. Executive Summary

Prompt 1's audit found the sidebar was already better-architected than a typical "scattered JSX" codebase: one `AppShell` component (`apps/web/src/components/app-shell.tsx`) fed desktop sidebar, mobile disclosure menu, and a module context bar from five typed `const` arrays declared inline in that same 1139-line file — genuinely one source of truth for *rendering*, but not a standalone, importable, `ModuleId`-typed registry, and with two real gaps: no module-enablement/entitlement filtering (only permission filtering existed), and no page-level gating at all for direct URL access (Prompt 5's documented remaining gap). CRM additionally forked its own second navigation data source (`crm-section-tabs.tsx`'s `crmAreas`) for an in-page tab strip, and three components independently reimplemented the same "is this path active" matching logic.

This prompt:
1. Extracted the five inline arrays into `apps/web/src/lib/navigation/` (10 files: types, five data sections, a shared active-route matcher, a module route-root map, the resolver, a barrel) — an additive move, not a rewrite, preserving every existing `href`/`permission`/`icon` verbatim.
2. Wired Prompt 4/5's `getAccessibleModules()` into a new `resolveNavigation()` that runs server-side in the root layout, before `AppShell` ever renders — an inaccessible module's entire group disappears, not just its permission-gated items.
3. Closed the direct-page-access gap by adding a `layout.tsx` to all 12 module route roots (11 new, CRM's existing one extended), each wrapping its children in one shared `ModulePageGuard` server component — not 88 individual `page.tsx` edits.
4. Fixed "only one module expands at a time" (previously not actually enforced — each sidebar section was an independent native `<details>`) via a new client component, `SidebarModules`, that owns a single coordinated expansion value.
5. Consolidated three duplicate active-route-matching implementations (`navigation-link.tsx`, `navigation-section.tsx`, `module-context-bar.tsx`) into one shared `matchesPath()`.
6. Fixed the breadcrumb label map Prompt 1 flagged as an independent, driftable duplicate of the nav config — now derived from the registry, with the previous exact visible text preserved via a small override list.
7. Extended `apps/web/scripts/verify-routes.mjs` to validate every registry `href` against the real route tree (121/121 pass).
8. Added request-scoped memoization (`React.cache()`) to `getSessionContext`, `getEnabledModuleKeys`, and `getBillingSummary` so the new per-module page guard doesn't duplicate the DB/billing round-trips the root layout's navigation resolution already made in the same request.

## 2. Previous Navigation Architecture

| Source | Purpose | Duplicated? | Action |
|---|---|---|---|
| `app-shell.tsx`'s `workspaceNavigation`/`moduleNavigation`/`workNavigation`/`governanceNavigation`/`settingsNavigation` (5 inline arrays, ~850 of the file's 1139 lines) | The de facto nav registry — fed desktop, mobile, and module-context-bar rendering | No — one source feeding three renderings | Extracted verbatim into `apps/web/src/lib/navigation/*.ts`, `moduleId`-tagged, re-imported |
| `crm-section-tabs.tsx`'s `crmAreas` | A CRM-only secondary in-page tab strip (4 workflow clusters: Lead workspace, Opportunity workspace, Communication workspace, CRM administration) | Overlapping-but-differently-shaped from the sidebar's CRM group (coarser clusters, different labels — "All leads" vs sidebar's "Leads") | **Not merged into the registry** — reviewed and kept as page-level UX per Part 20 ("leave page-level CRM styling for a later prompt"); it is not a competing *sidebar*, CRM's sidebar entry now comes from the same registry as every other module (Section 13) |
| `breadcrumbs.tsx`'s hardcoded `labels` map (47 entries) | Breadcrumb segment→label text | Yes — Prompt 1 flagged this explicitly as a second, independently-maintained source that could drift from the nav config | Replaced with `navigation/breadcrumb-labels.ts`, derived from the registry plus a small, verified-byte-identical override list for the handful of segments where breadcrumb text intentionally differs from the sidebar label or a segment is shared by two route roots (Section 12) |
| `navigation-link.tsx` / `navigation-section.tsx`'s `matchesPath` / `module-context-bar.tsx`'s `matches` | Active-route highlighting | Yes — three near-identical implementations, one with a subtly stricter `/dashboard` guard the other two lacked | Consolidated into `navigation/match-path.ts`'s single `matchesPath()`, imported by all three; behavior preserved exactly (the strictest variant's `/dashboard` guard is now universal, harmless since it was already redundant given `exact: true` on that item) |
| `apps/web/src/app/(app)/layout.tsx` | Session resolution + shell render | No | Extended to also call `resolveNavigation()` and pass the result to `AppShell`; no page-level access check previously existed here or anywhere else for module pages |
| Only `crm/layout.tsx` existed among the 12 modules (wrapping children in `CrmSectionTabs`) | The one pre-existing module-scoped layout | N/A | Extended with `ModulePageGuard`; 11 new sibling layouts added for the other modules, none of which had any route-group layout before |

## 3. New Registry Architecture

```
apps/web/src/lib/navigation/
  types.ts               NavigationItem, ModuleNavigationGroup, ResolvedNavigation, local ModuleId union
  workspace.ts            Home, Master data
  my-work.ts               Notifications, Approvals
  governance.ts            Billing, Audit logs
  administration.ts        Workspace settings (10 items) + Security
  modules.ts                All 12 ModuleNavigationGroup trees (moduleId-tagged)
  match-path.ts             matchesPath() — the one shared active-route matcher
  route-map.ts               MODULE_ROUTE_ROOTS, moduleIdForPath()
  resolve-navigation.ts       filterNavigation() (pure) + resolveNavigation() (async, DB-backed)
  breadcrumb-labels.ts        BREADCRUMB_LABELS, derived from the above
  index.ts                     barrel
```

`ModuleId` is a 12-member string-literal union local to the navigation layer (`packages/shared-types`'s `ErpModule.key` is plain `string`, per `modules.d.ts` — this is the navigation layer's own stricter, exhaustive-checkable view of the same 12 keys `resolveModuleAccess()` already accepts). `navigation-registry.test.mjs` enforces that the set of declared `moduleId`s equals `ERP_MODULE_CATALOG`'s key set exactly, so the two can't silently drift.

## 4. Top-Level Navigation

| Section | Items today | Notes |
|---|---|---|
| Workspace | Home, Master data | Unchanged from before |
| My Work | Notifications, Approvals | Target IA also names Tasks, Follow-ups & Reminders, Exceptions, Recent Records, Favourites — none have a real route (confirmed via a repo-wide scan; Prompt 1's audit separately confirmed zero favourite/favorite matches anywhere) — omitted per Part 8, tracked in Section 11's gap matrix |
| Governance | Billing, Audit logs | Target IA also names Compliance — no real route — omitted |
| Administration | Workspace settings (Organisation, Companies, Branches, Departments, Teams, Cost centres, Users, Roles & permissions, Numbering series), Security | Security is a real, previously-shipped route (`/security`) that had **no sidebar entry at all** before this prompt — only a topbar icon button — now discoverable. Target IA also names Automation, Reports & Analytics, Integrations, Data Management — no real routes — omitted |

## 5. Canonical Module Navigation

All 12 module trees were extracted **verbatim** from `app-shell.tsx` (every `href`, `label`, `icon`, `permission`, `group`, `activePrefixes` value unchanged) and tagged with `moduleId`. Per Part 8's explicit instruction, the deeper aspirational capability trees in the prompt's own product-navigation handoff (e.g. Accounting's GST/E-Invoice/TDS/consolidation subtree, Stock's WMS/RFID/lot-genealogy subtree, Procurement's reverse-auctions/VMI subtree) were **not** added — none of those routes exist yet. Existing, real per-module trees (already reasonably rich — e.g. Accounting has 11 sub-destinations, Stock has 8, CRM has 12 across 5 capability groups) were kept as-is. The full gap between today's registry and the target IA is in Section 11's Route Gap Matrix, for future module-completion prompts to consume — not fabricated here.

## 6. Permission Filtering

`resolveNavigation(session)` (`apps/web/src/app/(app)/layout.tsx` calls this once, in parallel with `getShellData`):

1. Calls Prompt 4/5's `getAccessibleModules(session)` — one shared `organization_modules` query + one billing-summary lookup, resolving all 12 modules' `{released, enabled, entitled, permitted, accessible}` state at once (unchanged, reused as-is — this prompt adds no new module-access logic).
2. Builds `accessibleModuleIds = new Set(access.filter(a => a.accessible).map(a => a.moduleId))`. On any lookup failure, defaults to an **empty** set (fail closed — mirrors `resolveModuleAccess`'s own contract), never all 12.
3. Calls the pure `filterNavigation({ session, accessibleModuleIds })`:
   - Module groups: `moduleNavigation.filter(group => accessibleModuleIds.has(group.moduleId))` — an inaccessible module's *entire* group is removed before any item-level check runs.
   - Within each remaining accessible module, items are still individually filtered by `hasPermission()` — module access is not a permission bypass; a user with CRM module access but not `crmSettingsManage` still doesn't see CRM Settings.
   - Empty groups (all items permission-filtered away) are pruned.
   - Workspace/My Work/Governance/Administration/Workspace-settings items are permission-filtered the same way (unchanged from the previous `visibleItems()` logic — no module concept applies to these).
4. Returns a `ResolvedNavigationWithSettings` object — the *only* thing `AppShell` receives; it no longer computes any visibility itself.

This is a pure/impure split deliberately: `filterNavigation` has zero I/O and is the only piece of this logic directly executed by the test suite; `resolveNavigation` is the thin async wrapper supplying the one real DB-backed input.

## 7. Page-Level Module Gating

Closes Prompt 5's documented gap ("server-rendered CRM pages still use the ungated synchronous `crmContext()`... more broadly, module pages can be entered directly by URL"):

```
apps/web/src/components/module-page-guard.tsx   (Server Component)
  ModulePageGuard({ moduleId, children }):
    session = await requireWorkspace()              // unchanged, existing — redirects unauthenticated/unverified
    access  = await resolveModuleAccess(session, moduleId)   // Prompt 4/5, unchanged
    if (!access.accessible) return <ModuleAccessDenied .../>
    return children
```

One `layout.tsx` per module route root (`apps/web/src/app/(app)/<module>/layout.tsx`, 12 total — 11 newly created, `crm/layout.tsx` extended) wraps its module's `children` in `ModulePageGuard`. This is a **route-group layout boundary**, not a per-`page.tsx` check — every page under `/accounting/**`, `/manufacturing/**`, etc. inherits the guard automatically because Next.js always renders a segment's `layout.tsx` before its nested pages, with zero additional edits per page. CRM's existing `CrmSectionTabs` wrapping is preserved inside the guard, not replaced.

`ModuleAccessDenied` (`apps/web/src/components/module-access-denied.tsx`) renders one of four distinct, non-leaking messages keyed by the same `ModuleAccessReason` Prompt 5's API layer already uses (`not_released`/`disabled`/`not_entitled`/`not_permitted`), reusing the existing `.empty-state` visual pattern from `globals.css` rather than introducing a parallel style system, with a link back to Home. Deliberately minimal per Part 10 — no upgrade-flow UI.

`getSessionContext`, `getEnabledModuleKeys`, and `getBillingSummary` were wrapped in `React.cache()` (request-scoped memoization, not cross-request caching) so that the root layout's `resolveNavigation()` call and each module layout's `ModulePageGuard` call — both resolving the same session/organization within the same request — don't each run their own copy of the underlying queries (Section 15).

## 8. One-Module-Expansion Model

Previously **not actually enforced**: each module's sidebar section was an independent native `<details open={active}>` (`navigation-section.tsx`), auto-opened when its own route was active, but with nothing coordinating across sections — a user could manually click open several `<summary>` elements at once, since native disclosure widgets don't close siblings.

Fixed via a new client component, `apps/web/src/components/sidebar-modules.tsx`:
- Owns one state value, `expanded: string | null` (the currently-expanded module's id) — not a per-module boolean.
- Each module's `NavigationSection` is rendered with controlled `open={expanded === group.moduleId}` and `onOpenChange={(open) => setExpanded(open ? group.moduleId : null)}` — opening any module necessarily sets every other module's `open` to `false` on the same render, by construction (a single variable can only equal one value).
- Initial/ongoing expansion is **route-derived**, via `moduleIdForPath(pathname)` (module-root prefix matching, not label-string matching) — using React's documented "adjusting state when a prop changes during render" pattern (comparing against a `lastRouteModuleId` state value) rather than a `useEffect`, since calling `setState` synchronously inside an effect for a value already available during render is a lint violation (`react-hooks/set-state-in-effect`) the project's ESLint config enforces.
- The user can still manually collapse the currently-active module (clicking its summary fires `onOpenChange(false)`) — matching the spec's "may be permitted if existing UX supports it."
- `NavigationSection` itself gained optional `open`/`onOpenChange` props; when omitted (Workspace Settings' section — a global, non-module area), it falls back to its previous uncontrolled, auto-open-if-active behavior, unaffected by module coordination.

## 9. Server/Client Boundary

- **Server**: `(app)/layout.tsx` (session resolution, `resolveNavigation()`), `<module>/layout.tsx` × 12 (`ModulePageGuard`, `resolveModuleAccess`), `AppShell` itself (renders the already-resolved `navigation` prop — no client-side re-derivation of visibility).
- **Client**: `SidebarModules` (expansion coordination), `NavigationSection`/`NavigationLink`/`ModuleContextBar`/`Breadcrumbs`/`ContextSwitcher`/`WorkspaceSearch` (active-route highlighting, native interaction) — none of these fetch or compute permission/module-access state; they only render what the server already decided.

## 10. Route Mapping — All 12 Module Roots

| Module | Route root | Layout file |
|---|---|---|
| CRM | `/crm` | `apps/web/src/app/(app)/crm/layout.tsx` (extended) |
| Sales | `/sales` | `apps/web/src/app/(app)/sales/layout.tsx` (new) |
| Accounting | `/accounting` | `apps/web/src/app/(app)/accounting/layout.tsx` (new) |
| Procurement | `/procurement` | `apps/web/src/app/(app)/procurement/layout.tsx` (new) |
| Stock | `/stock` | `apps/web/src/app/(app)/stock/layout.tsx` (new) |
| Manufacturing | `/manufacturing` | `apps/web/src/app/(app)/manufacturing/layout.tsx` (new) |
| Projects | `/projects` | `apps/web/src/app/(app)/projects/layout.tsx` (new) |
| Assets | `/assets` | `apps/web/src/app/(app)/assets/layout.tsx` (new) |
| Point of Sale | `/point-of-sale` | `apps/web/src/app/(app)/point-of-sale/layout.tsx` (new) |
| Quality | `/quality` | `apps/web/src/app/(app)/quality/layout.tsx` (new) |
| Support | `/support` | `apps/web/src/app/(app)/support/layout.tsx` (new) |
| HR & Payroll | `/hr-payroll` | `apps/web/src/app/(app)/hr-payroll/layout.tsx` (new) |

`MODULE_ROUTE_ROOTS` in `navigation/route-map.ts` is the single machine-readable copy of this table, used by `moduleIdForPath()`.

## 11. Route Gap Matrix

| Navigation destination | Current route | Status | Future prompt |
|---|---|---|---|
| Workspace > Master Data's full subtree (Organisation/Parties/Products/Inventory/Finance/Shared, ~25 leaves) | `/master-data` (single dynamic-resource page) | MERGED INTO EXISTING WORKSPACE | A later prompt could split this into distinct routes if the single resource-switcher page proves insufficient |
| My Work > Tasks, Follow-ups & Reminders, Exceptions, Recent Records, Favourites | none | MISSING | A future "My Work" prompt (Part 23 explicitly deferred the aggregation engines) |
| Governance > Compliance | none | MISSING | Future governance prompt |
| Administration > Automation, Reports & Analytics, Integrations, Data Management | none | MISSING | Future administration prompts |
| All 12 modules' Overview/list/report/settings destinations already in the registry | real | IMPLEMENTED | — |
| Accounting: GST/E-Invoice/E-Way Bill/TDS/TCS, consolidation, intercompany, FX revaluation as distinct destinations | folded into existing Tax/Global-Finance-adjacent pages | INTENTIONALLY IN-PAGE / MISSING (mixed — some exist as in-page sections of `/accounting/tax` and `/accounting/planning`, not verified exhaustively) | Accounting completion prompt |
| Stock: WMS/RFID/lot-genealogy/traceability, ABC/XYZ analysis as distinct destinations | not present as separate nav destinations | MISSING | Stock completion prompt |
| Procurement: e-procurement/reverse-auctions/VMI/CLM as distinct destinations | not present | MISSING | Procurement completion prompt |
| Manufacturing/Projects/Assets/POS/Quality/Support/HR & Payroll's deeper aspirational subtrees (per the product handoff's full capability lists) | existing registry entries cover each module's shipped resources only | MISSING (documented, not fabricated) | Respective module completion prompts |

No broken links exist in the current registry — verified against the real file tree by `verify-routes.mjs` (Section 17): all 121 registry hrefs resolve.

## 12. Duplicate Navigation Removed

1. `app-shell.tsx`'s five inline arrays → `apps/web/src/lib/navigation/*.ts` (Section 2).
2. `breadcrumbs.tsx`'s independent 47-entry hardcoded label map → `navigation/breadcrumb-labels.ts`, derived from the registry with a small, byte-verified override list (10 entries) preserving today's exact visible text for segments where breadcrumb copy intentionally differs from the sidebar label (e.g. sidebar "Sales orders" vs breadcrumb "Orders") or where one segment is shared by two route roots (`assets` is both the Assets module root and an Accounting sub-page — a known, pre-existing, segment-keyed-map limitation, preserved exactly rather than silently "fixed" in a way that could change other unreviewed breadcrumb text).
3. Three duplicate `matchesPath`/`matches` implementations → `navigation/match-path.ts`'s single `matchesPath()`.

## 13. CRM Navigation Convergence

CRM's sidebar entry now comes from the exact same `moduleNavigation` registry array as the other 11 modules — there is no second, competing sidebar definition. `crm-section-tabs.tsx`'s `crmAreas` was reviewed and **intentionally not merged**: it is a distinct in-page secondary tab strip (4 coarse workflow clusters, different grouping and labels than the sidebar's CRM entries) analogous to — but differently shaped from — `ModuleContextBar`, not a sidebar. Per Part 20 ("leave page-level CRM styling for a later prompt"), it is left as-is; only its *layout* now sits inside `ModulePageGuard`.

## 14. Accessibility

- `NavigationSection`'s `<summary>` gained an explicit `aria-expanded={open}` (native `<details>` already communicates this implicitly to most assistive tech; the explicit attribute is a belt-and-suspenders addition, not a behavior change).
- All primary navigation controls remain semantic `<Link>`/`<details>`/`<summary>` elements (no click-only `<div>`s were introduced).
- Skip-to-content link, focus-visible outline (`--color-primary` ring, `globals.css`), and keyboard-operable native disclosure widgets are all unchanged from the existing shell.
- `ModuleAccessDenied` uses a semantic `<h1>` and a real `<Link>` back to Home.

A full accessibility audit was explicitly out of scope (Part 25) — the above is "accessible by construction" for what changed, not a comprehensive review.

## 15. Performance

Per request, for a module page view: **one** `organization_modules` query + **one** billing-summary query (both `React.cache()`-memoized), regardless of whether the root layout's `resolveNavigation()`, the module layout's `ModulePageGuard`, or both run in the same request — down from what would otherwise have been two independent copies of each query (one per layout level). `getSessionContext()` is similarly memoized so the module-layout guard's `requireWorkspace()` call doesn't re-run the session-token DB lookup the root layout already made. No new caching crosses request boundaries (verified: `React.cache()` is request-scoped only, not a global/module-level cache) and no caching was added anywhere a same-request mutate-then-read pattern exists (checked: `getBillingSummary`'s callers are all read-only routes; billing mutations live in dedicated checkout/cancel endpoints never called in the same request).

## 16. Tests Added

Three new files, 32 tests, `apps/web/tests/`:

- `navigation-registry.test.mjs` (17 tests) — Part 29 registry invariants (12 canonical moduleIds matching `ERP_MODULE_CATALOG` exactly, every module starts with an exact-match Overview item, no CRUD-verb labels, no platform/module id collisions, `resolveNavigation`'s fail-closed catch block, module-group/permission filtering source patterns, route-validation wiring) plus **real behavioral tests** (not just source patterns) for `matchesPath()` and `moduleIdForPath()` — both are zero-dependency pure functions, safe to actually transpile and execute (see the file's own comment on why the registry data files, which transitively import `next/headers` via `@/lib/authorization` → `@/lib/auth`, are instead verified via static source patterns, consistent with Prompt 4/5's established precedent for anything auth/DB-adjacent).
- `navigation-authorization.test.mjs` (12 tests) — Part 30 (module-group removal before item-level filtering, items within an accessible module still individually permission-filtered, Administration/Workspace-settings filtered like every other section, CRM record-scope security untouched) and Part 32 (all 12 module layouts wrap children in `ModulePageGuard` with the correct `moduleId`, CRM's guard survives alongside `CrmSectionTabs`, the guard fails closed with exactly one denial path and one success path, `ModuleAccessDenied` has non-leaking copy for all four reasons, the admin module-management route is unaffected, unknown routes never resolve to a module).
- `navigation-expansion.test.mjs` (7 tests) — Part 11/31 (single coordinated `expanded` state, opening one module closes all others by construction, route-derived not label-derived, global sections stay independently managed, no duplicate `matchesPath` implementations remain in any of the three consuming components, `aria-expanded` present).

`apps/web/tests/enterprise-rbac.test.mjs`'s pre-existing "role catalogue visibility is separate from role mutation" test was updated (not weakened) to read `navigation/administration.ts` instead of `app-shell.tsx` — the underlying assertion (roles nav gated by `PERMISSIONS.rolesView`) is unchanged, only the source file the data now lives in.

## 17. Verification Results

| Command | Result |
|---|---|
| `pnpm --filter @vercentlabs/web typecheck` | PASS |
| `pnpm --filter @vercentlabs/web lint` | PASS (1 pre-existing, unrelated warning) |
| `pnpm --filter @vercentlabs/web test` | PASS — 93/93 (58 pre-existing + 35 new) |
| `node apps/web/scripts/verify-routes.mjs` | PASS — 116 page.tsx, 279 route.ts, **121 navigation registry hrefs**, 0 failures |
| `pnpm verify:web` (typecheck + lint + test:web + test:api + verify:routes + **build**) | PASS — exit 0. The production build (`next build`) is the check that actually caught a real defect: `breadcrumbs.tsx` ("use client") transitively imported `PERMISSIONS` from `authorization.ts`, which also exports session/DB-touching functions requiring `@/lib/auth` → `@/lib/db` → `pg`/`node:async_hooks` — unbundleable for the browser. Fixed by extracting `PERMISSIONS` into a new, zero-`@/lib/auth`-dependency file, `permissions-catalog.ts` (Section 18) |
| `pnpm verify` (verify:fast + verify:routes + verify:mobile + verify:db + test:sdk + test:packages + test:integration + test:security + test:enterprise-rbac) | PASS — exit 0, re-run after the `permissions-catalog.ts` fix to confirm the `authorization.ts` surgery didn't affect any of its ~200 other call sites |
| `pnpm release:verify` | FAIL — but only on the same pre-existing, documented `apps/landing` mobile-CSS horizontal-overflow defect first identified in Prompt 4 (`tests/e2e/mobile-conversion.spec.ts`, failing on `/` and `/book-demo` at 320-412px viewports, plus 2 dependent visual-review snapshots) — 636/658 landing e2e tests passed; zero `apps/web`/ERP failures. `apps/landing` was not touched by this prompt. A stale `.next/dev/types` artifact in `apps/landing` (unrelated leftover, gitignored) caused one intermediate run to fail at `typecheck:landing` instead — cleared and re-run to reach this accurate result, per the same diagnostic pattern documented in Prompt 4 |

## 18. Known Gaps

- **P1** — Section 11's Route Gap Matrix: several target-IA destinations (My Work's Tasks/Exceptions/Recent/Favourites, Governance's Compliance, Administration's Automation/Reports/Integrations/Data Management, and each module's deeper aspirational capability trees) have no real route yet. Intentional per Part 8 — tracked for future module-completion prompts, not fabricated here.
- **P2** — `crm-section-tabs.tsx`'s `crmAreas` remains a second, hand-maintained (if differently-shaped) route-label source for CRM's in-page tab strip. Reviewed and intentionally not touched (Section 13) — a future CRM visual-convergence prompt should decide whether to derive it from the registry too.
- **P2** — The breadcrumb label map is still segment-keyed, not full-path-keyed, so a route segment shared by two different route roots (`assets`) can only carry one label — a pre-existing limitation preserved exactly, not introduced or fixed by this prompt.
- **P3** — `ModuleContextBar`'s `quickActions` map (CRM/Sales/Procurement/Accounting "create" shortcuts) is a separate small hardcoded map, out of scope for this prompt (it's an action-shortcut concept, not navigation destination data — Part 35 explicitly defers Quick Create's architecture).

## 19. Files Changed

**New:**
- `apps/web/src/lib/navigation/{types,workspace,my-work,governance,administration,modules,match-path,route-map,resolve-navigation,breadcrumb-labels,index}.ts` (11 files)
- `apps/web/src/lib/permissions-catalog.ts` (extracted from `authorization.ts` — Section 17's client-bundle fix)
- `apps/web/src/components/{module-page-guard,module-access-denied,sidebar-modules}.tsx` (3 files)
- `apps/web/src/app/(app)/{sales,accounting,procurement,stock,manufacturing,projects,assets,point-of-sale,quality,support,hr-payroll}/layout.tsx` (11 files)
- `apps/web/tests/{navigation-registry,navigation-authorization,navigation-expansion}.test.mjs` (3 files)
- `docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md`

**Modified:**
- `apps/web/src/components/app-shell.tsx` (registry-driven, no inline arrays, accepts resolved `navigation` prop)
- `apps/web/src/app/(app)/layout.tsx` (calls `resolveNavigation()`)
- `apps/web/src/app/(app)/crm/layout.tsx` (adds `ModulePageGuard`)
- `apps/web/src/components/navigation-link.tsx`, `navigation-section.tsx`, `module-context-bar.tsx` (shared `matchesPath()`; `navigation-section.tsx` also gains controlled `open`/`onOpenChange`)
- `apps/web/src/components/breadcrumbs.tsx` (registry-derived labels)
- `apps/web/src/lib/authorization.ts` (`PERMISSIONS` now re-exported from `permissions-catalog.ts` instead of defined inline — same public API, ~200 existing call sites unaffected)
- `apps/web/src/lib/auth.ts` (`getSessionContext` wrapped in `React.cache()`)
- `apps/web/src/lib/module-access.ts` (`getEnabledModuleKeys` wrapped in `React.cache()`)
- `apps/web/src/lib/billing.ts` (`getBillingSummary` wrapped in `React.cache()`)
- `apps/web/src/app/globals.css` (small `.module-access-denied` addendum to the existing `.empty-state` pattern)
- `apps/web/scripts/verify-routes.mjs` (navigation href validation)
- `apps/web/tests/enterprise-rbac.test.mjs` (one test's source-file target updated)

**Unchanged (confirmed, not merely assumed):** every Prompt 3/5 security control; `services/api/src/**`; the module/role catalogue from Prompt 4; `crm-section-tabs.tsx`'s own logic (only its layout wrapper changed); all 116 `page.tsx` files (gated at the layout level, not individually).
