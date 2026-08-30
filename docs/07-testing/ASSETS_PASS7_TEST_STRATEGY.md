# Assets Pass 7 Test Strategy

- Unit/property: depreciation methods, salvage floor, useful-life changes, carrying value, revaluation/impairment, gain/loss, rounding/final true-up.
- State machines: capitalization, assignment/transfer, maintenance, inspection/calibration, verification, disposal/reversal.
- DB/RLS: organization/company isolation, FK/check/uniqueness, immutable/posted behavior, cross-org negative tests.
- Security: permission/record/field scope and maker-checker/self-approval negative cases.
- Concurrency/idempotency: duplicate procurement auto-create, simultaneous assignments/transfers, depreciation batch races, maintenance parts retries, disposal retries.
- Integration/reconciliation: Procurement→Assets, Assets↔Stock/Manufacturing/HR/Projects, Assets→Accounting including rejection/retry/reversal.
- E2E/mobile/accessibility: scanner fallback, field evidence, keyboard/screen-reader, tablet/phone layouts, exception recovery.
- Performance: large register/history/depreciation schedule/report volumes with bounded queries/jobs.
