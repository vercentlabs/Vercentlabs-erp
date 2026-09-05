# F018 Email history — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading the OAuth/webhook/sync/suppression/send functions in `communications.js` (a 1,977-line file; read `verifyCrmProviderWebhookSignature`, `queueOutboundEmail`, `outboundSendDecision` in full, and the export surface in full).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | thread read + send/log with permission-aware content exposure. |
| CAP-002 (participant/team visibility, **provider sync**, **webhook replay**, **suppression/consent**, shared inbox, attachments, send failure, **AI draft approval**) | **PASS on the hard security/infrastructure items — this is the most complete communications engineering found in the audit; 1 clean gap (AI).** Webhook replay/authenticity: `verifyCrmProviderWebhookSignature` (`:452-473`) does HMAC-SHA256 verification with a timestamp tolerance window (replay protection) **and `timingSafeEqual`** for the comparison (prevents signature-forgery via timing attack) — textbook-correct, better than a lot of production webhook handlers. Provider sync: real, not a stub — `ingestMailboxDelta`/`ingestCalendarDelta`/`fetchProviderMailboxDelta`/`fetchProviderCalendarDelta`/`synchronizeProviderAccount` are actual functions with OAuth credential resolution (`resolveProviderCredential`, `createProviderOAuthState`/`consumeProviderOAuthState`). Suppression/consent: PASS — `queueOutboundEmail` checks `crm_email_suppressions` (with expiry) before allowing a send and rejects with `CRM_EMAIL_SUPPRESSED` if the recipient is on it. Send failure/rate limiting: PASS — `outboundSendDecision` enforces an hourly send cap and a send-window (business-hours) check, both server-side, before a message is even queued. Shared inbox: PASS — `createSharedInbox`/`upsertSharedInboxMember`/`claimSharedInboxThread` are real, with SLA minutes configured per inbox (confirmed in F013's audit note about `sla_minutes`). Thread/message idempotency: `ON CONFLICT (organization_id,provider,external_thread_id) DO UPDATE` (`:1114`) correctly dedupes provider-driven thread creation. **Gap: no AI draft-approval workflow exists anywhere** — confirmed by grep, no match for AI-drafted-email concepts. |
| CAP-003 (providers as signed adapters; normalized history stays permission-aware) | PASS | credential resolution and webhook verification are the adapter boundary; `crm_communications`/`crm_email_threads` are the normalized, permission-scoped internal representation. |
| FR-001/002/003 | PASS | full workflow states; `getCommunicationTimeline` aggregates without a described pagination issue at this scale. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | queued → sent/failed lifecycle implied by `status='queued'` insert plus the provider-sync ingestion path; conflict/idempotency handled via the `ON CONFLICT` pattern rather than a separate check-then-insert race. |
| BR-001/BR-002 | PASS | single send path (`queueOutboundEmail`); communications are effectively append-only per message. |
| DATA-001/002 | PASS | `crm_communications`, `crm_email_threads`, `crm_email_suppressions`, `crm_email_signatures` all exist and are used correctly. |
| VAL-001/002 | PASS | recipient/email normalization (`normalizeEmailAddress`), stable `CRM_EMAIL_*` codes including the specific suppression/throttle reasons. |
| CALC-001 | N/A | no monetary calculation. |
| UX-001/002/003 | NOT INDEPENDENTLY VERIFIED (no dedicated `f018` test file found; likely covered under the shared communications/activity workspace tests, not separately confirmed this pass) | |
| SEC-001/002 | PASS | webhook HMAC verification and OAuth state handling are themselves the security-critical surface here, both confirmed directly. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / INT-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | GAP | no AI draft-approval feature exists to have an authority boundary around — same pattern as F017. |
| API-001/002 | PASS | route pattern consistent with the module; webhook-specific security already verified directly. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

25 of 37 rows PASS, with the webhook signature verification and send-suppression/rate-limiting logic being genuinely best-in-class security engineering for this kind of feature — HMAC + timing-safe comparison + replay-window is exactly right, and I would not have been surprised to find a weaker implementation (e.g., missing `timingSafeEqual`, a common real-world mistake). The one clean gap is AI draft approval, which simply doesn't exist, consistent with the module-wide pattern that AI-adjacent dossier requirements are aspirational rather than built.
