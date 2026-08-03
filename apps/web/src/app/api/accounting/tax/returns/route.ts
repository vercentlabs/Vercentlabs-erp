import {
  captureTaxGovernanceSnapshot,
  createTaxReturn,
  listTaxReturns,
} from "@vercentlabs/api";

import { rethrowAccountingError } from "@/lib/accounting";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { taxReturnSchema } from "@/lib/accounting-validation";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const filters = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    const returns = await tenantTransaction(context.organizationId, (client) =>
      listTaxReturns(client, context, filters),
    );
    return ok({ returns });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const input = taxReturnSchema.parse(await readJson(request));
    const taxReturn = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await createTaxReturn(client, context, input);
        await captureTaxGovernanceSnapshot(
          client,
          context,
          String(created.id),
          "return_generated",
        );
        return created;
      },
    );
    return ok({ taxReturn }, 201);
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
