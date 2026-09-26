import "server-only";

import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";
import { workspaceRoute } from "@/core/workspace-route";
import { hrContext } from "@/features/hr/shared/hr-context";
import { toWire } from "@/core/wire";

// Structural, with `any` rows, so one transaction client satisfies both the
// domain functions and the orchestration wrappers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = ReturnType<typeof hrContext>;

// Every Hr route: workspaceRoute (session -> organisation context ->
// access snapshot -> module "hr-payroll" -> permission (or own-records self-service when the permission is "") -> billing write
// gate for a mutation) -> ONE transaction -> the domain function -> the wire
// format. Written once so the shape cannot drift between routes.
export async function hrRead<T>(request: Request, run: (client: Client, context: Context, session: WorkspaceSessionContext) => Promise<T>, permission: string = "hr_payroll.view") {
  return workspaceRoute(request, permission ? { module: "hr-payroll", permission } : { module: "hr-payroll", selfService: true }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, hrContext(session), session)) as Record<string, unknown>),
  );
}

export async function hrMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I, session: WorkspaceSessionContext) => Promise<T>,
  status = 200,
  permission: string = "hr_payroll.view",
) {
  return workspaceRoute(request, permission ? { module: "hr-payroll", permission, billingWrite: true } : { module: "hr-payroll", selfService: true, billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request).catch(() => ({})));
    return ok(toWire(await run(client as Client, hrContext(session), input, session)) as Record<string, unknown>, status);
  });
}
