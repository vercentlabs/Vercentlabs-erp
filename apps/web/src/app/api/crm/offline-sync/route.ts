import { applyOfflineBatch, assertSameOriginOrMobile, requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// The mobile app's offline mutation queue (apps/mobile/src/modules/crm/
// data/offline-hardening.ts's flushCrmOfflineBatch, POST /crm/offline-sync
// against this exact path) had NO backend route at all until this pass —
// confirmed by a direct filesystem search before writing this file, a real
// pre-existing gap discovered during the mobile-compatibility audit, not
// something this session broke.
//
// Mobile-audit finding (same bypass class as Checkpoint #2's HTTP-route
// authorization gap, found via a different entry point): applyOfflineBatch/
// applyOfflineMutation dispatch straight to createCrmRecord("leads",...)/
// moveOpportunityStage/createCrmTask/createCrmFollowUp/completeCrmTask/
// completeCrmFollowUp per mutation, and NONE of those (nor offline-sync.js
// itself) check an organizational manage-permission internally — confirmed
// by grepping the entire services/api/src/modules/crm tree for any
// requirePermission/requireSessionPermission call, finding zero. A batch
// mixes multiple resource types, so a single flat permission (the generic
// /api/crm/[resource] route's pattern) doesn't fit; instead this route
// checks every permission actually required by the resource/operation
// combinations present in the batch before calling applyOfflineBatch at
// all, and fails the whole request closed (403) if any is missing, rather
// than silently letting an under-permissioned mutation through inside the
// batch.
const RESOURCE_OPERATION_PERMISSIONS: Record<string, string> = {
  "leads:create": CRM_PERMISSIONS.leadsManage,
  "opportunities:stage": CRM_PERMISSIONS.opportunitiesManage,
  "activities:create": CRM_PERMISSIONS.activitiesManage,
  "activities:complete": CRM_PERMISSIONS.activitiesManage,
};

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as { mutations?: Array<{ resource?: string; operation?: string }> };
    const mutations = Array.isArray(input.mutations) ? input.mutations : [];
    if (!mutations.length) throw new HttpError(400, "At least one offline mutation is required.");
    if (mutations.length > 50) throw new HttpError(400, "Offline batches are limited to 50 mutations.");

    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, undefined, { mutation: true });
      const requiredPermissions = new Set<string>();
      for (const mutation of mutations) {
        const permission = RESOURCE_OPERATION_PERMISSIONS[`${mutation.resource}:${mutation.operation}`];
        if (permission) requiredPermissions.add(permission);
      }
      for (const permission of requiredPermissions) requireSessionPermission(session, permission);
      return applyOfflineBatch(client, crmContext(session), { mutations });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
