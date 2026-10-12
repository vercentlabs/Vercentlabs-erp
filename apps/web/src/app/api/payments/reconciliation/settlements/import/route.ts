import { z } from "zod";

import { previewSettlementImport } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: upload a settlement report (CSV / XLSX as base64, or normalized provider lines) and preview it — nothing is recorded yet.
const schema = z.object({
  merchantAccountId: z.string().uuid(),
  adapterCode: z.string().trim().max(40).optional(),
  fileName: z.string().trim().max(200).optional(),
  contentBase64: z.string().max(8_000_000).optional(),
  lines: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(5000).optional(),
});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ import: await previewSettlementImport(client, context, input) }), 201, "pos.view");
}
