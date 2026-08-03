import { registerMarketingEvent } from "@vercentlabs/api";
import { crmMarketingErrorResponse } from "@/lib/crm-marketing-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(
  request: Request,
  route: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await route.params;
    const rows = await query<Record<string, unknown>>(
      "SELECT * FROM tenant.crm_public_marketing_event($1)",
      [token],
    );
    const event = rows[0];
    if (!event) throw new HttpError(404, "Published event not found.");
    const input = (await request.json()) as Record<string, unknown>;
    const context = {
      organizationId: String(event.organization_id),
      userId: "00000000-0000-4000-8000-000000000000",
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const result = await tenantTransaction(context.organizationId, (client) =>
      registerMarketingEvent(client, context, String(event.event_id), input),
    );
    return ok({ result }, 201);
  } catch (error) {
    return crmMarketingErrorResponse(error);
  }
}
