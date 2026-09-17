import { assertSameOriginOrMobile, createLeadScoringModel, listLeadScoringModels } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F027 Tranche I (Stage A). listLeadScoringModels/createLeadScoringModel/
// etc (model-config.js) already governed the real scoring engine
// (scoring-engine.js's activeModel() reads tenant.crm_lead_scoring_models
// exclusively) — this module's own header comment explicitly documents
// that it REPLACES the legacy generic "scoring-rules" resource
// (tenant.crm_scoring_rules), which the engine has never read for actual
// scoring. Confirmed by reading scoring-engine.js before wiring anything,
// so as not to build a setup screen for a dead system. Module-access-only
// at the route: assertSensitiveLeadIntelligenceAccess/assertConfigPermission
// gate reads/writes internally.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listLeadScoringModels(client, crmContext(session));
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return createLeadScoringModel(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
