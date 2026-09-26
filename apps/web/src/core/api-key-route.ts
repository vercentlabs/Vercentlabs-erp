import "server-only";

import { randomUUID } from "node:crypto";

import { authenticateApiKey, enforceRateLimit, requireApiScope, type ApiPrincipal } from "@vercentlabs/api";
import type { PoolClient } from "pg";
import { ZodError } from "zod";

import { tenantTransaction, transaction } from "@/core/db";

// Versioned developer API (/api/v1/*) composition. Machine callers only:
//   - Bearer API key (never a cookie session; no CSRF check - there is no
//     ambient credential to forge);
//   - the key and its app must be active and unexpired; the endpoint's scope
//     must be registered AND granted;
//   - per-key rate limit (committed before the handler runs, so a failing
//     request still counts);
//   - the organisation comes only from the key, never from path/query/body;
//   - bounded request bodies;
//   - one stable error contract: { ok: false, code, message, requestId }.
//
// HTTP status semantics (documented contract):
//   400 VALIDATION_FAILED / *_INVALID  malformed request
//   401 PLATFORM_API_KEY_REQUIRED / PLATFORM_API_KEY_INVALID  missing, unknown, revoked or expired key
//   403 PLATFORM_API_SCOPE_DENIED       key lacks the endpoint's scope
//   404 *_NOT_FOUND                     no such resource for this organisation
//   413 REQUEST_TOO_LARGE               body over the endpoint limit
//   429 RATE_LIMITED                    per-key limit exceeded (Retry-After)
//   500 INTERNAL_ERROR                  anything unexpected (no internals in the message)
export type ApiKeyRouteOptions = {
  scope: string;
  action: string;
  transaction?: "platform" | "tenant";
  maxBodyBytes?: number;
};

export type ApiKeyRouteContext = { client: PoolClient; principal: ApiPrincipal; requestId: string };

const DEFAULT_MAX_BODY = 256 * 1024;
const RATE_WINDOW_SECONDS = 60;

function rateLimitPerMinute() {
  const configured = Number(process.env.API_KEY_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(configured) && configured > 0 ? configured : 600;
}

function resolveRequestId(request: Request) {
  const inbound = request.headers.get("x-request-id") ?? "";
  return /^[A-Za-z0-9._-]{8,128}$/.test(inbound) ? inbound : randomUUID();
}

function headers(requestId: string, extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Request-Id": requestId, ...extra };
}

export function apiOk(requestId: string, data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ ok: true, requestId, ...data }), { status, headers: headers(requestId) });
}

export function apiError(requestId: string, status: number, code: string, message: string, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ ok: false, code, message, requestId }), { status, headers: headers(requestId, extraHeaders) });
}

function toApiError(requestId: string, error: unknown, action: string) {
  if (error instanceof ZodError) return apiError(requestId, 400, "VALIDATION_FAILED", "The request is not valid.");
  const shaped = error as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 && typeof shaped.message === "string") {
    if (shaped.status === 429) return apiError(requestId, 429, "RATE_LIMITED", "Too many requests for this API key. Slow down and retry.", { "Retry-After": String(RATE_WINDOW_SECONDS) });
    return apiError(requestId, shaped.status, typeof shaped.code === "string" ? shaped.code : "REQUEST_REJECTED", shaped.message);
  }
  console.error("api_v1_request_failed", { action, requestId, error: error instanceof Error ? error.name : "unknown" });
  return apiError(requestId, 500, "INTERNAL_ERROR", "The request could not be completed.");
}

export async function apiKeyRoute(request: Request, options: ApiKeyRouteOptions, handler: (context: ApiKeyRouteContext) => Promise<Response>): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > (options.maxBodyBytes ?? DEFAULT_MAX_BODY)) return apiError(requestId, 413, "REQUEST_TOO_LARGE", "The request body is too large.");
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
    if (!match) return apiError(requestId, 401, "PLATFORM_API_KEY_REQUIRED", "Send an API key as 'Authorization: Bearer <key>'.", { "WWW-Authenticate": "Bearer" });

    // Every authenticated request counts, including ones the scope check refuses.
    const principal = await transaction(async (client) => {
      const authenticated = await authenticateApiKey(client, match[1]);
      await enforceRateLimit(client, `api-key:${authenticated.apiKeyId}`, rateLimitPerMinute(), RATE_WINDOW_SECONDS);
      return authenticated;
    });
    requireApiScope(principal, options.scope);

    const run = (client: PoolClient) => handler({ client, principal, requestId });
    return options.transaction === "tenant" ? await tenantTransaction(principal.organizationId, run) : await transaction(run);
  } catch (error) {
    return toApiError(requestId, error, options.action);
  }
}
