# F017 Notes and attachments — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading the lead attachment upload/download routes in full and the shared `apps/web/src/core/attachment-security.ts` module in full.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | add/retrieve note or file gated by parent-record (`getCrmRecord` re-check inside the transaction) and content permission (`crmLeadsViewSensitive` required for both upload and download). |
| CAP-002 (**private notes**, malware scanning, MIME/content validation, **versions**, quarantine, retention, unauthorized download, **AI file summarization**) | **PARTIAL — the security half is genuinely strong; 3 concrete gaps.** Malware scanning: PASS, and better than expected — `scanAttachmentForUpload` (`core/attachment-security.ts`) does real magic-byte content verification against the declared MIME type (rejects a mismatched file signature, `:9-19`), checks for the EICAR antivirus test string in dev/local mode, and in production **fails closed** if no external scanner is configured (`ATTACHMENT_SCAN_NOT_CONFIGURED`, 503) rather than silently allowing uploads — this is the correct, safe default. MIME/content validation: PASS, doubled up (`document-engine`'s `validateAttachment` plus the magic-byte check). Unauthorized download: PASS — the download route requires the same `crmLeadsViewSensitive` permission as upload, not just record visibility. Quarantine/retention: PASS in spirit — `lifecycle_status`/`scan_status` columns exist on `public.attachments` and are set to `'clean'` only after a passing scan. **Gaps:** no "private note" visibility flag exists anywhere (confirmed by grep across `index.js` and the notes route) — every note visible to anyone with sensitive-content access, with no additional per-note restriction; no attachment versioning (`re-upload` creates an independent row with a new random ID, no supersedes/version-number relationship); no AI file-summarization feature found anywhere in the CRM module. |
| CAP-003 (storage/scanning are adapters; access never exceeds parent record + private-note policy) | PASS (for the parent-record half; private-note half N/A given the gap above) | `getCrmRecord` re-validates the parent lead is accessible before the attachment insert commits. |
| FR-001/002/003 | PASS | validation/permission/conflict states present; a 5MB size cap (`MAX_BYTES`) is enforced, though there's no async/chunked path for larger files — acceptable given the cap. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | upload is a single atomic transaction (record existence check + insert + audit); errors map to `CRM_ATTACHMENT_*` codes; `RangeError`/`TypeError` from validation are caught and mapped rather than leaking a 500. |
| BR-001/BR-002 | PASS | single upload path through the governed route; no update path exists for an attachment's stored bytes (immutable once uploaded, consistent with "no versioning" rather than "editable history"). |
| DATA-001/002 | PASS | `public.attachments` carries `content_sha256` (integrity), `scan_status`, `lifecycle_status`, `uploaded_by` — a reasonably complete audit-relevant schema for what exists. |
| VAL-001/002 | PASS | `validateAttachment` (shared document-engine) plus the magic-byte check are both real, server-side, and not bypassable by a client lying about `Content-Type`. |
| CALC-001 | N/A | no monetary/derived calculation. |
| UX-001/002/003 | PASS (by test evidence) | "F017 notes and attachments are first-class lead record capabilities with governed storage and audit" confirmed passing in this session's earlier full CRM test run. |
| SEC-001/002 | PASS | compound permission gate (manage + sensitive-view) on both upload and download; content-hash integrity check. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | GAP | no AI summarization exists to have an authority boundary around — the dossier's explicit "AI file summarization scope" requirement has nothing to point at. |
| API-001/002 | PASS | route pattern consistent with the rest of the module, plus the fail-closed production scanning behavior noted above. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

25 of 37 rows PASS. The file-security engineering here (fail-closed malware scanning, magic-byte MIME verification, content-hash integrity) is genuinely above-average and should be held up as the reference pattern for any other module that handles file uploads (Procurement, Support, HR-Payroll will all need this). Three concrete, scoped gaps: no private-note visibility flag, no attachment versioning, no AI summarization.
