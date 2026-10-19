import "server-only";

import type { ApiKeyRouteContext } from "@/core/api-key-route";
import { apiKeyRoute, apiOk } from "@/core/api-key-route";

// The record endpoints of the public API (/api/v1/customers, items, sales-orders, invoices, stock-levels, payments): a list with the
// query string's filters, one record by id, or a create from the JSON body — each under its scope.
type Handler<T> = (context: ApiKeyRouteContext, input: T) => Promise<Record<string, unknown>>;

export function apiList(request: Request, scope: string, run: Handler<Record<string, string>>) {
  return apiKeyRoute(request, { scope, action: `api.v1.${scope}.list` }, async (context) =>
    apiOk(context.requestId, await run(context, Object.fromEntries(new URL(request.url).searchParams))));
}

export function apiOne(request: Request, scope: string, params: Promise<{ id: string }>, run: Handler<string>) {
  return apiKeyRoute(request, { scope, action: `api.v1.${scope}.get` }, async (context) => apiOk(context.requestId, await run(context, (await params).id)));
}

export function apiCreate(request: Request, scope: string, run: Handler<Record<string, unknown>>) {
  return apiKeyRoute(request, { scope, action: `api.v1.${scope}.create`, maxBodyBytes: 256 * 1024 }, async (context) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Send a JSON object."), { status: 400, code: "VALIDATION_FAILED" });
    return apiOk(context.requestId, await run(context, body as Record<string, unknown>), 201);
  });
}
