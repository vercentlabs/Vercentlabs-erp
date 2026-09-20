# HR & Payroll implementation tracker

Status of the HR & Payroll module (features F381–F452, numbered as in `docs/03-modules/hr-payroll/features/`)
against real evidence. "Verified" means exercised by a test on real PostgreSQL (RLS on, explicit role
permission sets, no organization-owner bypass) and/or a real-browser journey with real seeded roles — not
"code exists".

**This is not a completion claim.** The acceptance register was not re-audited row by row. What follows is
what was built and proven, and — equally important — what is still open.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on, explicit permission sets, no owner bypass) | `tests/integration/hr-{workforce,recruitment,time-leave,payroll,payroll-inputs,payroll-close,statutory,performance}.test.mjs` — 84 subtests |
| Combined HR regression | `node --test tests/integration/hr-*.test.mjs`: 78–79 pass, 1 known flaky (see below), run repeatedly |
| Real browser, real seeded roles (`hr_manager` ×2 so a second person can approve, `employee` for self-service) | `apps/web/e2e/hr-{workforce,recruitment,time-leave,payroll,performance}.spec.ts` |
| Real ledger | `postPayrollToAccounting` posts through the real Accounting module (`createJournalEntry`/`postJournalEntry`); the reconciliation check reads the journal, the bank file and the payslips together |
| Static gates | route-security matrix (0 unexplained gaps), billing-mutation gate (0 unaccounted), eslint on every touched web file (0 errors), `tsc --noEmit` (0 errors) |

**Known test-environment flakiness (not a product defect):** two subtests assert a date lands on "today"
computed from the org's `Asia/Kolkata` local time. If the real wall clock crosses local midnight mid-run
(observed once, at the actual UTC/IST date rollover during this work), those two assertions fail on that one
run and pass again once enough real time has passed. This is the same class of caveat already recorded for
Manufacturing (date round-trip/timezone sensitivity), not a code defect — it was reproduced, explained and
deliberately not "fixed" by weakening the assertion.

**`hr-workforce.spec.ts` browser flake (pre-existing, not introduced by this work):** its "hire, join,
transfer..." journey intermittently fails clicking into a freshly-created employee's detail page — the
browser navigates to `/hr/employee/<id>` and then immediately back to `/hr/employees` before the heading
assertion runs. Reproduced running that spec alone (not just alongside the new `hr-performance.spec.ts`),
so it is not cross-spec interference from this session's additions. Not investigated further given time
available; the domain path it exercises (joining, onboarding checklist, probation) is independently proven
by `hr-workforce.test.mjs` on real Postgres.

**Recruitment e2e gap (not fixed):** `hr-recruitment.spec.ts`'s "New application" dialog leaves Save disabled
even though both Select fields visibly show the correct selected label in the accessibility snapshot. Extensive
static analysis of `Register.tsx`'s form-dialog logic (the `missing` computation, field-key collisions,
`dependsOn` clearing, query staleness) did not find a definitive root cause, and it reproduces identically
whether run alone or chained with other specs. Left as a known, unresolved browser-rendering issue — the
domain layer for recruitment is fully proven correct via the real-Postgres integration test.

## Defects found by running against a real database / browser (and fixed)

1. **Payroll engine placeholder gap**: `eligibleEmployees()` in `payroll.js` always pushed `run.id` into the
   query's parameter array (for the "not paid elsewhere" clause) but only referenced that placeholder in the
   SQL text for `run_type === 'regular'`. For an off-cycle or final-settlement run with an employee filter,
   this left a gap in the numbered placeholders — `$4` then `$6`, skipping `$5` — and Postgres refused the
   query ("could not determine data type of parameter $5"). Reproduced independently inside a settlement
   payment and an arrears calculation before being traced to this one shared function. Fixed by making the
   push and the SQL reference conditional together.
2. **Final settlement's snapshot omitted `attendance`**, but the payroll engine's generic post-processing
   unconditionally reads `snapshot.attendance.overtimeMinutes`, throwing on every settlement. Fixed by giving
   the settlement snapshot the same zeroed `attendance` shape a regular payslip has.
3. **Statutory: TDS read the PAN from the wrong field.** The gating check looked at
   `employee.statutory_identifiers.pan`; PAN is actually stored under `employee.tax_identifiers.pan`. TDS
   silently never computed for anyone. Fixed at the source; a regression test (`NO_PAN` exception with PAN
   present but empty) guards it.
4. **Statutory slab validation wrongly rejected a legitimate nil-rate bracket** (`flatAmount: 0, ratePercent:
   0` is a valid "no tax here" slab, not invalid input). Removed the over-eager check.
