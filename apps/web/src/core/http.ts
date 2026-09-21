import { NextResponse } from "next/server";

import { readJsonBody } from "./body-limit.ts";
import { classifyError, HttpError } from "./http-errors.ts";

export { HttpError };

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { ok: true, ...data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function fail(
  message: string,
  status = 400,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { ok: false, message, ...details },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function readJson(request: Request): Promise<unknown> {
  return readJsonBody(request);
}

// Normalizes both this route layer's own validation errors and the
// per-module Error subclasses @vercentlabs/api's ported platform code
// throws (ApiKeyError, OAuthError, EntitlementError, ModuleAccessError,
// AccessAdministrationError, SecurityError, etc.), plus a redirect() throw
// from requireWorkspace()/requireUser() caught before it reaches Next's
// own redirect boundary — see http-errors.ts's classifyError() for the
// actual decision logic (kept there so it's unit-testable without
// next/server's module resolution getting in the way).
export function errorResponse(error: unknown) {
  const classified = classifyError(error);
  return fail(classified.message, classified.status, classified.details);
}
