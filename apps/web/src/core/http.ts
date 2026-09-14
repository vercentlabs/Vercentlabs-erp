import { NextResponse } from "next/server";
import { ZodError } from "zod";

// Normalizes both this route layer's own validation errors and the
// per-module Error subclasses @vercentlabs/api's ported platform code
// throws (ApiKeyError, OAuthError, EntitlementError, ModuleAccessError,
// AccessAdministrationError, SecurityError, etc. — each carries `status`
// and, where relevant, `code`) into one consistent JSON response shape.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

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

function hasHttpErrorShape(
  error: unknown,
): error is { status: number; message: string; code?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    "message" in error
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const maximumBytes = 100_000;
  const length = Number(request.headers.get("content-length") || "0");
  if (length > maximumBytes)
    throw new HttpError(413, "The request is too large.");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return fail(
      error.message,
      error.status,
      error.code || error.details
        ? {
            ...(error.code ? { code: error.code } : {}),
            ...(error.details || {}),
          }
        : undefined,
    );
  }
  if (error instanceof ZodError) {
    return fail("Review the submitted fields.", 400, {
      errors: error.flatten().fieldErrors,
    });
  }
  // Any ported @vercentlabs/api error class (ApiKeyError, OAuthError,
  // EntitlementError, ModuleAccessError, AccessAdministrationError,
  // SecurityError, PrivacyError, AiGovernanceError, ...) — all share this
  // {status, message, code?} shape by convention.
  if (hasHttpErrorShape(error)) {
    return fail(
      error.message,
      error.status,
      "code" in error && error.code
        ? { code: (error as { code?: string }).code }
        : undefined,
    );
  }
  console.error("request_failed", error);
  return fail("The request could not be completed.", 500);
}
