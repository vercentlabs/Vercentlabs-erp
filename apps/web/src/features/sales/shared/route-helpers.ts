import "server-only";

import type { ZodType } from "zod";

import { assertSameOriginOrMobile } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { requireSalesAccess, salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

// Structural, with `any` rows, so one transaction client satisfies both the Sales
// domain functions and the orchestration wrappers (whose declared client types differ only in row typing).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof salesContext>;

// Every Sales route follows the same shape as the price-list routes already in
// this app: workspace session -> module entitlement + the specific permission
// (+ billing write access for a mutation) -> one tenant transaction ->
// domain function -> uniform error mapping. These two helpers exist so that
// shape is written once instead of ~40 times, and so a future change to it
// (say, audit logging) cannot be applied to some routes and forgotten on others.
export async function salesRead<T>(permission: string, run: (client: Client, context: Context) => Promise<T>) {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, permission);
      return run(client as Client, salesContext(session));
    });
    return ok(toWire(result) as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function salesMutation<I, T>(
  request: Request,
  permission: string,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I) => Promise<T>,
  status = 200,
) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    // An empty body is valid for pure-action routes (approve/reject/scan): the
    // schema decides what is required, not the transport.
    const raw = await readJson(request).catch(() => ({}));
    const input = schema.parse(raw);
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireSalesAccess(client, session, permission, { mutation: true });
      return run(client as Client, salesContext(session), input);
    });
    return ok(toWire(result) as Record<string, unknown>, status);
  } catch (error) {
    return errorResponse(error);
  }
}

