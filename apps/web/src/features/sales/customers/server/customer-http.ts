import "server-only";

// Request helpers for the routes under /api/sales/customers. Each route is a
// thin shell: workspaceRoute authenticates, checks the Sales module and the
// permission and opens the tenant transaction, then the route calls one
// Customer Master operation from @vercentlabs/api/sales/customers, which owns
// every business rule.
import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// The uploaded import file (multipart field "file") and the other form fields.
export async function readUpload(request: Request) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Upload a CSV or XLSX file.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV or XLSX file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "The file is larger than 5 MB.");
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new HttpError(400, "Upload a .csv or .xlsx file.");
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

type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Context = ReturnType<typeof salesContext>;
type Body = Record<string, unknown>;

export type CustomerRouteParams = { params: Promise<{ id: string }> };

export function customerRead(request: Request, permission: string, run: (client: Client, context: Context) => Promise<unknown>) {
  return workspaceRoute(request, { module: "sales", permission }, async ({ client, session }) => {
    const result = await run(client as Client, salesContext(session));
    return result instanceof Response ? result : ok(toWire(result) as Record<string, unknown>);
  });
}

export function customerWrite(request: Request, permission: string, run: (client: Client, context: Context, body: Body) => Promise<unknown>, status = 200) {
  return workspaceRoute(request, { module: "sales", permission, billingWrite: true }, async ({ client, session }) => {
    const body = await readJson(request).catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
    return ok(toWire(await run(client as Client, salesContext(session), body as Body)) as Record<string, unknown>, status);
  });
}

// For multipart routes, which read the body themselves.
export function customerUpload(request: Request, permission: string, run: (client: Client, context: Context) => Promise<unknown>) {
  return workspaceRoute(request, { module: "sales", permission, billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, salesContext(session))) as Record<string, unknown>));
}

const FILTER_KEYS = [
  "view", "search", "status", "customerKind", "ownerUserId", "state", "countryCode", "gstRegistrationType", "currencyCode", "priceListId", "paymentTermId",
  "createdFrom", "createdTo", "hasOutstanding", "hasOverdue", "sort", "direction",
] as const;

// The list filters accepted from the query string (list and export).
export function customerFiltersFromUrl(url: URL) {
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
