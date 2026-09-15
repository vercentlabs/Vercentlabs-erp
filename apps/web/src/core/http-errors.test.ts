import { test } from "node:test";
import assert from "node:assert/strict";
import { ZodError, z } from "zod";

import { classifyError, HttpError } from "./http-errors.ts";

// Constructs the exact error shape Next.js's redirect() throws (verified
// by reading node_modules/next/dist/client/components/redirect.js before
// writing this test, not assumed): a real Error whose .digest is
// `NEXT_REDIRECT;{type};{url};{statusCode};`.
function redirectError(url: string): Error {
  const error = new Error("NEXT_REDIRECT");
  (error as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
  return error;
}

test("classifyError: a redirect('/login') from requireUser() becomes a real 401, not a generic 500", () => {
  const classified = classifyError(redirectError("/login"));
  assert.equal(classified.status, 401);
  assert.equal(classified.details?.code, "AUTH_REQUIRED");
});

test("classifyError: a redirect('/verify-email?...') from requireVerifiedUser() becomes 401 with an email-specific code", () => {
  const classified = classifyError(redirectError("/verify-email?email=a%40b.com"));
  assert.equal(classified.status, 401);
  assert.equal(classified.details?.code, "AUTH_EMAIL_UNVERIFIED");
});

test("classifyError: a redirect('/onboarding') from requireWorkspace() becomes 401 with a no-organization code", () => {
  const classified = classifyError(redirectError("/onboarding"));
  assert.equal(classified.status, 401);
  assert.equal(classified.details?.code, "AUTH_NO_ORGANIZATION");
});

test("classifyError: an unrelated error with a digest that isn't NEXT_REDIRECT falls through to the generic 500 path", () => {
  const error = new Error("boom");
  (error as Error & { digest: string }).digest = "SOME_OTHER_FRAMEWORK_SIGNAL;x;y;z;";
  const classified = classifyError(error);
  assert.equal(classified.status, 500);
});

test("classifyError: HttpError instances still map to their own status/code, unaffected by the redirect check", () => {
  const classified = classifyError(new HttpError(403, "Not allowed.", "CRM_FORBIDDEN"));
  assert.equal(classified.status, 403);
  assert.equal(classified.message, "Not allowed.");
  assert.equal(classified.details?.code, "CRM_FORBIDDEN");
});

test("classifyError: a real ZodError maps to 400 with field errors", () => {
  const result = z.object({ name: z.string() }).safeParse({});
  assert.ok(!result.success);
  const classified = classifyError(result.error as ZodError);
  assert.equal(classified.status, 400);
  assert.ok(classified.details?.errors);
});

test("classifyError: a ported platform error ({status,message,code} shape without being an HttpError instance) still maps correctly", () => {
  class PortedError extends Error {
    status = 409;
    code = "CRM_STALE_WRITE";
    constructor() {
      super("This record changed after you loaded it.");
    }
  }
  const classified = classifyError(new PortedError());
  assert.equal(classified.status, 409);
  assert.equal(classified.details?.code, "CRM_STALE_WRITE");
});

test("classifyError: a genuinely unknown error still returns a generic 500 without leaking internals", () => {
  const classified = classifyError(new Error("some internal detail"));
  assert.equal(classified.status, 500);
  assert.equal(classified.message, "The request could not be completed.");
});
