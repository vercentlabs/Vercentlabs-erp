import { listInspectionEvidence, prepareInspectionEvidenceUpload, uploadInspectionEvidence } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";
import { qualityContext } from "@/features/quality/shared/quality-context";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// An inspection's evidence: photos of samples, certificates, laboratory reports. Multipart: file.
type Params = { params: Promise<{ inspectionId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return qualityRead(request, async (client, context) => ({ files: await listInspectionEvidence(client, context, inspectionId) }), "quality.inprocess.view");
}
export async function POST(request: Request, ctx: Params) {
  const { inspectionId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.inprocess.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareInspectionEvidenceUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadInspectionEvidence(client, qualityContext(session), inspectionId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
