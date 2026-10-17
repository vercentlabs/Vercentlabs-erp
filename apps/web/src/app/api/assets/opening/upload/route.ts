import { createOpeningBatch } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { toWire } from "@/core/wire";
import { assetsContext } from "@/features/assets/shared/assets-context";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// A register of existing assets (multipart: file .csv/.xlsx, cutoverDate) becomes a draft migration batch. The same file twice is one batch.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "assets", permission: "assets.opening.upload", billingWrite: true }, async ({ client, session }) => {
    const form = await request.formData().catch(() => { throw new HttpError(400, "Upload a CSV or XLSX file."); });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV or XLSX file.");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "The file is larger than 10 MB; split it.");
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new HttpError(400, "Upload a .csv or .xlsx file.");
    const cutoverDate = form.get("cutoverDate");
    const result = await createOpeningBatch(client, assetsContext(session), { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name.slice(0, 200), cutoverDate: typeof cutoverDate === "string" ? cutoverDate : "" });
    return ok(toWire(result) as Record<string, unknown>);
  });
}
