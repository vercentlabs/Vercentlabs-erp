// Response parsing and plain JSON requests for the CRM browser API clients,
// on the app-wide JSON contract in @/shared/http/request-json (same body
// decoding and failure test as requestJson). What differs for CRM: the
// fallback message, the feature error class thrown, and which error details
// a client keeps. Authentication, caching, retries and toasts stay with the
// callers; file uploads keep their own fetch and only use parseCrmResponse.
import {
  jsonRequestInit,
  readJsonResponse,
  type JsonRequestInit,
} from "../../../../shared/http/request-json.ts";
import { CrmApiError, type CrmApiErrorClass } from "./crm-api-error.ts";

const CRM_REQUEST_FALLBACK_MESSAGE = "The request could not be completed.";

export type CrmErrorDetails =
  // no details (most clients)
  | "none"
  // the whole failed response body (Accounts, Contacts, Leads)
  | "body"
  // the response's `details` field (Lead lifecycle)
  | "details-field";

function parseCrmResponse<T>(
  response: Response,
  ErrorClass: CrmApiErrorClass = CrmApiError,
  details: CrmErrorDetails = "none",
): Promise<T> {
  return readJsonResponse<T>(response, (payload, status) => {
    const message = payload.message || CRM_REQUEST_FALLBACK_MESSAGE;
    if (details === "body")
      return new ErrorClass(message, status, payload.code, payload);
    if (details === "details-field")
      return new ErrorClass(message, status, payload.code, payload.details);
    return new ErrorClass(message, status, payload.code);
  });
}

async function crmRequest<T>(
  url: string,
  init: JsonRequestInit | undefined,
  ErrorClass: CrmApiErrorClass = CrmApiError,
  details: CrmErrorDetails = "none",
): Promise<T> {
  return parseCrmResponse<T>(
    await fetch(url, init === undefined ? undefined : jsonRequestInit(init)),
    ErrorClass,
    details,
  );
}

// Per-client bindings: `request` for plain JSON calls, `parseResponse` for
// calls that build their own fetch (uploads, custom headers).
export function crmApiClient(
  ErrorClass: CrmApiErrorClass,
  details: CrmErrorDetails = "none",
) {
  return {
    request: <T>(url: string, init?: JsonRequestInit): Promise<T> =>
      crmRequest<T>(url, init, ErrorClass, details),
    parseResponse: <T>(response: Response): Promise<T> =>
      parseCrmResponse<T>(response, ErrorClass, details),
  };
}
