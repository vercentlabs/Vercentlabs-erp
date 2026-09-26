import "server-only";

import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

// Structural, with `any` rows, so one transaction client satisfies both the
// domain functions and the orchestration wrappers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof salesContext>;

// Every Sales route: workspaceRoute (session -> organisation context ->
// access snapshot -> Sales module -> permission -> billing write gate for a
// mutation) -> the domain function -> the wire format. Written once so the
// shape cannot drift between routes.
export async function salesRead<T>(request: Request, permission: string, run: (client: Client, context: Context) => Promise<T>) {
  return workspaceRoute(request, { module: "sales", permission }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, salesContext(session))) as Record<string, unknown>),
  );
}

export async function salesMutation<I, T>(
  request: Request,
  permission: string,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I) => Promise<T>,
  status = 200,
) {
  return workspaceRoute(request, { module: "sales", permission, billingWrite: true }, async ({ client, session }) => {
    // An empty body is valid for pure-action routes (approve/reject/scan): the
    // schema decides what is required, not the transport.
    const input = schema.parse(await readJson(request).catch(() => ({})));
    return ok(toWire(await run(client as Client, salesContext(session), input)) as Record<string, unknown>, status);
  });
}
