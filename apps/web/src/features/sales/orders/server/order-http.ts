import "server-only";

import { HttpError } from "@/core/http";

const FILTER_KEYS = [
  "view", "search", "status", "confirmation", "reservation", "fulfillment", "invoicing", "deliveryOverdue", "readyToInvoice", "deliverable", "balance", "partyId", "ownerUserId", "warehouseId", "currencyCode", "quotationId", "opportunityId", "productId", "source",
  "dateFrom", "dateTo", "deliveryFrom", "deliveryTo", "sort", "direction", "limit", "offset",
] as const;

export function orderFiltersFromUrl(url: URL) {
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

export async function readUpload(request: Request) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Choose a file to upload.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "The file is larger than 10 MB.");
  return { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name.slice(0, 240) };
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
