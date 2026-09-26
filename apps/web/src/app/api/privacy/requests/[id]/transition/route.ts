import { z } from "zod";

import { transitionPrivacyRequest } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The request FSM (received -> verified -> in_progress -> completed, or
// rejected/cancelled) is enforced by the domain under a row lock.
const schema = z.object({ status: z.enum(["verified", "in_progress", "completed", "rejected", "cancelled"]), resultPayload: z.unknown().optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformPrivacyManage, action: "privacy.requests.transition", auditDenial: true },
    async ({ client, session }) => {
      const input = schema.parse(await readJson(request));
      return ok({ record: await transitionPrivacyRequest(client, session, id, input.status, input.resultPayload) });
    },
  );
}
