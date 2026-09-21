import "server-only";

import type { ZodType } from "zod";

import { assertSameOriginOrMobile } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";
import { toWire } from "@/core/wire";
import { requireAccountingAccess, accountingContext } from "@/features/accounting/shared/accounting-context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof accountingContext>;

// Every Accounting route: workspace session -> module entitlement + permission (+ billing write access
// for a mutation) -> ONE tenant transaction -> domain function -> uniform error mapping.
export async function accountingRead<T>(run: (client: Client, context: Context, session: WorkspaceSessionContext) => Promise<T>, permission: string = "accounting.view") {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireAccountingAccess(client, session, permission);
      return run(client as Client, accountingContext(session), session);
    });
    return ok(toWire(result) as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function accountingMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I, session: WorkspaceSessionContext) => Promise<T>,
  status = 200,
  permission = "accounting.view",
) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const raw = await readJson(request).catch(() => ({}));
    const input = schema.parse(raw);
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireAccountingAccess(client, session, permission, { mutation: true });
      return run(client as Client, accountingContext(session), input, session);
    });
    return ok(toWire(result) as Record<string, unknown>, status);
  } catch (error) {
    return errorResponse(error);
  }
}
