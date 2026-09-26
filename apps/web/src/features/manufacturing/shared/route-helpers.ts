import "server-only";

import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";
import { workspaceRoute } from "@/core/workspace-route";
import { manufacturingContext } from "@/features/manufacturing/shared/manufacturing-context";
import { toWire } from "@/core/wire";

// Structural, with `any` rows, so one transaction client satisfies both the
// domain functions and the orchestration wrappers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof manufacturingContext>;

// Every Manufacturing route: workspaceRoute (session -> organisation context ->
// access snapshot -> module "manufacturing" -> permission -> billing write
// gate for a mutation) -> ONE transaction -> the domain function -> the wire
// format. Written once so the shape cannot drift between routes.
export async function manufacturingRead<T>(request: Request, run: (client: Client, context: Context, session: WorkspaceSessionContext) => Promise<T>, permission: string = "manufacturing.view") {
  return workspaceRoute(request, { module: "manufacturing", permission }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, manufacturingContext(session), session)) as Record<string, unknown>),
  );
}

export async function manufacturingMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I, session: WorkspaceSessionContext) => Promise<T>,
  status = 200,
  permission: string = "manufacturing.view",
) {
  return workspaceRoute(request, { module: "manufacturing", permission, billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request).catch(() => ({})));
    return ok(toWire(await run(client as Client, manufacturingContext(session), input, session)) as Record<string, unknown>, status);
  });
}
