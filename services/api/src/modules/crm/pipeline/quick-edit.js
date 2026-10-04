// The light changes made straight from a pipeline card: stage, expected
// close date, owner, priority, probability and next step. Anything more is
// edited on the opportunity itself.
//
// Each field goes through the opportunity operation that owns it, so a quick
// edit is checked, recorded and audited exactly like the same change made on
// the opportunity page. All of them run in the caller's transaction: either
// every field is saved or none is.
import { assignOpportunity } from "../opportunities/assignment.js";
import { assertNotStale, getOpportunity, lockOpportunity, updateOpportunity } from "../opportunities/records.js";
import { changeOpportunityStage, setOpportunityProbability } from "../opportunities/stages.js";

const has = (input, field) => Object.prototype.hasOwnProperty.call(input, field);

// input: any of { stageId, expectedCloseDate, ownerUserId, priority, probability, nextStep }, plus expectedUpdatedAt
// and warn (see changeOpportunityStage).
// Returns the opportunity as it is after the change.
export async function quickEditOpportunity(client, context, opportunityId, input = {}) {
  const before = await lockOpportunity(client, context, opportunityId);
  // Checked once, against what the user was looking at; the steps below then build on each other.
  assertNotStale(before, input.expectedUpdatedAt);

  const fields = Object.fromEntries(["expectedCloseDate", "priority", "nextStep"].filter((field) => has(input, field)).map((field) => [field, input[field]]));
  if (Object.keys(fields).length) await updateOpportunity(client, context, before.id, fields);
  if (has(input, "ownerUserId") && (input.ownerUserId || null) !== before.owner_user_id) await assignOpportunity(client, context, before.id, { ownerUserId: input.ownerUserId || null });
  if (has(input, "stageId") && input.stageId !== before.stage_id) await changeOpportunityStage(client, context, before.id, { stageId: input.stageId, warn: input.warn === true });
  if (has(input, "probability")) await setOpportunityProbability(client, context, before.id, { probability: input.probability });
  return getOpportunity(client, context, before.id);
}