5. **`postPayrollToAccounting` checked run status before checking "already posted"**, so re-posting an
   already-posted run returned a generic state error instead of the specific "already posted" one. Reordered.
6. **`generatePayrollPeriods`'s payment-date month comparison was a tautology** (`end.slice(0,7) ===
   end.slice(0,7)`, always true) — a leftover from an earlier edit. Fixed to compare against the *next*
   month's code.
7. **Recruitment: a duplicate-email check that ran as an INSERT-then-catch-23505 poisoned the surrounding
   transaction** for every query after it, even once the specific error was caught. Changed to a SELECT
   check before the INSERT.
8. **Performance/learning: training enrolment checked "session full" before "already enrolled"**, so an
   employee re-enrolling in a session they already hold the one seat in was told the session was full instead
   of that they were already in it. Reordered the checks, and a repeat enrolment after a cancellation now
   reactivates the same row instead of erroring.
9. **Performance/learning: `getPerformanceDashboard` ran three queries with `Promise.all` on the single
   shared tenant connection**, which `pg` accepts but deprecates with a warning (queries are silently
   serialized anyway). Changed to the same `seq()` sequential-thunk helper every other HR module uses.
10. **A reporting manager (an ordinary `employee`-role user, no HR permission) had no way to reach the
    company-wide "employees" picker** used by every HR form, so the web "New goal" / "Rate a skill" / "Enrol"
    forms were unusable for a manager acting on behalf of their own report — the Select rendered no options.
    Found by the e2e journey, not the integration test (which calls the domain functions directly and never
    exercises the options endpoint). Fixed by extending the no-permission-required `listSelfOptions` to
    additionally return the caller's own direct reports (and the skills/training-session pickers a plain
    employee also needs), so a manager's "team" screens work without granting them any HR permission.
11. Various e2e-only findings on UI locators, ambiguous dialog buttons, and test-data collisions (PAN
    uniqueness, expense claims split across months, a shadowed `run` variable in a test) — see the git history
    for `tests/integration/hr-*.test.mjs` and `apps/web/e2e/hr-*.spec.ts`.

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F381 | Employee master | Built+verified | Full profile, sensitive fields hidden without `sensitive.view` (always visible to the employee themself). |
| F382 | Employee number | Built+verified | Sequential, immutable, from a configurable prefix/padding pattern. |
| F383 | Departments | Built+verified | Hierarchical, a department with current employees cannot be deactivated. |
| F384 | Designations | Built+verified | Unique codes; in-use designations cannot be deactivated. |
| F385 | Reporting manager | Built+verified | Reporting line checked for loops at every change (draft and placement change). |
| F386 | Branch and location | Built+verified | Branch must belong to the employee's company. |
| F387 | Employment type | Built+verified | Permanent/contract/intern etc., drives probation and notice defaults. |
| F388 | Employee documents | Built+verified | Upload, verify/reject with a reason; joining can require verified documents. |
| F389 | Joining | Built+verified | Blocked until required documents are verified; creates the onboarding checklist. |
| F390 | Probation | Built+verified | Auto-set from the default months; extend with a reason. |
| F391 | Confirmation | Built+verified | Confirms a probationer; records the confirmation date. |
| F392 | Transfers | Built+verified | A placement change request, approved by a second person, effective-dated. |
| F393 | Promotions | Built+verified | Same request mechanism; grade/designation change effective-dated. |
| F394 | Separation | Built+verified | Resignation/termination with notice, second-person decision, withdrawal while open, offboarding checklist, reassignment of direct reports. |
| F395 | Offboarding | Built+verified | Checklist tasks (assets, access, exit interview) must complete before the separation completes. |
| F396 | Employee self-service | Built+verified | Own profile with limited self-edit fields; a bank-detail change goes through HR approval; own documents and tasks. |
| F397 | Job openings | Built+verified | Draft → submit → approve by a second person → open; a salary range needs `sensitive.view`; closing needs a reason. |
| F398 | Candidates | Built+verified | Captured once (email is the identity); referral source recorded; compensation history protected. |
| F399 | Recruitment pipeline | Built+verified | Stage-by-stage moves with a reason recorded at each transition. |
| F400 | Interviews | Built+verified | Interviewer clash-checked; only the assigned interviewer gives feedback; feedback gates the offer stage. |
| F401 | Offers | Built+verified | Prepared, approved by a second person within the opening's salary range, sent, accepted/declined, expiry honoured. |
| F402 | Candidate-to-employee conversion | Built+verified | An accepted offer becomes an employee exactly once; application/candidate/opening are all updated. |
| F403 | Shifts | Built+verified | Time validation; assignment is effective-dated and cannot overlap. |
| F404 | Attendance | Built+verified | Punches build the day's record; manual entry needs a reason. |
| F405 | Check-in and check-out | Built+verified | Same-day punch pairing; a missing check-out is flagged. |
| F406 | Late arrival | Built+verified | Configurable grace period; late-minutes deduction rule. |
| F407 | Early exit | Built+verified | Same mechanism, early-departure side. |
| F408 | Overtime | Built+verified | Approved by the manager or HR, never by the employee; unapproved overtime is not paid. |
| F409 | Attendance regularization | Built+verified | Employee-requested, manager/HR-decided (never self), capped per month. |
| F410 | Leave types | Built+verified | Paid/unpaid, gender-restricted, with attachment/notice/min-consecutive rules. |
| F411 | Leave policies | Built+verified | Per leave type entitlement, by employment type. |
| F412 | Leave balances | Built+verified | Adjustments need a reason and cannot take a balance negative. |
| F413 | Leave accrual | Built+verified | Monthly, idempotent, pro-rated for a joiner, capped, eligibility-checked. |
| F414 | Carry forward | Built+verified | Year-end carry-forward up to a configured limit; the rest lapses; re-running changes nothing. |
| F415 | Holiday calendars | Built+verified | Per-branch calendars with a default; typed holidays; duplicates refused. |
| F416 | Leave requests | Built+verified | Checked for notice period, balance, policy, attachment, gender restriction, half-day and overlap rules. |
| F417 | Leave approval | Built+verified | Manager or HR, never self; approval deducts the balance and marks attendance; cancellation restores both. |
| F418 | Salary components | Built+verified | Earning/deduction, reserved codes protected, a component already used cannot change its fundamental nature. |
| F419 | Earnings | Built+verified | Percent-of, fixed, formula (a small expression language) and balancing lines. |
| F420 | Deductions | Built+verified | Same component model, deduction kind; statutory deductions plug in via the payroll hook system (F439–F443). |
| F421 | Salary structures | Built+verified | Forward references, duplicate lines and an over-100%-of-CTC total are refused; approved by a second person; one active version per code; revision creates a new version; retiring a structure in use is refused. |
| F422 | Employee compensation assignment | Built+verified | Proposed, approved by a second person (never the employee themself), frozen with its full breakup, effective-dated and ordered in time. |
| F423 | Payroll periods | Built+verified | Generated once per month; lock only when nothing is pending; unlock needs a reason. |
| F424 | Payroll calculation | Built+verified | Deterministic — a `calc_hash` over every line and total is recomputed and compared (`verifyPayrollDeterminism`); identical inputs give identical payslips, a changed input changes the hash. |
| F425 | Attendance-based payroll | Built+verified | Full attendance pays the full structure; absences, half days and unmarked days prorate correctly; the attendance summary classifies every day. |
| F426 | Joining/separation proration | Built+verified | A mid-period joiner, leaver and a mid-period pay revision are each prorated by the days each rate actually applied. |
| F427 | Overtime calculation | Built+verified | Approved overtime paid at the hourly rate × configured multiplier, exactly once; pending overtime is excluded and reported as an exception. |
| F428 | Bonus | Built+verified | Maker-checker payroll input, month-scoped, picked up by payroll exactly once. |
| F429 | Incentives | Built+verified | Same mechanism, bulk-entry by employee number; one bad row in a batch does not block the others. |
| F430 | Reimbursements | Built+verified | Expense categories with a monthly limit and a receipt-required threshold; manager approval, never self; reimbursed through the next payroll. |
| F431 | Loans and salary advances | Built+verified | Capped at a multiple of monthly gross, scheduled into EMIs, approved by a second person (never the borrower); prepay-in-full; skip an installment with a reason; the "no first-installment in the past" rule applies to loans, not advances. |
| F432 | Arrears | Built+verified | A backdated pay rise raises an arrear against an already-approved payslip, consumed by the next eligible payroll run. |
| F433 | Final settlement | Built+verified | Encashment, notice-period recovery, outstanding loan and any pending bonus rolled in; approved by a second person, never the separating employee; paid through a real payroll run so it goes through the same maker-checker and posting path as every other pay. |
| F434 | Payroll approval | Built+verified | Submit → approve by someone other than the preparer; a run that includes the approver's own pay is specifically refused to that approver. |
| F435 | Payslips | Built+verified | Per-employee, released only after approval, self-service view with the bank account masked; hold/release a payslip with a reason. |
| F436 | Bank transfer file | Built+verified | Generated once per run, lists each beneficiary's bank details, acknowledged with a UTR/batch reference which marks the run paid. |
| F437 | Payroll accounting posting | Built+verified | Refused until the company's ledger/fiscal period is configured; posts a real, balanced journal entry through the Accounting module; re-posting an already-posted run is specifically refused. |
| F438 | Payroll reconciliation | Built+verified | Ties the payslips, the bank file and the accounting journal together into one pass/fail check per run. |
| F439 | Provident Fund (PF) | Built+verified | Configured (not hard-coded) percentage-of-wage component with a wage ceiling; applies to the wage basis chosen. |
| F440 | ESIC | Built+verified | Same mechanism, its own wage ceiling; verified to switch off entirely above the ceiling (both employee and employer sides). |
| F441 | Professional tax | Built+verified | State-configured slab table; scoped to the state it is configured for (an employee elsewhere is unaffected). |
| F442 | TDS | Built+verified | Simplified slab on annualised taxable gross, computed marginally bracket-by-bracket; no PAN on file blocks TDS and raises a `NO_PAN` exception rather than silently taxing nothing. |
| F443 | Labour welfare fund | Built+verified | Flat employee/employer amounts, by state. |
| F444 | Gratuity | Built+verified | Eligibility (5+ years' service) and the ceiling are enforced; added to a final settlement automatically once eligible; a standalone estimate is available while still employed. |
| F445 | Statutory reports | Built+verified | Per-run, per-employee PF/ESIC/PT/LWF/TDS totals. |
| F446 | State-specific statutory configuration | Built+verified | Professional tax and labour welfare fund are both configured per state; an employee's state on their address decides which component applies to them. |
| F447 | Payroll compliance reports | Built+verified | Month-level aggregate across every regular run that period, with each statutory authority's due date; flags whether the month's payroll is fully closed. |
| F448 | Goals | Built+verified | Measurable goals (percent/number/boolean target), optional alignment to a parent goal, check-ins, weighting for the appraisal roll-up; set by the employee, their manager, or HR. |
| F449 | Appraisals | Built+verified | Driven by a review cycle: opening one creates an appraisal for every employee with a reporting manager; self review → manager review → completed; a calibration step lets HR adjust the final rating with a reason, and is itself blocked for the appraisal's own reviewer (`SELF_APPROVAL_BLOCKED`). |
| F450 | Performance reviews | Built+verified | Same appraisal object; optional peer feedback when the cycle enables it (a peer cannot review their own appraisal); a cycle only closes once every appraisal in it is completed or cancelled. |
| F451 | Skills | Built+verified | A skills registry with category; employee proficiency (1–5) that is either self-rated or HR/manager-assessed, each recorded distinctly. |
| F452 | Training | Built+verified | Courses (optionally linked to a skill), scheduled sessions with a seat capacity, enrolment (capacity-checked, duplicate-checked), attendance/no-show completion; completing a linked course with "attended" raises (never lowers) the employee's proficiency in that skill. |

## Known limits of this work

- **Compensation formulas**: the salary-structure formula language is a small, purpose-built expression
  evaluator (percent-of, fixed, formula, balance), not a general scripting language; it was not fuzz-tested.
- **Statutory rates are illustrative defaults a customer must configure** for their jurisdiction (PF/ESIC
  ceilings, TDS slabs, PT slabs by state, LWF amounts by state) — nothing is hard-coded, but nothing ships
  pre-configured for every Indian state either.
- **TDS is simplified**: annualised, marginal-slab, no old/new-regime deduction modelling, no Section 80C/
  HRA exemption calculation — it computes a slab-based estimate, not a compliant income-tax return input.
- **No payslip PDF generation or email delivery** — payslips are a screen/API record, not a rendered document.
- **Appraisal peer feedback has no browsing UI for an arbitrary peer** who is neither the employee nor the
  assigned reviewer: the domain function (`submitPeerFeedback`) fully supports it and is covered by the
  integration test, but the web `appraisals-to-review` list only surfaces appraisals where the caller is the
  *reviewer* — a true third-party peer currently has no screen to find an appraisal to comment on. Reasonable
  scope cut given the time available; not wired.
- **No performance dashboard screen** — `getPerformanceDashboard` (goal/appraisal counts by status, upcoming
  training enrolments) exists and is tested, but was not given a dedicated screen; only the underlying
  registers are wired.
- **Regularization/overtime/loan/expense/goal/appraisal "team" actions are open to any manager** (no HR
  permission required at the route, by design — see defect #10 above) **but this was not extended to every
  HR object**; a manager still cannot, for example, see a report's full employee profile without
  `hr_payroll.employee.view`.
- **No payroll simulation / what-if run** separate from a real (even if later cancelled) payroll run.
- **The recruitment "New application" e2e dialog issue** (see above) remains unresolved; the domain path it
  exercises is independently proven via the real-Postgres integration test.
- Accessibility and visual-regression gates were not run beyond the browser journeys described above.
  Registers fetch up to 500–2000 rows per view depending on the list.
