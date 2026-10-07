import "server-only";

// Request helpers for the Item Master routes under /api/products. The catalogue is shared
// by every module, so these routes are not tied to one module's switch: each
// is gated by its product permission. workspaceRoute authenticates and opens
// the tenant transaction; the route calls one operation from
// @vercentlabs/api/products, which owns every business rule.
import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = ReturnType<typeof salesContext>;
type Body = Record<string, unknown>;

export type ProductRouteParams = { params: Promise<{ id: string }> };

export function productRead(request: Request, permission: string, run: (client: Client, context: Context) => Promise<unknown>) {
  return workspaceRoute(request, { permission }, async ({ client, session }) => {
    const result = await run(client as Client, salesContext(session));
    return result instanceof Response ? result : ok(toWire(result) as Record<string, unknown>);
  });
}

export function productWrite(request: Request, permission: string, run: (client: Client, context: Context, body: Body) => Promise<unknown>, status = 200) {
  return workspaceRoute(request, { permission, billingWrite: true }, async ({ client, session }) => {
    const body = await readJson(request).catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
    return ok(toWire(await run(client as Client, salesContext(session), body as Body)) as Record<string, unknown>, status);
  });
}

// For multipart routes, which read the body themselves.
export function productUpload(request: Request, permission: string, run: (client: Client, context: Context) => Promise<unknown>, status = 200) {
  return workspaceRoute(request, { permission, billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, salesContext(session))) as Record<string, unknown>, status));
}

export async function readFile(request: Request, { spreadsheetOnly = false } = {}) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Choose a file to upload.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
  if (spreadsheetOnly && !/\.(csv|xlsx)$/i.test(file.name)) throw new HttpError(400, "Upload a .csv or .xlsx file.");
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name.slice(0, 240),
    field: (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    },
  };
}

export function csvResponse(csv: string, fileName: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const FILTER_KEYS = ["view", "search", "type", "categoryId", "includeSubcategories", "status", "sellable", "purchasable", "inventoryTracked", "trackingType", "brand", "hsnSac", "taxCategoryId", "parentItemId", "sort", "direction"] as const;

export function productFiltersFromUrl(url: URL) {
  const filters: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  for (const key of ["limit", "offset"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = Number(value);
  }
  return filters;
}
