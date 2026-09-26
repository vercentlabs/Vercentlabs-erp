import { createLeadScoringModel, listLeadScoringModels } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

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
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const rows = await listLeadScoringModels(client, crmContext(session));
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createLeadScoringModel(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
