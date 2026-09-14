import { runProcurementMatchWithVendorBillImport } from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/core/http";
import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
import { procurementMatchSchema } from "@/modules/procurement/validation";
import { accountingContext } from "@/modules/accounting";
import { assertSameOriginOrMobile } from "@/core/security";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const { session, context } = await procurementSession(true);
    const input = procurementMatchSchema.parse(await readJson(request));
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        runProcurementMatchWithVendorBillImport(
          client,
          context,
          accountingContext(session),
          input,
        ),
      ),
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
