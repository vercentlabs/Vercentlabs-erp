import "server-only";

// Request helpers for the routes under /api/settings/taxes. Tax configuration
// is shared by every module, so these routes are gated by their tax
// permission, not by one module's switch. workspaceRoute authenticates and
// opens the tenant transaction; each route calls one operation of the shared
// tax layer, which owns every rule.
import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export function taxRead(request: Request, permission: string, run: (client: Client, context: Context) => Promise<Record<string, unknown>>) {
  return workspaceRoute(request, { permission }, async ({ client, session }) =>
    ok(await run(client as Client, { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions, roleSlugs: session.roleSlugs })));
}

// Never billing-gated: tax configuration is account administration.
export function taxWrite<I>(request: Request, permission: string, schema: ZodType<I>, run: (client: Client, context: Context, input: I) => Promise<Record<string, unknown>>, status = 200) {
  return workspaceRoute(request, { permission, auditDenial: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request));
    return ok(await run(client as Client, { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions, roleSlugs: session.roleSlugs }, input), status);
  });
}
