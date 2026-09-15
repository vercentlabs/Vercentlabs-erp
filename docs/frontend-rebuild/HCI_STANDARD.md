# Vercentlabs ERP — HCI Standard

Enforceable interaction rules for every screen built on
`packages/design-system`. This is not a theory document — each rule names
the component or pattern that implements it, so a reviewer can check
compliance by reading the screen's code, not by re-deriving the rule from
first principles. It complements, and does not duplicate,
`docs/01-standards/ACCESSIBILITY_STANDARD.md`,
`docs/01-standards/UX_STANDARD.md`, `docs/01-standards/RESPONSIVE_STANDARD.md`,
and `docs/01-standards/EXPERIENCE_KERNEL_STANDARD.md` — those set the
requirements; this sets how to meet them with the actual component set.

## Actions

**Primary action.** Every page has at most one visually-dominant
(`variant="primary"`) action — `PageHeader`/`RecordHeader`'s
`primaryAction` slot, not a second primary button loose in the page body.

**Secondary actions.** `variant="secondary"`/`"outline"`/`"ghost"`, or an
overflow `Menu` once there are more than ~3. Never more than one
`variant="danger"` button visible on a page outside a confirmation.

**Danger actions never fire directly from a click.** A `variant="danger"`
`Button`'s `onPress` opens an `AlertDialog`; the mutation happens in
`AlertDialog`'s `onConfirm`, never in the triggering button. See
"Destructive vs. corrective" below for when danger styling is the wrong
choice entirely.

**Icon-only actions require a label.** `IconButton`/`IconLinkButton`'s
`aria-label` is a required prop at the type level — this isn't a
convention, the component doesn't compile without it.

## Forms

Build on `useAppForm` (`packages/design-system/src/forms`), not a bare
`useState` form or TanStack Form's raw `useForm`. This is what makes the
rest of this section true for free rather than per-feature:

- **Errors surface after touch or submit, never before.** `fields.tsx`'s
  `useFieldErrorMessage` withholds the message until
  `field.state.meta.isTouched || form.state.submissionAttempts > 0`.
- **Submit has a double-submit guard and a loading state for free.**
  `SubmitButton` binds to `isSubmitting`/`canSubmit`/`isDirty`.
- **Server errors are distinct from client validation.** Zod validates
  for usability; `ServerErrorSummary` renders what the backend actually
  rejected, verbatim — never translate a backend rejection into generic
  client copy.
- **Unsaved changes warn on tab close, not on every navigation.**
  `useUnsavedChangesWarning(isDirty)` covers `beforeunload`; in-app
  Cancel/Close/Back needs an explicit confirm in the feature screen (the
  router event is Next.js-specific, out of scope for the
  framework-agnostic design-system package). Never show this warning
  after a successful save — flip `isDirty` off first.
- **Read-only and permission-disabled are different states, and look
  different.** `isReadOnly` (viewable, not editable by design — e.g. a
  posted transaction) is not `isDisabled` (temporarily unavailable). Do
  not use `isDisabled` to mean "you lack permission" — see Permission UX.

## Tables

Build on `EnterpriseDataGrid`, not a hand-rolled `<table>`. It owns:
sortable headers as real `<button>`s (keyboard-operable, not
`onClick`-on-a-`div`), a real `<input type="checkbox">` selection column
(confirmed keyboard-operable: Tab focuses it, Space toggles it — verified
directly, not assumed), sticky header, column resize handles, and all
five required states (`loading`/`empty`/`no-results`/`error`/
`permission-denied`) composed from `data-display`'s state components
rather than reinvented per table.

**Bulk actions require a visible, exact count and an explicit clear.**
`BulkActionBar`'s `selectedCount` and `onClearSelection` are required
props — never let a user trigger a bulk action unsure how many records
it affects.

**Row actions are always also reachable without the grid.** A
`rowActions` menu is a shortcut; the same action must exist on the
record's own detail page (`RecordHeader`/`RecordDetailsPage`) too.

