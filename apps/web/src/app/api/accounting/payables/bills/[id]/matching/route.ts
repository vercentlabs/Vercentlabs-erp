import {
  capturePayablesGovernanceSnapshot,
  evaluateVendorBillMatch,
  getVendorBillMatch,
  overrideVendorBillMatch,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/modules/accounting";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const { context } = await accountingSession();
    const { id } = await route.params;
    return ok({
      match: await tenantTransaction(context.organizationId, (client) =>
        getVendorBillMatch(client, context, id),
      ),
    });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "evaluate");
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const match =
          action === "evaluate"
            ? await evaluateVendorBillMatch(client, context, id, input)
            : action === "override"
              ? await overrideVendorBillMatch(client, context, id, input)
              : await Promise.reject(
                  new HttpError(400, "Unsupported matching action."),
                );
        await capturePayablesGovernanceSnapshot(
          client,
          context,
          id,
          action === "override" ? "match_overridden" : "match_evaluated",
        );
        return match;
      },
    );
    return ok({ result });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
