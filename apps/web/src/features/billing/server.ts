import "server-only";

import { assertSameOriginOrMobile, createRazorpayProvider, requireSessionPermission } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";

type Client = Parameters<Parameters<typeof withClient>[0]>[0];
type Handler = (client: Client, session: WorkspaceSessionContext, input: Record<string, unknown>, provider: ReturnType<typeof createRazorpayProvider>) => Promise<Record<string, unknown>>;

// Billing routes never depend on the subscription being active: an expired or over-limit organisation must still
// be able to open Billing to renew or add seats. Each one is gated by its own billing permission instead.
export async function billingRead(permission: string, handler: Handler) {
  try {
    const session = await requireWorkspace();
    requireSessionPermission(session, permission);
    return ok(await withClient((client) => handler(client, session, {}, createRazorpayProvider(process.env))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function billingWrite(request: Request, permission: string, parse: (body: unknown) => Record<string, unknown>, handler: Handler, status = 200) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    requireSessionPermission(session, permission);
    const input = parse(await readJson(request));
    return ok(await withClient((client) => handler(client, session, input, createRazorpayProvider(process.env))), status);
  } catch (error) {
    return errorResponse(error);
  }
}

export { BILLING_PERMISSIONS };
