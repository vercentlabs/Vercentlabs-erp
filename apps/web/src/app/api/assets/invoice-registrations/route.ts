import { createAssetsFromInvoice, listInvoiceRegistrationBatches } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET the registration batches (?invoiceId=) · POST { invoiceId, idempotencyKey, lines, commission?, requestCapitalization?, capitalizationDate? } — create (or return) one registration.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => listInvoiceRegistrationBatches(client, context, { invoiceId: url.searchParams.get("invoiceId") ?? undefined }));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createAssetsFromInvoice(client, context, input));
}
