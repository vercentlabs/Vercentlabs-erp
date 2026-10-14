import "server-only";

import type { ZodType } from "zod";

import { ok, readJson } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";

// Structural, with `any` rows, so one transaction client satisfies the domain functions.
type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = ReturnType<typeof projectsContext>;

// Every Projects route: workspaceRoute (session -> organisation -> access snapshot -> module "projects" -> permission -> billing write gate for
// a mutation) -> ONE transaction -> the domain function -> the wire format. The domain applies the finer rules (membership, project role).
export async function projectsRead<T>(
  request: Request,
  run: (client: Client, context: Context, url: URL, session: WorkspaceSessionContext) => Promise<T>,
  permission: string = "projects.view",
) {
  return workspaceRoute(request, { module: "projects", permission }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, projectsContext(session), new URL(request.url), session)) as Record<string, unknown>),
  );
}

export async function projectsMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (client: Client, context: Context, input: I, session: WorkspaceSessionContext) => Promise<T>,
  status = 200,
  permission: string = "projects.view",
) {
  return workspaceRoute(request, { module: "projects", permission, billingWrite: true }, async ({ client, session }) => {
    const input = schema.parse(await readJson(request).catch(() => ({})));
    return ok(toWire(await run(client as Client, projectsContext(session), input, session)) as Record<string, unknown>, status);
  });
}

// The list filters a request may carry.
export const listFilters = (url: URL) => Object.fromEntries(
  ["view", "search", "status", "priority", "classification", "managerId", "customerId", "typeId", "tag", "health", "due", "sort", "direction", "page", "pageSize"]
    .map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""),
);
