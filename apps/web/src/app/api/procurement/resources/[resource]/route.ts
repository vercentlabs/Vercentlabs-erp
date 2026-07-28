import { createProcurementRecord, listProcurementRecords } from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/lib/http";
import { procurementSession, tenantTransaction } from "@/lib/procurement-route";
import { parseProcurementCreate } from "@/lib/procurement-validation";
import { assertSameOriginOrMobile } from "@/lib/security";

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
