import { importOpeningStock } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryUpload } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Multipart: file (CSV / XLSX), dryRun ("true" checks and reports only; "false" adds the lines to the draft).
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryUpload(request, async (client, context, upload) =>
    ({ result: await importOpeningStock(client, context, id, { bytes: upload.bytes, fileName: upload.fileName, dryRun: upload.field("dryRun") !== "false" }) }), 200, OPENING_STOCK_PERMISSIONS.view);
}
