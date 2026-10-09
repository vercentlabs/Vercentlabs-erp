import { importCountEntries } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryUpload } from "@/features/inventory/shared/route-helpers";

// A filled count sheet (CSV or XLSX): every row checked first; any error and nothing is entered. Multipart: file.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryUpload(request, async (client, context, upload) => ({ result: await importCountEntries(client, context, id, { bytes: upload.bytes, fileName: upload.fileName }) }), 200,
    STOCK_COUNT_PERMISSIONS.import);
}
