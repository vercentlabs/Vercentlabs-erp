import { ZodError } from "zod";

// Pure error-classification logic, deliberately with zero "next/server"
// import — next/server's package "exports" map isn't resolvable under
// plain `node --test` outside Next's own bundler, which would make this
// logic untestable via a normal unit test if it lived in http.ts (which
// every route imports NextResponse through). "zod" itself has no such
// problem, so ZodError is still a real instanceof check, not duck-typed.
// http.ts wraps this module's classifyError() with NextResponse.json();
// this module owns the actual decision of what status/message/code an
// error becomes.
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  // No TS parameter properties (avoided deliberately) — Node's native
  // --experimental-strip-types (what "node --test" uses to run .test.ts
  // files without a build step) only erases type syntax, it cannot
  // generate the assignment code a parameter property needs, and fails
  // with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Same public constructor
  // signature/behavior, just spelled out explicitly.
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
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

// requireWorkspace()/requireUser()/requireVerifiedUser() (core/session.ts)
// call Next's redirect() — designed for Server Components/Pages, where a
// framework-level boundary turns the thrown NEXT_REDIRECT error into an
// actual HTTP redirect. Every CRM (and other) API route calls
// requireWorkspace() and wraps it in its own try/catch, so that redirect
// throw was caught before it ever reached Next's boundary — with no
// special handling, it fell through to the generic 500 branch, turning
// every unauthenticated/unverified/org-less API request into an opaque
// "The request could not be completed." (500), not a real 401. Found via
// the Prompt 3 Stage A behavioral-route-security audit; confirmed real by
// reading Next's own redirect.js (throws `Object.defineProperty(new
// Error("NEXT_REDIRECT"), ...)` with a `.digest` of
// `NEXT_REDIRECT;{type};{url};{statusCode};`), not assumed.
function redirectAuthMessage(url: string): { message: string; code: string } {
  if (url.startsWith("/login")) return { message: "Authentication required.", code: "AUTH_REQUIRED" };
  if (url.startsWith("/verify-email")) return { message: "Verify your email address to continue.", code: "AUTH_EMAIL_UNVERIFIED" };
  if (url.startsWith("/onboarding")) return { message: "Complete organization onboarding to continue.", code: "AUTH_NO_ORGANIZATION" };
  return { message: "Authentication required.", code: "AUTH_REQUIRED" };
}

function redirectAuthFailure(error: unknown): { message: string; code: string } | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  const url = digest.split(";")[2] || "/login";
  return redirectAuthMessage(url);
}

export type ClassifiedError = { status: number; message: string; details?: Record<string, unknown> };

export function classifyError(error: unknown): ClassifiedError {
  const redirectFailure = redirectAuthFailure(error);
  if (redirectFailure) {
    return { status: 401, message: redirectFailure.message, details: { code: redirectFailure.code } };
  }
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.message,
      details:
        error.code || error.details
          ? {
              ...(error.code ? { code: error.code } : {}),
              ...(error.details || {}),
            }
          : undefined,
    };
  }
  if (error instanceof ZodError) {
    return { status: 400, message: "Review the submitted fields.", details: { errors: error.flatten().fieldErrors } };
  }
  // Any ported @vercentlabs/api error class (ApiKeyError, OAuthError,
  // EntitlementError, ModuleAccessError, AccessAdministrationError,
  // SecurityError, PrivacyError, AiGovernanceError, ...) — all share this
  // {status, message, code?} shape by convention.
  if (hasHttpErrorShape(error)) {
    return {
      status: error.status,
      message: error.message,
      details: "code" in error && error.code ? { code: (error as { code?: string }).code } : undefined,
    };
  }
  console.error("request_failed", error);
  return { status: 500, message: "The request could not be completed." };
}
