import { listNonconformanceEvidence, prepareNonconformanceEvidenceUpload, uploadNonconformanceEvidence } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { readUpload } from "@/features/procurement/suppliers/server/supplier-http";
import { qualityContext } from "@/features/quality/shared/quality-context";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// An NCR's evidence: defect photos, investigation records, proof an action was done. Multipart: file.
type Params = { params: Promise<{ ncId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { ncId } = await ctx.params;
  return qualityRead(request, async (client, context) => ({ files: await listNonconformanceEvidence(client, context, ncId) }), "quality.nonconformance.view");
}
export async function POST(request: Request, ctx: Params) {
  const { ncId } = await ctx.params;
  return workspaceRoute(request, { module: "quality", permission: "quality.nonconformance.view", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const prepared = await prepareNonconformanceEvidenceUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return ok(toWire({ file: await uploadNonconformanceEvidence(client, qualityContext(session), ncId, { prepared }) }) as Record<string, unknown>, 201);
  });
}
