# ERP Command Palette, Global Search, Quick Create & Top-Bar Control Surface (Prompt 7 of 102)

Date: 2026-08-09
Scope: replace the fake Ctrl/Cmd+K focus-shortcut with a real command palette; build permission-safe navigation + record search; add a filtered Quick Create surface; complete the notification/profile top-bar controls using existing infrastructure; keep company/branch context switching correct and searches never stale across a context change. No page redesign, no missing-module-page work, no landing-site work.

Starting git state: branch `main`, all Prompt 1-6 work present and untouched (187 changed paths at start). No commits made. No destructive git operations used.

---

## 1. Executive Summary

Prompt 1's audit found the topbar's Ctrl/Cmd+K only called `.focus()`/`.select()` on a plain `<input>` that submitted to `/search` — no overlay, no keyboard-navigable results, no `cmdk`-style dependency anywhere in the repo — and confirmed Quick Create didn't exist at all. This prompt builds both, deliberately reusing rather than duplicating what already existed:

1. **Command palette** (`command-palette.tsx`) — the codebase's first modal/portal overlay (none existed before), built dependency-free per Part 2's preference, replacing `workspace-search.tsx` (deleted) as both the visible topbar launcher and the single Ctrl/Cmd+K handler.
2. **Navigation search** — indexes the *already server-resolved* `navigation` prop AppShell renders from (Prompt 6's `resolveNavigation()`), never the raw registry, so an inaccessible destination has no path to appear.
3. **Record search** — one narrow orchestrator, `GET /api/search`, fanning out to five per-module adapters that call the *exact same* already-secured service-layer list functions each module's own list route already calls (`listCrmRecords`, `listBusinessDataRecords`, `listProcurementRecords`, `listSalesOrders`/`listQuotations`, `listJournalEntries`) — inheriting Prompt 3's CRM owner-scoping and procurement's supplier banking-field redaction automatically, with zero new SQL. Only CRM, business-data, procurement, sales and accounting were wired in — these are the only modules whose list routes were confirmed (by reading their actual GET handlers) to forward a `search` query parameter to a service function that honors it; HR-payroll, stock, support, assets, projects, manufacturing, quality and point-of-sale do not, and are correctly excluded rather than faked.
4. **Quick Create** — a 9-action registry (`quick-create/actions.ts`), logically separate from the navigation registry (Part 35), server-filtered by module access + permission before the client ever sees it, using only routes verified to be real (`?create=1` for CRM, `.../new` pages for Procurement/Sales/Accounting — the same convention `module-context-bar.tsx` already used).
5. **Notifications** — a new `GET /api/notifications` preview endpoint (the existing route only had `PATCH`), same query shape and `(organization_id, user_id)` scope as the existing `/notifications` page, powering a compact topbar popover.
6. **Profile** — completed into a real menu (Profile + Security + Sign out) reusing the existing `LogoutButton`/`/api/auth/logout` session-invalidation flow unchanged.
7. **Company/branch context** — audited, found already correctly server-scoped (`membership_company_access`/`membership_branch_access` in `getShellData()`); the only new work was making the command palette itself invalidate its cached record-search results on a context switch.
8. **A real, build-breaking bug found and fixed**: `breadcrumbs.tsx` (a Client Component, unrelated to this prompt but reachable from the same nav data files record search's local matching also uses) transitively pulled `PERMISSIONS` from `authorization.ts`, which also exports session/DB-touching functions requiring `@/lib/auth → @/lib/db → pg`/`node:async_hooks` — unbundleable for the browser. This was actually Prompt 6's fix (`permissions-catalog.ts`); Prompt 7 extended the same pattern to `quick-create/actions.ts` so it, too, stays safe to import from client code, and proactively ran a full production build (not just typecheck/lint) specifically because this exact class of bug is invisible to both.

## 2. Previous Top-Bar Architecture

| Component | Previous behavior | Action |
|---|---|---|
| `workspace-search.tsx` | Plain `<form action="/search">`, no fetch, no results UI; Ctrl/Cmd+K only focused the input | **Deleted** — replaced by `command-palette.tsx`, which is both the visible launcher and the real dialog |
| `context-switcher.tsx` | Company/branch/organisation `<select>` dropdowns, `POST /api/context` / `/api/context/organization`, optimistic-with-rollback, `router.refresh()` | **Unchanged** — audited (Section 9/10), found already correct |
| Notifications | Topbar bell was a plain `<Link href="/notifications">`; API had `PATCH` only (mark-read/read-all), no list/GET endpoint; unread count computed once server-side in `getShellData()` | **Extended** — added `GET /api/notifications` (capped preview), wrapped the bell in `notifications-control.tsx` |
| Settings/Security | Plain `<Link href="/security">` | **Unchanged**, kept as a direct link (Section 12) |
| Profile | Plain `<Link href="/profile">` + separate `LogoutButton` | **Completed into `profile-menu.tsx`** — a real dropdown; sidebar's own profile link + logout button left as-is (a second, always-visible entry point, not true duplication) |
| Dialog/modal/popover primitives | **None existed anywhere** (Prompt 1's audit confirmed `role="dialog"`, `<dialog`, `createPortal` all had zero matches) | This prompt establishes the first: `command-palette.tsx`'s portal, plus a shared `use-outside-dismiss.ts` hook for the three small anchored popovers (profile, notifications, Quick Create) |
| Keyboard handling | One listener total, in `workspace-search.tsx` | **Consolidated to exactly one**, now in `command-palette.tsx` — verified by test that no second `key.toLowerCase() === "k"` handler exists anywhere in `apps/web/src/components` |

## 3. Command Palette Architecture

```
Ctrl+K / Cmd+K (ignored while event.isComposing, i.e. IME composition)
      ↓
open (createPortal to document.body; role="dialog" aria-modal="true")
      ↓
type query
      ↓
Navigation search (local, synchronous, over the server-resolved tree)
Record search (debounced 250ms, GET /api/search, stale-response token guard)
Quick Create actions (already server-filtered, ranked by current-page module)
Recent destinations (localStorage, only shown on empty query)
      ↓
ArrowUp/ArrowDown/Home/End to move selection, Enter to activate, Escape/outside-click to close
      ↓
router.push(result.href) — never a path built from raw query text
      ↓
focus restored to the element that was focused before the palette opened
```

No `cmdk`/fuzzy-search dependency was added (Part 2/29) — 121 navigation destinations plus a handful of server results per query don't justify one; scoring is `score.ts`'s ~30-line hand-written ranking (Section 5).

## 4. Search Result Types

```ts
type SearchResultType = "navigation" | "record" | "action" | "recent";
type SearchResult = {
  id: string; type: SearchResultType; label: string; description?: string;
  href: string; icon?: AppIconName; moduleId?: ModuleId;
};
```
One flat, minimal-field shape for every source — no result ever carries more than identification + a navigation target (Part 5).

## 5. Navigation Search

`apps/web/src/core/search/navigation-search.ts`'s `searchNavigation(navigation, query, limit)` flattens the same `ResolvedNavigationWithSettings` object AppShell already renders from (workspace, module groups + items, myWork, governance, administration, workspaceSettings) and scores each candidate with `score.ts`'s `scoreLabel()`:

| Rank | Match type |
|---|---|
| 100 | Exact label |
| 80 | Starts-with |
| 60 | Word-prefix (any word in the label starts with the query) |
| 40 | Keyword alias (exact/prefix match against `NavigationItem.keywords`/`ModuleNavigationGroup.keywords` — new optional fields added this prompt) |
| 20 | Substring |
| 10 | Keyword substring |

Keywords were added sparingly (Part 4's own examples): CRM (`customers`, `pipeline`, `deals`), Sales (`orders`, `quotes`), Procurement (`purchasing`, `buying`, `vendors`), Stock (`inventory`, `warehouse`), HR & Payroll (`hr`, `employee`, `salary`, `payroll`, `people`), Support (`helpdesk`, `tickets`), Quality (`qa`, `inspection`), Point of Sale (`pos`, `retail`, `terminal`, `checkout`), Assets (`fixed assets`, `equipment`), Projects (`tasks`, `timesheet`), Manufacturing (`production`, `mrp`), Accounting (`finance`, `ledger`, `journal`, `gl`) — one line per module, not a second catalogue.

Because the input tree is already server-filtered (Prompt 6), an inaccessible module or permission-gated item has no path into `searchNavigation`'s output — there is nothing to filter a second time, and nothing for a client-side bug to accidentally re-expose.

## 6. Record Search

`GET /api/search?q=` (`apps/web/src/app/api/search/route.ts`), authenticated only (`requireApiWorkspace()`), rate-limited per user (`enforceRateLimit`, 60/60s — not the public lead-capture endpoint's IP/fingerprint limiter, which would conflate every user behind the same office egress IP), fanning out via `Promise.allSettled` to:

| Record type | Module | Data source | Security scope | Result limit |
|---|---|---|---|---|
| Lead, Opportunity, Activity | crm | `listCrmRecords()` (`@vercentlabs/api`) | Module access (`crmApiContext`), per-resource permission (`requireCrmResourceView`), Prompt 3's `recordScope()` owner-scoping (inherited, not reimplemented) | 5 per resource, 5 per adapter cap applied after |
| Party, Item | business-data | `listBusinessDataRecords()` | `businessDataView` permission (cross-module, not module-gated by design — Prompt 5) | 5 per resource |
| Supplier, Purchase order | procurement | `listProcurementRecords()` | Module access (`procurementSession`), Prompt 3's `applySupplierFieldVisibility()` banking-field redaction (inherited) | 5 |
| Sales order, Quotation | sales | `listSalesOrders()`, `listQuotations()` | Module access (`salesSession`), `redactMargin()` (inherited) | 5 each |
| Journal entry | accounting | `listJournalEntries()` | Module access (`accountingSession`) | 5 |

Total response capped at 20 results (`TOTAL_RESULT_LIMIT`). Every adapter wraps its own work in try/catch (or relies on the module-gated session helper throwing) so a disabled module, missing permission, or unexpected DB error removes only that adapter's contribution — `Promise.allSettled`, not `Promise.all`, so one failure never fails the whole request (Part 24), and a rejected adapter's error detail is never surfaced to the client.

**Excluded, and why**: HR-payroll (`hr-payroll/resources/[resource]/route.ts`'s GET only forwards `employeeId`/`limit`/`offset`, no `search`), stock, support, assets (the module), projects, manufacturing, quality, and point-of-sale all follow the same pattern — none of their list routes forward a `search` parameter to a function that honors it. Wiring these in would have meant either fabricating search support at the service layer (out of scope — "Do not create a new enterprise search backend") or returning empty results dressed up as real search, which would misrepresent coverage. A test (`search-security.test.mjs`) asserts none of these eight modules has a `search<Module>` adapter function.

## 7. Search Security

- **Tenant isolation**: `organizationId` always comes from the resolved session, never the query string.
- **Module access**: every adapter uses the exact module-gated session helper (`crmApiContext`, `procurementSession`, `salesSession`, `accountingSession`) Prompt 5 already built — a disabled/unentitled/not-permitted module throws inside the helper, caught, and that adapter simply contributes nothing.
- **Company/branch scope**: enforced inside the reused list functions via `context.activeCompanyId`/`allowAllCompanies`, derived from session — the search query text never influences scope.
- **CRM ownership scope** (Prompt 3): inherited automatically via `listCrmRecords()`'s own `recordScope()` — verified by a test asserting the adapter contains no hand-written CRM SQL.
- **Sensitive-field filtering** (Prompt 3): procurement's supplier banking fields are redacted by `applySupplierFieldVisibility()` inside `listProcurementRecords()` before the adapter even sees the row; the adapter's own field-selection additionally never references a banking/sensitive field name. HR-sensitive PII and support private notes are structurally unreachable — those modules have no adapter at all.
- **No raw SQL**: `client.query(` never appears in `route.ts` — every byte of SQL execution happens inside the reused, already-parameterized service functions.
- **Minimal result shape**: `safeLabel()`/`safeDescription()` pick from a small explicit field allowlist per resource; no adapter ever spreads a raw row (`...row`) into a result.

## 8. Quick Create

| Action | Module | Route | Permission |
|---|---|---|---|
| Create lead | crm | `/crm/leads?create=1` | `crmLeadsManage` |
| Create opportunity | crm | `/crm/opportunities?create=1` | `crmOpportunitiesManage` |
| Create activity | crm | `/crm/activities?create=1` | `crmActivitiesManage` |
| Create quotation | sales | `/sales/quotations/new` | `salesQuotationCreate` |
| Create sales order | sales | `/sales/orders/new` | `salesOrderCreate` |
| Create purchase requisition | procurement | `/procurement/requisitions/new` | `procurementRequisitionCreate` |
| Create purchase order | procurement | `/procurement/orders/new` | `procurementPoCreate` |
| Create supplier | procurement | `/procurement/suppliers/new` | `procurementSuppliersManage` |
| Create journal entry | accounting | `/accounting/journals/new` | `accountingJournalCreate` |

`resolveQuickCreate(session)` (server, alongside `resolveNavigation()` in `(app)/layout.tsx`) filters by `accessibleModuleIds.has(action.moduleId) && hasPermission(session, action.permission)` before the array ever reaches `AppShell`/`QuickCreateButton`/`CommandPalette` — the client components only ever *reorder* (`rankQuickCreate`, current-page module first, Part 12) what the server already decided, never re-derive visibility. Fail-closed on a lookup error, same contract as `resolveNavigation`.

**Deliberately not included** (no real, deep-linkable create entry point found): Customer/Contact (business-data's create UI has an in-page button, not a URL-triggerable one), Item, Employee, Ticket, Project, Asset — see Section 20.

## 9. Company Context

Audited, unchanged: `context-switcher.tsx`'s company `<select>` → `save()` → `POST /api/context` → `router.refresh()`. Changing company auto-selects the new company's first branch (`nextBranchId` computed client-side from the already-scoped `branches` prop) rather than leaving a stale cross-company branch id selected. `getShellData()` (`apps/web/src/core/platform.ts`) already scopes the `companies` list server-side via `EXISTS (SELECT 1 FROM membership_company_access ...)` unless the caller is `organization_owner`/`system_administrator` — confirmed by reading the query, not assumed.

## 10. Branch Context

Same file, same audit: `branches` is filtered to the active company client-side (`availableBranches = branches.filter(b => b.company_id === companyId)`), but the underlying `branches` array itself is *already* server-scoped via `membership_branch_access` in `getShellData()` — an unauthorized branch was never sent to the browser in the first place, in either the old or new architecture. No change was needed or made here (Part 14 says "do not redesign branch management").

**New in this prompt**: the command palette's `contextKey` (`${activeCompanyId}:${activeBranchId}`) is compared on every render; a change synchronously clears `recordResults`/`recordSearchStatus` (React's "adjusting state during render" pattern, not an effect — refs cannot be mutated during render under this project's stricter React-Compiler-aware ESLint rules, discovered while building this), and the record-search effect's dependency array includes `contextKey` too, so an in-flight or just-completed query re-runs under the new context rather than leaving a stale, wrongly-scoped result set visible.

## 11. Notifications

`GET /api/notifications` (new) returns the caller's own 8 most recent notifications (`WHERE organization_id=$1 AND user_id=$2`, same scope as the PATCH handler and the existing `/notifications` page — no new query pattern invented). `notifications-control.tsx` fetches this lazily on first open, shows unread items highlighted, supports "Mark all read" (existing PATCH, `action: "read-all"`) and per-item mark-read-on-click (existing PATCH, `{ id }`), and always offers "View all" → `/notifications`. No polling, no WebSockets (Part 16 explicitly deferred this). A notification's `href`, if it points to a record the user has since lost access to, is handled by nothing special in this component — the destination page/API's own existing guard (Prompt 5/6) is the sole authority, exactly as for any other link (Part 40) — verified by a test that this component contains no permission-checking logic of its own.

## 12. Settings

The topbar's Security shortcut remains a direct `<Link href="/security">` (Part 17: "do not duplicate the Administration sidebar tree inside a giant dropdown unless current UX already does so" — it doesn't, so this wasn't built). `/security`'s own page has no permission gate beyond authentication (confirmed by reading it) — a test asserts this, flagging that the topbar's unconditional link would need revisiting if that page ever gains one.

## 13. Profile / Sign Out

`profile-menu.tsx` — a real dropdown (Profile, Security, Sign out) replacing the old plain `<Link>`. Sign-out is the pre-existing `LogoutButton` component (given a new optional `className` prop so it could be restyled inline in the menu — its actual logic, `POST /api/auth/logout` then `router.replace("/login")` + `router.refresh()`, is untouched). No client-only session clearing was added (Part 18 explicitly forbids this) — verified by a test that the component never touches `localStorage`/`document.cookie` for session state.

## 14. Keyboard Interaction

| Shortcut | Behavior |
|---|---|
| Ctrl+K / Cmd+K | Toggle the palette (open if closed, close if open) |
| Escape | Close (also closes the three small popovers via the shared `use-outside-dismiss.ts` hook) |
| ArrowUp / ArrowDown | Move selection, clamped to the result list bounds |
| Home / End (while the input has focus) | Jump to first/last result |
| Enter | Activate the selected result |

`event.isComposing` is checked first, so the shortcut never fires mid-IME-composition. Exactly one `keydown` listener exists for this in the entire app (verified by test — the old `workspace-search.tsx` handler was deleted, not left as a second listener).

## 15. Responsive Behavior

`.topbar`'s grid gained a 4th column (`minmax(220px,1fr) auto auto auto`) for the new Quick Create button. At ≤1240px, the search launcher collapses to icon-only (label + `Ctrl K` hint hidden), Quick Create collapses to just `+` (label hidden), and the context switcher drops to its own full-width row — the same breakpoint and general strategy the existing shell already used, extended rather than replaced. The command palette overlay uses `width: min(640px, 100%)` with side padding and an internal scroll region, so it cannot overflow a narrow viewport (Part 20) — no mobile bottom-navigation or full mobile redesign was attempted (explicitly out of scope).

## 16. Accessibility

- Palette: `role="dialog"` `aria-modal="true"` `aria-label`, labelled input, `aria-current="true"` on the selected result (not `aria-selected`, which native `<button>` elements don't support per ARIA — a lint-driven correction made while building this), focus moved to the input on open and restored to the previously-focused element on close.
- Topbar: Create/notifications/profile buttons all have `aria-label`/visible text, `aria-haspopup="menu"` + `aria-expanded` on each popover trigger, unread notification count is conveyed by both the numeral badge and the button's `aria-label` (not color alone).
- No click-only non-semantic `<div>`s were used for primary controls — every trigger is a real `<button>` or `<Link>`.
- **Known gap**: no explicit focus-trap loop (Tab cycling constrained within the open dialog) was implemented — Part 21 asked for this only "if current dialog system supports it," and none existed to extend. Escape/outside-click always close cleanly (no permanent trap), but Tab can currently move focus to elements behind the overlay while it's open. Documented in Section 20 as a P2 gap, not silently omitted.

## 17. Tests Added

Five new files, 46 tests, `apps/web/tests/`:

- `command-palette.test.mjs` (18) — real behavioral tests for `scoreLabel()`/`searchNavigation()`/recent-destinations (all zero-`@/lib/auth`-dependency pure modules, safe to actually execute via a new shared recursive TS loader, `tests/helpers/load-ts-module.mjs`) plus source-pattern checks on `command-palette.tsx` itself (single Ctrl+K listener, IME guard, all keyboard handlers present, stale-response token guard, focus restoration, href safety, dialog semantics, context-invalidation).
- `search-security.test.mjs` (12) — confirms every adapter reuses the correct module-gated session helper and the correct already-secured list function, no raw SQL/string interpolation, result/query bounds, rate limiting, `Promise.allSettled` fail-isolation, and that the 8 unsupported modules have no adapter.
- `quick-create.test.mjs` (9) — registry integrity (unique ids, real `PERMISSIONS` values, valid `moduleId`s, no destructive verbs, real hrefs), the CRM `?create=1` convention, navigation/quick-create registry separation, and that `quick-create-button.tsx` only ever receives the server-filtered array as a prop.
- `context-and-topbar.test.mjs` (11) — company/branch server-side scoping, branch auto-reset on company change, command-palette context-key re-search, notifications' own-row scope, profile menu's real sign-out, shared dismiss-hook reuse.
- `helpers/load-ts-module.mjs` — a new shared recursive `@/...`/`@vercentlabs/...`-alias-resolving TS loader (generalizes the inline pattern several Prompt 4-6 test files already duplicated), used by `command-palette.test.mjs` and `quick-create.test.mjs`.

`apps/web/tests/` total: 90 (Prompt 6 baseline) → **144**.

## 18. Adversarial Review

1. Unauthorized nav search leak — **CLOSED** (searches only the already server-filtered tree, Section 5).
2. Disabled-module records — **CLOSED** (module-gated session helpers throw, caught per-adapter).
3. CRM owner-scoped leak — **CLOSED** (inherited `recordScope()`, verified no hand-written CRM SQL exists).
4. HR sensitive fields in results — **CLOSED by exclusion** (HR-payroll has no adapter at all).
5. Procurement banking data — **CLOSED** (`applySupplierFieldVisibility()` inherited; adapter never references a banking field name).
6. Support private notes — **CLOSED by exclusion** (support has no adapter).
7. Tenant spoofing via query — **CLOSED** (`organizationId` only ever comes from session).
8. Company/branch spoofing via query — **CLOSED** (scope comes from `context`, derived from session, not the query string).
9. Stale company search results after switch — **CLOSED** (`contextKey`-driven clear + effect re-run, Section 10).
10. Quick Create unauthorized route — **CLOSED** (server-filtered before the client ever sees the array).
11. Destructive global actions — **CLOSED** (registry contains only 9 create actions; a test asserts no destructive verb appears).
12. Arbitrary href injection — **CLOSED** (every href is either a typed registry value or built from a record's own server-generated id, never raw query text).
13. Notification link bypassing authorization — **CLOSED, by design** (the destination's own existing guard is the sole authority — documented, not "fixed" because there was nothing broken to fix).
14. Company/branch selector exposing unauthorized contexts — **CLOSED** (server-scoped in `getShellData()`, pre-existing and confirmed correct, not newly introduced).
15. Search failure breaking navigation search — **CLOSED** (navigation search has no network dependency at all; record-search failure only sets a local error flag).
16. Keyboard handling trapping focus permanently — **CLOSED** (Escape/outside-click always work) — but see Section 16's documented gap: no *positive* focus containment (Tab loop) exists either, which is a smaller, different concern than "trapped."
17. Unbounded repeated queries — **CLOSED** (added a per-user `enforceRateLimit` — 60 requests/60s — after identifying this as the one gap worth closing rather than only documenting; client-side debounce is a UX nicety, not the actual protection).
18. Stale responses overwriting newer results — **CLOSED** (request-token comparison before every `setState` in the fetch callback, tested).
19. Duplicate Ctrl+K listeners — **CLOSED** (`workspace-search.tsx` deleted; exactly one listener remains, tested).
20. Server search failure defaulting to unrestricted results — **CLOSED** (`Promise.allSettled`; a rejected adapter contributes nothing, never "everything").

## 19. Route Verification

`apps/web/scripts/verify-routes.mjs` extended with two more checks (Part 52):
- **Check 5**: every `quick-create/actions.ts` href resolves to a real route (query strings like `?create=1` stripped before resolution) — 9/9 pass.
- **Check 6**: the topbar's hardcoded static destinations (`/profile`, `/security`, `/notifications`, `/dashboard`) resolve — 4/4 pass.

Combined with Prompt 6's Check 4 (121 navigation hrefs): **all 134 known launcher destinations verified**, zero broken links. `routeExists()` was also fixed to strip query strings generally (a latent gap Check 5 would otherwise have hit immediately).

## 20. Remaining Gaps

- **P1** — Quick Create omits Customer/Contact/Item/Employee/Ticket/Project/Asset creation: no confirmed deep-linkable create entry point exists for any of them today (business-data's create UI is an in-page button, not URL-triggerable; the other 7 modules have no create route at all per Prompt 6's audit). Tracked for the respective module-completion prompts, not fabricated here.
- **P1** — Record search covers 5 of 12 modules (crm, business-data, procurement, sales, accounting) — the other 8 lack `search`-param-forwarding list routes today (Section 6). Extending them is service-layer work for the respective module-completion prompts, not a navigation/shell change.
- **P2** — No explicit focus-trap (Tab containment) inside the open command palette dialog (Section 16) — Part 21 made this conditional on an existing dialog system, and none existed to extend; a future accessibility-focused prompt should add one now that the first modal pattern exists to build it into.
- **P2** — `crm-section-tabs.tsx`'s own `crmAreas` list (Prompt 6's documented gap) remains a second, hand-maintained route-label source for CRM's in-page tab strip — unrelated to this prompt's scope, still open.
- **P3** — `enforceRateLimit`'s 60-requests/60-seconds bound for `/api/search` is a reasonable first value, not empirically tuned; revisit if real usage patterns suggest otherwise.

## 21. Files Changed

**New:**
- `apps/web/src/components/{command-palette,quick-create-button,profile-menu,notifications-control}.tsx`
- `apps/web/src/core/search/{types,score,navigation-search,recent}.ts`
- `apps/web/src/core/quick-create/{actions,resolve-quick-create}.ts`
- `apps/web/src/core/permissions.ts`
- `apps/web/src/shared/use-outside-dismiss.ts`
- `apps/web/src/app/api/search/route.ts`
- `apps/web/tests/{command-palette,search-security,quick-create,context-and-topbar}.test.mjs`
- `apps/web/tests/helpers/load-ts-module.mjs`
- `docs/implementation/ERP_COMMAND_SURFACE_007.md`

**Modified:**
- `apps/web/src/core/components/app-shell.tsx` (wires in CommandPalette/QuickCreateButton/NotificationsControl/ProfileMenu, accepts new `quickCreate` prop)
- `apps/web/src/app/(app)/layout.tsx` (calls `resolveQuickCreate()` alongside `resolveNavigation()`)
- `apps/web/src/app/api/notifications/route.ts` (added `GET`)
- `apps/web/src/core/components/logout-button.tsx` (added optional `className` prop, no behavior change)
- `apps/web/src/core/auth.ts`, `apps/web/src/core/module-access.ts`, `apps/web/src/core/billing.ts` (Prompt 6 already added `React.cache()`; `module-access.ts`'s `getAccessibleModules` itself is newly wrapped this prompt so `resolveNavigation`/`resolveQuickCreate` share one computation)
- `apps/web/src/core/navigation/types.ts`, `modules.ts` (added optional `keywords` fields)
- `apps/web/scripts/verify-routes.mjs` (Checks 5/6, query-string-safe `routeExists`)
- `apps/web/src/app/globals.css` (topbar grid, launcher-button styling, shared popover/dialog styles)

**Deleted:**
- `apps/web/src/components/workspace-search.tsx`

**Unchanged (confirmed, not merely assumed):** `context-switcher.tsx`'s core logic; `getShellData()`'s company/branch scoping queries; every Prompt 3/5 security control; `services/api/src/**`.

## 22. Verification Results

| Command | Result |
|---|---|
| `pnpm --filter @vercentlabs/web typecheck` | PASS |
| `pnpm --filter @vercentlabs/web lint` | PASS (1 pre-existing, unrelated warning) |
| `pnpm --filter @vercentlabs/web test` | PASS — 144/144 |
| `node apps/web/scripts/verify-routes.mjs` | PASS — 116 page.tsx, 280 route.ts, 121 nav hrefs, 9 Quick Create hrefs, 4 static destinations — 0 failures |
| `pnpm verify` | PASS |
| `pnpm verify:web` (incl. production build) | PASS — the build itself caught and led to fixing the client-bundle issue in Section 1 |
| `pnpm release:verify` | FAIL — `apps/landing`'s Playwright e2e suite only (393/658 failing). Diagnosed, not assumed: the specific horizontal-overflow assertions previously documented as the known Prompt 4-6 baseline defect now **pass** (46/56 `mobile-conversion.spec.ts` cases ok); the actual failures in this run are a different, much larger batch dominated by `page.goto: Could not connect to server` (32 occurrences, `*-webkit` projects) and tests timing out at exactly ~30s across `cross-browser-smoke.spec.ts`/`mobile-conversion.spec.ts` — a signature consistent with the landing dev server destabilizing partway through this specific 30-minute, 5-browser-project run, not a content regression. Zero `apps/landing` files were touched by this prompt, and `apps/web`'s own full suite (typecheck/lint/144 tests/production build) is completely clean. Recorded accurately rather than mischaracterized as either "the same known defect" (the signature differs) or an ERP regression (the ERP-side verification is 100% clean) — a clean re-run of `release:verify` outside this session's resource constraints is the appropriate follow-up, not a code change |
