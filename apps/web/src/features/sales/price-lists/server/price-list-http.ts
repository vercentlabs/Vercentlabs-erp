import "server-only";

// Request helpers for the routes under /api/sales/price-lists. workspaceRoute
// checks the permission and opens the tenant
// transaction; the route calls one price list operation, which owns every rule.
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
type Snapshot = { modules: ReadonlyArray<{ moduleId: string; released: boolean; enabled: boolean; reason?: string }> } | null;

// Price lists are shared pricing (Sales audit): Sales prices documents from them and Point of Sale its counter, so either app opens them —
// a company with POS alone sets its selling prices here too.
const PRICING_APPS = ["sales", "point-of-sale"];
function requirePricingApp(snapshot: Snapshot) {
  const has = (snapshot?.modules ?? []).some((entry) => PRICING_APPS.includes(entry.moduleId) && entry.released && entry.enabled && entry.reason !== "not_entitled");
  if (!has) throw new HttpError(403, "Price lists need the Sales or Point of Sale app.");
}

export type PriceListRouteParams = { params: Promise<{ id: string }> };

export function priceListRead(request: Request, permission: string, run: (client: Client, context: Context) => Promise<unknown>) {
  return workspaceRoute(request, { snapshot: true, permission }, async ({ client, session, snapshot }) => {
    requirePricingApp(snapshot as Snapshot);
    const result = await run(client as Client, salesContext(session));
    return result instanceof Response ? result : ok(toWire(result) as Record<string, unknown>);
  });
}

export function priceListWrite(request: Request, permission: string, run: (client: Client, context: Context, body: Body) => Promise<unknown>, status = 200) {
  return workspaceRoute(request, { snapshot: true, permission, billingWrite: true }, async ({ client, session, snapshot }) => {
    requirePricingApp(snapshot as Snapshot);
    const body = await readJson(request).catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
    return ok(toWire(await run(client as Client, salesContext(session), body as Body)) as Record<string, unknown>, status);
  });
}

export function priceListUpload(request: Request, permission: string, run: (client: Client, context: Context) => Promise<unknown>) {
  return workspaceRoute(request, { snapshot: true, permission, billingWrite: true }, async ({ client, session, snapshot }) => {
    requirePricingApp(snapshot as Snapshot);
    return ok(toWire(await run(client as Client, salesContext(session))) as Record<string, unknown>);
  });
}

export async function readSpreadsheet(request: Request) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Upload a CSV or XLSX file.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV or XLSX file.");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
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
