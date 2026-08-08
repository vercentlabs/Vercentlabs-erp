# Phase 8 Conversion Launch Validation

## Full synthetic demo-lead journey rehearsal

Executed against the live, final production build (port 3050), following the exact chain the workstream specifies:

```
Campaign URL (?utm_source=launch_rehearsal&utm_medium=test&utm_campaign=phase8_rehearsal)
→ landing (homepage)
→ internal navigation (clicked the real primary "Book a Product Demo" CTA)
→ /book-demo
→ form fill (synthetic data: "Rehearsal Synthetic", a clearly-fake .invalid email domain, a placeholder phone number, "Synthetic Test Co", consent checked)
→ validation (passed — no client-side error)
→ signed CRM capture attempt
→ [environment limitation — see below]
```

**Result:** The form correctly submitted, attribution correctly carried through from the campaign URL (confirmed via the same `readAttribution()` mechanism Phase 7's `attribution.spec.ts` already verifies 18/18), and the browser's own network log showed a real `500` response from `/api/book-demo` — not a JS crash, not a silent failure. The UI correctly displayed a safe, generic retry message ("We couldn't submit your request. Please try again.") rather than a blank page, a stack trace, or any technical detail.

## Why the 500, and why that's the correct, expected result here

This session's environment does not have `apps/web` (the actual CRM system `lib/crm-capture.ts` delivers leads to) running — confirmed in Phase 7 (`phase-7/decision-log.md` item 2) via a direct `curl` showing a genuine connection-refused error surfacing as a `500`. This is **not a defect in `apps/landing`** — it's the correct, honest behavior of a real HTTP client encountering a real unavailable upstream server, and it's handled exactly the way `lead-reliability-audit.md` (Phase 7) already verified: a controlled `500` response, a safe user-facing message, and a structured `lead_capture_upstream_failure`/`timeout` log entry (never the request body) via `lib/lead-observability.ts`.

**A true end-to-end rehearsal against a live `apps/web` instance has not been performed** — this is a real, disclosed gap, not silently assumed complete. It requires an environment where both `apps/landing` and `apps/web` run simultaneously with matching `CRM_CAPTURE_FORM_KEY`/`CRM_CAPTURE_PROXY_SECRET` values, which this session's sandbox does not have configured for `apps/web`. This is flagged explicitly in `launch-readiness-scorecard.md` and `launch-runbook.md`'s T-1-hour checklist as a required pre-launch step: run this exact rehearsal again against a real, live `apps/web` (staging or production), using synthetic data, and confirm a real lead record is created and then cleaned up.

## What this rehearsal did confirm, with real evidence

- Attribution correctly survives the full campaign-URL → homepage → internal-nav → book-demo chain (REPRODUCED, matches Phase 7's `attribution.spec.ts` coverage).
- Client-side validation passes for a complete, valid synthetic submission.
- The demo form's failure-handling path (Phase 7's `lead-reliability.spec.ts` coverage) behaves correctly under a genuine real-world failure condition (upstream unavailable), not just a simulated one.
- No PII appeared in any console log during this rehearsal (only a generic "Failed to load resource" browser network message, no field values).
- No synthetic lead record was created anywhere (since delivery genuinely failed) — nothing needed cleanup.

## Analytics/attribution/observability during this rehearsal

- `demo_form_start`, `demo_form_submit`, and `demo_form_error` (with `errorCategory: "500"`) would have fired per the typed event contract (`phase-7/analytics-event-contract.md`) — not independently re-verified via a network-level assertion in this specific rehearsal run, since Phase 7's `pii-leakage.spec.ts` and the analytics-focused specs already cover payload-shape correctness in detail; this rehearsal's purpose was the end-to-end journey, not re-proving already-covered unit-level behavior.
- `lib/lead-observability.ts` would have logged a structured `lead_capture_upstream_failure` (or `_timeout`) entry server-side — confirmed by code path, consistent with Phase 7's own testing of this exact branch.
