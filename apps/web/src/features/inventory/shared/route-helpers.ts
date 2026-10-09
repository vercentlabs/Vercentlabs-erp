import "server-only";

import type { ZodType } from "zod";

import { HttpError, ok, readJson } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";
import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";
import { toWire } from "@/core/wire";

// Structural, with `any` rows, so one transaction client satisfies both the
// domain functions and the orchestration wrappers.
type Client = {
  query(
    text: string,
    values?: unknown[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = ReturnType<typeof inventoryContext>;

// Every Inventory route: workspaceRoute (session -> organisation context ->
// access snapshot -> module "stock" -> permission -> billing write
// gate for a mutation) -> ONE transaction -> the domain function -> the wire
// format. Written once so the shape cannot drift between routes.
export async function inventoryRead<T>(
  request: Request,
  run: (
    client: Client,
    context: Context,
    session: WorkspaceSessionContext,
  ) => Promise<T>,
  permission: string = "stock.view",
) {
  return workspaceRoute(
    request,
    { module: "stock", permission },
    async ({ client, session }) =>
      ok(
        toWire(
          await run(client as Client, inventoryContext(session), session),
        ) as Record<string, unknown>,
      ),
  );
}

export async function inventoryMutation<I, T>(
  request: Request,
  schema: ZodType<I>,
  run: (
    client: Client,
    context: Context,
    input: I,
    session: WorkspaceSessionContext,
  ) => Promise<T>,
  status = 200,
  permission: string = "stock.view",
) {
  return workspaceRoute(
    request,
    { module: "stock", permission, billingWrite: true },
    async ({ client, session }) => {
      const input = schema.parse(await readJson(request).catch(() => ({})));
      return ok(
        toWire(
          await run(
            client as Client,
            inventoryContext(session),
            input,
            session,
          ),
        ) as Record<string, unknown>,
        status,
      );
    },
  );
}

// Multipart Inventory routes (an import or an attachment): the same chain, reading the uploaded file itself.
export async function inventoryUpload<T>(
  request: Request,
  run: (
    client: Client,
    context: Context,
    upload: { bytes: Buffer; fileName: string; field: (name: string) => string },
  ) => Promise<T>,
  status = 200,
  permission: string = "stock.view",
) {
  return workspaceRoute(
    request,
    { module: "stock", permission, billingWrite: true },
    async ({ client, session }) => {
      const form = await request.formData().catch(() => {
        throw new HttpError(400, "Choose a file to upload.");
      });
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
      if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
      const field = (name: string) => {
        const value = form.get(name);
        return typeof value === "string" ? value : "";
      };
      return ok(
        toWire(
          await run(client as Client, inventoryContext(session), {
            bytes: Buffer.from(await file.arrayBuffer()),
            fileName: file.name.slice(0, 240),
            field,
          }),
        ) as Record<string, unknown>,
        status,
      );
    },
  );
}
