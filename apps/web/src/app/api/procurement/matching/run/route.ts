import { runProcurementMatch } from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/lib/http";
import { procurementSession, tenantTransaction } from "@/lib/procurement-route";
import { procurementMatchSchema } from "@/lib/procurement-validation";
import { assertSameOriginOrMobile } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await procurementSession(true);
    const input = procurementMatchSchema.parse(await readJson(request));
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        runProcurementMatch(client, context, input),
      ),
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
