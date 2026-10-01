// The one error contract of the CRM browser API clients. Feature clients keep
// their own exported classes (LeadApiError, CallApiError, ...) as thin
// subclasses, so `error instanceof LeadApiError` and `instanceof CrmApiError`
// both hold for a failed Lead request and screens keep their existing checks.
//
// `name` is deliberately left as "Error", as it was for every feature class.
export class CrmApiError extends Error {
  readonly status: number;
  readonly code?: string;
  // Only set when the client keeps error details: the whole response body
  // (Accounts, Contacts, Leads: duplicate matches, canOverride) or the
  // response's `details` field (Lead lifecycle).
  declare readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    if (details !== undefined)
      (this as { details?: unknown }).details = details;
  }
}

// Base for clients whose screens read the whole failed response body
// (duplicate refusals: `details.matches`, `details.canOverride`).
export class CrmApiErrorWithBody extends CrmApiError {
  declare readonly details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details: unknown = {},
  ) {
    super(message, status, code, details);
  }
}

// Base for clients that keep the response's `details` field (Lead
// lifecycle): `details` is always an own property, undefined when the
// response carried none.
export class CrmApiErrorWithDetails extends CrmApiError {
  declare readonly details: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message, status, code, details);
    (this as { details?: unknown }).details = details;
  }
}

export type CrmApiErrorClass<E extends CrmApiError = CrmApiError> = new (
  message: string,
  status: number,
  code?: string,
  details?: unknown,
) => E;
