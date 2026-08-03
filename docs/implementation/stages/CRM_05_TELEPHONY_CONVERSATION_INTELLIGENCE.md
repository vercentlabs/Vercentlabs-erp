# CRM-05 — Telephony and Conversation Intelligence

CRM-05 completes the provider-neutral telephony, call recording and transcription foundation for the governed CRM release.

## Capabilities

- CRM-003 — Call and meeting transcription
- CRM-006 — Telephony integration and click-to-call
- CRM-046 — Conversation transcription and summarisation
- CRM-049 — Telephony call logging and recordings

## Governed behavior

- Provider credentials are referenced through `env:`, `vault:` or `secret:` identifiers and are never stored in source.
- Telephony webhooks require an HMAC signature and a recent timestamp.
- Provider event IDs and click-to-call commands are idempotent.
- Recording storage requires consent or an explicit not-required basis and a retention deadline.
- Recording access is short-lived, purpose-bound and audited through hashed grants.
- Transcription uses durable retryable jobs, speaker segments, redaction, content hashes and human-reviewable insights.
- Summaries, risks, commitments and action items remain reviewable CRM records rather than silently mutating commercial data.
- Every new table uses forced tenant row-level security.

## Provider acceptance

Local live verification uses the deterministic `mock` provider. Production promotion of Twilio, Exotel, Plivo or an external transcription service requires real credentials, public webhook endpoints, provider sandbox evidence and a release-readiness snapshot. The capability code and local acceptance can be complete while production provider acceptance remains sandbox-scoped.

## Verification

```sh
pnpm verify:crm-05
pnpm test:crm-05-live
pnpm verify:crm-05-complete
```
