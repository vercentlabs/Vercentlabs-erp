import "server-only";

import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";
import { workspaceRoute } from "@/core/workspace-route";
import { supportContext } from "@/features/support/shared/support-context";
import { toWire } from "@/core/wire";

// Structural, with `any` rows, so one transaction client satisfies both the
// domain functions and the orchestration wrappers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof supportContext>;

// Every Support route: workspaceRoute (session -> organisation context ->
// access snapshot -> module "support" -> permission (or own-records self-service when the permission is "") -> billing write
// gate for a mutation) -> ONE transaction -> the domain function -> the wire
// format. Written once so the shape cannot drift between routes.
export async function supportRead<T>(request: Request, run: (client: Client, context: Context, session: WorkspaceSessionContext) => Promise<T>, permission: string = "support.view") {
  return workspaceRoute(request, permission ? { module: "support", permission } : { module: "support", selfService: true }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, supportContext(session), session)) as Record<string, unknown>),
  );
}

export async function supportMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I, session: WorkspaceSessionContext) => Promise<T>,
  status = 200,
  permission: string = "support.view",
) {
  return workspaceRoute(request, permission ? { module: "support", permission, billingWrite: true } : { module: "support", selfService: true, billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request).catch(() => ({})));
    return ok(toWire(await run(client as Client, supportContext(session), input, session)) as Record<string, unknown>, status);
  });
}
