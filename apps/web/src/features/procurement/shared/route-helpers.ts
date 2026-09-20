import "server-only";

import type { ZodType } from "zod";

import { assertSameOriginOrMobile } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";
import { toWire } from "@/core/wire";
import { procurementContext, requireProcurementAccess } from "@/features/procurement/shared/procurement-context";

// Structural, with `any` rows, so one transaction client satisfies the domain
// functions and the orchestration wrappers alike.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof procurementContext>;

// Every Procurement route: workspace session -> module entitlement + permission
// (+ billing write access for a mutation) -> ONE tenant transaction -> domain
// function -> uniform error mapping. Written once so a change (audit logging,
// rate limiting) cannot be applied to some routes and forgotten on others.
export async function procurementRead<T>(run: (client: Client, context: Context, session: WorkspaceSessionContext) => Promise<T>, permission = "procurement.view") {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireProcurementAccess(client, session, permission);
      return run(client as Client, procurementContext(session), session);
    });
    return ok(toWire(result) as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function procurementMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I, session: WorkspaceSessionContext) => Promise<T>,
  status = 200,
  permission = "procurement.view",
) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const raw = await readJson(request).catch(() => ({}));
    const input = schema.parse(raw);
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireProcurementAccess(client, session, permission, { mutation: true });
      return run(client as Client, procurementContext(session), input, session);
    });
    return ok(toWire(result) as Record<string, unknown>, status);
  } catch (error) {
    return errorResponse(error);
  }
}
