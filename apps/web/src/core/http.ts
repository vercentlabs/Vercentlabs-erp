import { NextResponse } from "next/server";

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

export async function readJson(request: Request): Promise<unknown> {
  const maximumBytes = 100_000;
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > maximumBytes) throw new HttpError(413, "The request is too large.");
  // The header can be absent or wrong, so the bytes actually read are what is bounded.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "The request is too large.");
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
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
