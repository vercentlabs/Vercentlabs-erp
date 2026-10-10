import "server-only";

import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { posContext } from "@/features/pos/shared/pos-context";

// Structural, with `any` rows, so one transaction client satisfies the domain functions.
type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = ReturnType<typeof posContext>;

// POS routes: workspaceRoute (session -> organisation context -> module "point-of-sale" -> permission -> billing write gate for a
// mutation) -> ONE transaction -> the domain function -> the wire format. The domain function checks its own finer permission.
export async function posRead<T>(request: Request, run: (client: Client, context: Context) => Promise<T>, permission = "pos.outlets.view") {
  return workspaceRoute(request, { module: "point-of-sale", permission }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, posContext(session))) as Record<string, unknown>));
}

export async function posMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I) => Promise<T>,
  status = 200,
  permission = "pos.outlets.view",
) {
  return workspaceRoute(request, { module: "point-of-sale", permission, billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request).catch(() => ({})));
    return ok(toWire(await run(client as Client, posContext(session), input)) as Record<string, unknown>, status);
  });
}
