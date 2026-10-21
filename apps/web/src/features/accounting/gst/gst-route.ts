import "server-only";

import { HttpError, ok, readJson } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";
import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";
import { toWire } from "@/features/sales/shared/wire";

// GST returns serve Accounting and Sales (Sales audit M8): a company that bills with Sales alone files GSTR-1 from its sales, so the GST
// routes open with either app; the GST permissions decide the rest.
type Snapshot = { modules: ReadonlyArray<{ moduleId: string; released: boolean; enabled: boolean; reason?: string }> } | null;
type Client = Parameters<Parameters<typeof workspaceRoute>[2]>[0]["client"];
const GST_APPS = ["accounting", "sales"];
function requireGstApp(snapshot: Snapshot) {
  if (!(snapshot?.modules ?? []).some((entry) => GST_APPS.includes(entry.moduleId) && entry.released && entry.enabled && entry.reason !== "not_entitled"))
    throw new HttpError(403, "GST returns need the Accounting or Sales app.");
}

export function gstRoute(request: Request, permission: string, run: (client: Client, context: ReturnType<typeof accountingContext>, session: WorkspaceSessionContext) => Promise<unknown>,
  { write = false }: { write?: boolean } = {}) {
  return workspaceRoute(request, { snapshot: true, permission, ...(write ? { billingWrite: true } : {}) }, async ({ client, session, snapshot }) => {
    requireGstApp(snapshot as Snapshot);
    const result = await run(client, accountingContext(session), session);
    return result instanceof Response ? result : ok(toWire(result) as Record<string, unknown>);
  });
}

export const readBody = async (request: Request) => {
  const body = await readJson(request).catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
  return body as Record<string, unknown>;
};
