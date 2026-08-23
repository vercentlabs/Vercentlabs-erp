import { createProcurementRecord, listProcurementRecords } from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/core/http";
import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
import { parseProcurementCreate } from "@/modules/procurement/validation";
import { assertSameOriginOrMobile } from "@/core/security";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const { context } = await procurementSession();
    const { resource } = await params;
    const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        listProcurementRecords(client, context, resource, filters),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await procurementSession(true);
    const { resource } = await params;
    const input = parseProcurementCreate(resource, await readJson(request));
    const record = await tenantTransaction(context.organizationId, (client) =>
      createProcurementRecord(client, context, resource, input),
    );
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
