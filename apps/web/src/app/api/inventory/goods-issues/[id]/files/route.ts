import { listGoodsIssueFiles, prepareGoodsIssueFileUpload, uploadGoodsIssueFile } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead, inventoryUpload } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Evidence: requisitions, maintenance tickets, disposal approvals, photos, scrap certificates. Multipart: file.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryRead(request, async (client, context) => ({ files: await listGoodsIssueFiles(client, context, id) }), GOODS_ISSUE_PERMISSIONS.view);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryUpload(request, async (client, context, upload) => {
    const prepared = await prepareGoodsIssueFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadGoodsIssueFile(client, context, id, { prepared }) };
  }, 201, GOODS_ISSUE_PERMISSIONS.view);
}
