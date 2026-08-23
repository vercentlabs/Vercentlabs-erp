import { getProcurementRecord, updateProcurementRecord } from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/core/http";
import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
import { parseProcurementUpdate } from "@/modules/procurement/validation";
import { assertSameOriginOrMobile } from "@/core/security";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    const { context } = await procurementSession();
    const { resource, id } = await params;
    return ok({
      record: await tenantTransaction(context.organizationId, (client) =>
        getProcurementRecord(client, context, resource, id),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await procurementSession(true);
    const { resource, id } = await params;
    const input = parseProcurementUpdate(resource, await readJson(request));
    const record = await tenantTransaction(context.organizationId, (client) =>
      updateProcurementRecord(client, context, resource, id, input),
    );
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