## Keyboard and focus

Every interactive primitive in `packages/design-system` is built on React
Aria Components specifically because it gets this right by construction:
real focus management in `Dialog`/`AlertDialog`/`Drawer` (focus enters on
open, restores to the trigger on close), `data-focus-visible` styling
(not a permanent focus ring, not a suppressed one), and native semantics
for every control. **Do not build a new interactive primitive without
React Aria underneath it** — that's the anti-drift rule from
`TECH_STACK_ADR_003_PRIMITIVE_LIBRARY_CORRECTION.md`, not a suggestion.

`ContextMenuTrigger` (right-click / long-press) is a shortcut. Its
action set must also exist via a visible affordance — a context menu is
never the *only* way to reach an action, per the non-pointer-only rule in
`ACCESSIBILITY_STANDARD.md`.

## Confirmation and destructive vs. corrective actions

**Every irreversible or financially-consequential action confirms via
`AlertDialog`** with a `description` that states the actual consequence
in plain language ("This permanently removes the lead and its activity
history"), not a generic "Are you sure?".

**Most ERP records should not expose "Delete" as the default destructive
verb.** Prefer the domain-correct action — Cancel, Reverse, Void, Archive,
Close, Reopen, Amend, Credit, Return, Write off — and use `AlertDialog`
`tone="danger"` for these too when they're consequential, even though
they aren't literal deletion. Reserve actual "Delete" for records that
genuinely have no downstream consequence (a draft never submitted, an
attachment).

## Errors and server failures

Four distinct surfaces exist — do not substitute one for another:

| Situation | Component |
|---|---|
| Field failed client (Zod) validation | Field's own `errorMessage` (inline, next to the field) |
| Backend rejected the whole submission (business rule, authorization) | `ServerErrorSummary` |
| A list/grid/section failed to load | `ErrorState` (via `EnterpriseDataGrid`'s `state="error"` or standalone) |
| The user lacks permission for a record/action they otherwise expect to see | `PermissionState` — see Permission UX; this is not an error |

## Concurrency, staleness, and conflicts

- **Someone else changed this record since it loaded:** `ConflictBanner`,
  always with a `Reload` action. Never let a save silently overwrite a
  change the user hasn't seen — this is a real, previously-shipped defect
  class (see the CRM checked-write concurrency fix in this repo's git
  history) and the reason this component exists.
- **A read-only view (dashboard, report) may be stale:** `StaleDataBanner`
  with a pre-formatted `lastUpdated` and a `Refresh` action — distinct
  from `ConflictBanner`, which is about one record having changed, not a
  view aging generally.
- **Offline:** `OfflineBanner` stays visible for the whole duration
  offline — never a toast that disappears while the user is still
  offline. Report the pending-change count when there is one.

## Error-prevention: context correctness

ERP mistakes are expensive precisely because the record is unambiguous
but the *context* was wrong. Every transactional screen must make the
following visible before an irreversible submit, not just recoverable
after:

- Organization / legal entity / branch / warehouse the record belongs to
- Accounting period (and whether it's open or closed — a closed-period
  submit must be blocked with an explanation, not a generic error)
- Currency (for anything using `MoneyField` — the field requires a
  `currency` prop for exactly this reason, it cannot silently default)
- Unit of measure (`QuantityField`'s `uom` — shown, not assumed)
- Record lifecycle state (an invalid state transition — e.g. approving an
  already-cancelled document — is a validation error shown inline, not a
  silent no-op)
- Duplicate-record risk, where the domain has a known collision pattern —
  surface it before submit, don't rely on the backend rejecting it after

## Permission UX

Five distinct behaviors — the permission MODEL decides which applies to
a given user/action/field, but the frontend must render the behavior
correctly once told:

| Behavior | When | How |
|---|---|---|
| **Hidden** | Knowing the capability exists would itself be inappropriate | Don't render the control at all |
| **Disabled with explanation** | User may understand the capability exists but lacks authority | Render disabled + a reason (tooltip or inline text), not a bare greyed-out control |
| **Read-only** | Viewable, not editable, regardless of authority | Field's `isReadOnly`, not `isDisabled` |
| **Masked** | Value exists but is sensitive | Render a masked placeholder (`••••`), not the real value with `isDisabled` styling — those are different threats |
| **Approval required** | User may initiate but not authorize | The action submits into an approval flow (`ApprovalTimeline` shows it), the button label says so ("Submit for approval", not "Save") |

A screen that can't see a record/section at all (not a specific field)
uses `PermissionState`, not an empty list or a silent redirect.

## Background jobs

Long-running async work (import, export, payroll run, mass update,
integration sync) uses `BackgroundJobProgress` with a real status from
the backend (`queued`/`running`/`completed`/`completed_with_errors`/
`failed`) — **never render a synchronous "Success" toast for work that is
actually still queued.** `completed_with_errors` is a distinct status
from `completed`; it must expose "View errors", not be folded into a
generic success state.

## Saved views, breadcrumbs, return-to-work

- `SavedViewBar` changes the active query; it is not a page-content
  switch (`Tabs` is, for record sections).
- `Breadcrumbs`/`Breadcrumb` mark the current page with `isCurrent`
  (plain text, `aria-current="page"`), never a dead link to the current
  page.
- A user returning to a list after visiting a record should land back on
  the same saved view/filter/page/scroll position they left — this is a
  feature-screen state-persistence responsibility (e.g. URL search
  params), not something the design-system components do automatically.

## Cross-module handoff and audit visibility

- A record's lineage into other modules (Lead → Opportunity → Quotation →
  …) renders via `RelatedBusinessFlow`, not a bespoke breadcrumb-like
  widget per module.
- Same-type related records (an account's contacts, an order's
  deliveries) render via `RelatedRecords` — a flat list, distinct from
  the staged lineage above.
- Audit/history renders via `AuditTimeline` (the shared `Timeline`
  implementation) — do not build a second timeline component for this;
  see `ActivityTimeline`/`ApprovalTimeline` for the other two semantic
  uses of the same component.

## Empty states

Three distinct empty situations, three distinct components — conflating
them tells the user the wrong thing about what to do next:

- **Nothing created yet:** `EmptyState` (e.g. "No leads yet" + a Create
  action)
- **A filter/search matched nothing:** `NoResultsState` (always paired
  with a way to clear the filter)
- **The request failed:** `ErrorState` (a Retry action, not a Create
  action)

## Responsive and mobile

- Every screen must define desktop/tablet/phone behavior or explicitly
  mark a workflow not-applicable at a given size — per
  `RESPONSIVE_STANDARD.md`. `EnterpriseDataGrid`'s `renderMobileCard` is
  the opt-in mechanism for tables that are a primary mobile workflow;
  tables that are desktop-primary may rely on horizontal scroll instead
  — that's a per-screen judgment call, not a default to avoid making.
- Touch targets meet the `packages/design-tokens` minimums (44px web,
  48px native) — `touchTarget.web`/`touchTarget.native` — verified by a
  real unit test in `packages/design-tokens/src/tokens.test.ts`, not
  hoped for.
- No drag-only interaction ships without a non-drag alternative
  (`ContextMenuTrigger`'s note above applies to drag-and-drop equally).

## What "done" looks like for a screen

Before calling a screen built on these patterns complete, it should be
able to answer, for a reviewer reading the code: What am I looking at?
What needs my attention? What is the next primary action? What is the
current status? What related business process am I in? What changed?
What am I allowed to do? What will happen if I take this action? If a
component from this system doesn't make the answer obvious in the
rendered UI, that's a defect in how it was used, not a reason to bypass
the system.
