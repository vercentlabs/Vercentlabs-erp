# CRM browser HTTP

One response and error model for the CRM browser API clients (`features/crm/**/api/*-api.ts` and `features/crm/shared/*-api.ts`).

- `crm-api-error.ts`: `CrmApiError` (`message`, `status`, `code`, and `details` when a client keeps them). Feature clients keep their own exported classes (`LeadApiError`, `CallApiError`, ...) as empty subclasses, so existing `error instanceof LeadApiError` checks keep working and `instanceof CrmApiError` holds too. `CrmApiErrorWithBody` (Accounts, Contacts, Leads) keeps the whole failed response body as `details`, which the duplicate-refusal forms read (`details.matches`, `details.canOverride`). `CrmApiErrorWithDetails` (Lead lifecycle) keeps the response's `details` field.
- `crm-request.ts`: `parseCrmResponse` (built on `readJsonResponse` in `@/shared/http/request-json`, the same body decoding and failure test as `requestJson`; fallback message "The request could not be completed.") and `crmRequest` for plain JSON calls. A client binds both once with `crmApiClient(FeatureApiError)`.

Uploads (attachments, lead import) build their own `FormData` fetch and only use `parseResponse`. File downloads are plain URLs. Public booking uses the same parser with no extra headers or workspace context. `shared/crm-options-api.ts` keeps its plain `Error` and own fallback message and only reuses `readJsonResponse`.

Rules (`checkCrmBrowserClients` in `scripts/validation/architecture-rules.mjs`): no CRM file outside this directory decodes a response body itself, no CRM error class extends `Error` directly, and every CRM TanStack Query key is built with `scopedQueryKey` (or spreads a key built with it). Tests: `crm-request.test.ts` here and `../query-scope.test.ts`.
