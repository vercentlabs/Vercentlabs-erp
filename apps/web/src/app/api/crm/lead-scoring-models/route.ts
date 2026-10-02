import {
  createLeadScoringModel,
  listLeadScoringModels,
} from "@vercentlabs/api/crm";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F027. listLeadScoringModels/createLeadScoringModel/etc (model-config.js)
// govern the real scoring engine (scoring-engine.js's activeModel() reads
// tenant.crm_lead_scoring_models exclusively) — NOT the legacy generic
// "scoring-rules" resource (tenant.crm_scoring_rules), which the engine
// never reads. Module-access-only
// at the route: assertSensitiveLeadIntelligenceAccess/assertConfigPermission
// gate reads/writes internally.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const rows = await listLeadScoringModels(client, crmContext(session));
      return ok({ rows });
    },
  );
}

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", billingWrite: true },
    async ({ client, session }) => {
      const input = (await readJson(request)) as Record<string, unknown>;
      const record = await createLeadScoringModel(
        client,
        crmContext(session),
        input,
      );
      return ok({ record }, 201);
    },
  );
}
