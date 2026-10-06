import "server-only";

import { z } from "zod";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { toWire } from "@/core/wire";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// Supplier bodies are checked field by field by the Supplier Master module; the route only insists on an object.
export const bodySchema = z.record(z.string(), z.unknown());

type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

// A multipart request (an import file, an attachment), inside the same protected route composition as every procurement route.
export function supplierUpload(request: Request, run: (client: Client, context: ReturnType<typeof procurementContext>) => Promise<unknown>, status = 200) {
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, procurementContext(session))) as Record<string, unknown>, status));
}

export async function readUpload(request: Request) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Choose a file to upload.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
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

const FILTER_KEYS = ["view", "search", "status", "category", "buyerId", "countryCode", "stateCode", "currency", "paymentTermId", "gstRegistrationType", "sort", "direction"] as const;

// The list filters accepted from the query string (list and export).
export function supplierFiltersFromUrl(url: URL) {
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
