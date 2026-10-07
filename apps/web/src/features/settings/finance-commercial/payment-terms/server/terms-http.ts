import "server-only";

// Request helpers for /api/settings/payment-terms. Payment terms are a shared master (Sales, Procurement, Finance), so these routes are gated by
// the payment-terms permissions, not by one module's switch; each calls one operation of the shared master, which owns every rule.
import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export function termsRead(request: Request, permission: string, run: (client: Client, context: Context) => Promise<Record<string, unknown>>) {
  return workspaceRoute(request, { permission }, async ({ client, session }) =>
    ok(await run(client as Client, { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions, roleSlugs: session.roleSlugs })));
}

// Never billing-gated: payment terms are account configuration.
export function termsWrite<I>(request: Request, permission: string, schema: ZodType<I>, run: (client: Client, context: Context, input: I) => Promise<Record<string, unknown>>, status = 200) {
  return workspaceRoute(request, { permission, auditDenial: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    return ok(await run(client as Client, { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions, roleSlugs: session.roleSlugs }, input), status);
  });
}
