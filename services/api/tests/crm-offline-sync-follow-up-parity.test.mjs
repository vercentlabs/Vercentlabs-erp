import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// §21 closeout — offline-sync.js's activities:create/activities:complete
// mutation handlers already special-cased activity_type='task' (routing
// through the real createCrmTask/completeCrmTask, not a raw INSERT/UPDATE)
// but NOT 'follow_up' — an offline-queued Follow-up create/complete fell
// through to the generic raw SQL branch, bypassing createCrmFollowUp's own
// validation and completeCrmFollowUp's reminder-cancellation side effect
// entirely. This is a source-assertion test (not a full mock-client
// behavioral test, given the many query branches applyOfflineMutation's
// idempotency/conflict-detection path already requires) pinning that the
// fix routes follow_up through the SAME canonical domain functions task
// already used as its own precedent.
const source = fs.readFileSync(new URL("../src/modules/crm/crm-data-operations-and-customization/offline-sync.js", import.meta.url), "utf8");

test("offline-sync: activities:create routes activity_type='follow_up' through the real createCrmFollowUp, not the generic raw INSERT", () => {
  assert.match(source, /import \{ createCrmFollowUp, completeCrmFollowUp \} from "\.\.\/seller-activity-and-follow-up-workspace\/follow-ups\/follow-up-operations\.js";/);
  const createBranch = source.match(/if \(activityType === "task"\)[\s\S]*?\n {4}\} else \{/)?.[0] || "";
  assert.match(createBranch, /else if \(activityType === "follow_up"\)/);
  assert.match(createBranch, /await createCrmFollowUp\(client, context, \{/);
  // createCrmFollowUp itself throws if activityType/status are present in
  // its input (server-governed) — the fix must strip them before calling.
  assert.match(createBranch, /const \{ activityType: _activityType, status: _status, \.\.\.rest \} = p;/);
});

test("offline-sync: activities:complete routes activity_type='follow_up' through the real completeCrmFollowUp (reminder cancellation), not the generic raw UPDATE", () => {
  const completeBranch = source.match(/if \(target\?\.activity_type === "task"\)[\s\S]*?\n {4}\} else \{/)?.[0] || "";
  assert.match(completeBranch, /else if \(target\?\.activity_type === "follow_up"\)/);
  assert.match(completeBranch, /await completeCrmFollowUp\(client, context, m\.recordId,/);
});

test("offline-sync: Task create/complete already routed through createCrmTask/completeCrmTask BEFORE this pass — regression guard, not newly introduced by this fix", () => {
  assert.match(source, /await createCrmTask\(client, context, \{/);
  assert.match(source, /await completeCrmTask\(client, context, m\.recordId,/);
});
