# F097 — Item master — UAT

## Status

- Module: Stock
- Technical status: TESTING
- Human UAT: NOT_READY

## Required acceptance

1. Sign in as an authorised user and verify the Item master workflow is reachable from the normal product UI, not only by direct API call.
2. Create or execute the primary workflow and verify valid state transitions persist after refresh.
3. Try invalid, missing and stale input; verify the operation is rejected without partial mutation and the error is actionable.
4. Verify an unauthorised role cannot perform the mutation even by calling the endpoint directly.
5. Switch organisation/company/branch context where applicable and verify records never leak across scope.
6. Verify audit/history/outbox evidence for meaningful mutations and ensure sensitive customer data is not copied unnecessarily.
7. Verify desktop, tablet and mobile layouts keep the primary action reachable with keyboard-visible focus and no blocking horizontal overflow.
8. Re-run the relevant action where retry/idempotency applies and verify duplicate business effects are not created.

## Sign-off

- Tester: ____________________
- Date: ____________________
- Result: PASS / FAIL
- Notes: ____________________
