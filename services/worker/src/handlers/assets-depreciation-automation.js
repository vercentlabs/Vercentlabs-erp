import { z } from "zod";
import { runDepreciationAutomation } from "@vercentlabs/api";

export const JOB_TYPE = "assets.depreciation.automation";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Assets — Automatic Depreciation Accounting: verifies interrupted postings, then prepares (and, when Finance enabled it, posts) the month that
// is ready. Re-running is safe: the execution is claimed once per book and month and posting is idempotent, so a retry or an overlapping tick
// never prepares or posts twice. The worker acts with the Company-scoped preparation authority only; posting acts as the policy's Finance user.
export async function runDepreciationAutomationHandler(client, systemContext) {
  return runDepreciationAutomation(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_worker"], permissions: [] }, { trigger: "SCHEDULED" });
}
