import { importReorderRules } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryUpload } from "@/features/inventory/shared/route-helpers";

// Bulk rules from CSV or XLSX (multipart: file; apply=true to apply). Without apply, or with any row in error, nothing changes: the preview lists
// every row with what it would do and its errors.
export async function POST(request: Request) {
  return inventoryUpload(request, async (client, context, upload) => ({
    import: await importReorderRules(client, context, { fileName: upload.fileName, bytes: upload.bytes, apply: upload.field("apply") === "true" }),
  }), 200, STOCK_REORDER_PERMISSIONS.import);
}
