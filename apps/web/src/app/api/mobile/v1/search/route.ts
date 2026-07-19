import { listCrmRecords } from "@vercent/api";
import { requireCrmView } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request); requireCrmView(session);
    const search = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (search.length < 2 || search.length > 100) throw new HttpError(400, "Search must contain 2 to 100 characters.");
    const context = crmContext(session);
    const results = await tenantTransaction(context.organizationId, async (client) => {
      const output: Array<Record<string, unknown>> = [];
      for (const resource of ["leads", "opportunities", "activities"] as const) {
        const result = await listCrmRecords(client, context, resource, { search, limit: 8 });
        output.push(...result.rows.map((record) => ({ resource, record })));
      }
      return output;
    });
    return mobileOk(request, { results });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
