import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { dispatchNurtureQueueNotificationsHandler } from "../src/handlers/crm-nurture-queue-dispatch.js";

const org = "11111111-1111-4111-8111-111111111111";
const lead = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";

// 2026-09-10 is a Thursday; 10:00 UTC = 15:30 Asia/Kolkata — inside the
// fixed 09:00-18:00 Mon-Fri window crm-nurture-queue-dispatch.js uses.
const IN_HOURS = new Date("2026-09-10T10:00:00.000Z").getTime();
// Same Thursday, 03:00 UTC = 08:30 IST — before the window opens.
const OUT_OF_HOURS = new Date("2026-09-10T03:00:00.000Z").getTime();

function fakeRuntime({ claimed = [], leads = new Map() } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE tenant.crm_lead_nurture_queue queue"))
        return { rows: claimed };
      if (sql.includes("SELECT lead.id,lead.code,lead.full_name,lead.company_name,lead.owner_user_id")) {
        const ids = values[1];
        return { rows: ids.map((id) => leads.get(id)).filter(Boolean) };
      }
      if (sql.includes("INSERT INTO notifications("))
        return { rows: [{ id: "notif-1" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return {
    calls,
    runtime: {
      pool: {},
      organizationId: org,
      async withTenantClient(_pool, _orgId, callback) {
        return callback(client);
      },
    },
  };
}

test("CRM-VNEXT-052 worker: an idle tick with nothing due is a clean no-op", async () => {
  mock.timers.enable({ apis: ["Date"], now: IN_HOURS });
  try {
    const { runtime } = fakeRuntime();
    const result = await dispatchNurtureQueueNotificationsHandler(null, null, {}, runtime);
    assert.equal(result.claimed, 0);
    assert.equal(result.notified, 0);
    assert.equal(result.skipped, 0);
  } finally {
    mock.timers.reset();
  }
});

test("CRM-VNEXT-052 worker: a due, claimed nurture item notifies its Lead's owner in-app", async () => {
  mock.timers.enable({ apis: ["Date"], now: IN_HOURS });
  try {
    const leads = new Map([[lead, { id: lead, code: "L-1", full_name: "Acme Corp", company_name: "Acme", owner_user_id: user, owner_name: "Seller", owner_email: null }]]);
    const claimed = [{ id: "queue-1", organization_id: org, lead_id: lead, recommended_action: "call", due_at: "2026-09-10T09:00:00.000Z", status: "active" }];
    const { runtime, calls } = fakeRuntime({ claimed, leads });
    const result = await dispatchNurtureQueueNotificationsHandler(null, null, {}, runtime);
    assert.equal(result.claimed, 1);
    assert.equal(result.notified, 1);
    assert.equal(result.skipped, 0);
    assert.ok(calls.some(({ sql, values }) => sql.includes("INSERT INTO notifications(") && values[1] === user));
  } finally {
    mock.timers.reset();
  }
});

test("CRM-VNEXT-052 worker: a claimed item whose Lead has no resolvable owner is skipped, not delivered to nobody", async () => {
  mock.timers.enable({ apis: ["Date"], now: IN_HOURS });
  try {
    const leads = new Map([[lead, { id: lead, code: "L-1", full_name: "Acme Corp", company_name: "Acme", owner_user_id: null, owner_name: null, owner_email: null }]]);
    const claimed = [{ id: "queue-1", organization_id: org, lead_id: lead, recommended_action: "call", due_at: "2026-09-10T09:00:00.000Z", status: "active" }];
    const { runtime, calls } = fakeRuntime({ claimed, leads });
    const result = await dispatchNurtureQueueNotificationsHandler(null, null, {}, runtime);
    assert.equal(result.skipped, 1);
    assert.equal(result.notified, 0);
    assert.ok(!calls.some(({ sql }) => sql.includes("INSERT INTO notifications(")));
  } finally {
    mock.timers.reset();
  }
});

test("CRM-VNEXT-052 worker: the claim itself is the idempotency mechanism — notified_at is set atomically under FOR UPDATE SKIP LOCKED, not a separate dispatching state", async () => {
  mock.timers.enable({ apis: ["Date"], now: IN_HOURS });
  try {
    const { runtime } = fakeRuntime();
    await dispatchNurtureQueueNotificationsHandler(null, null, {}, runtime);
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../api/src/modules/crm/lead-intelligence.js", import.meta.url), "utf8"));
    assert.match(source, /FOR UPDATE SKIP LOCKED/);
    assert.match(source, /SET notified_at=now\(\)/);
  } finally {
    mock.timers.reset();
  }
});

// F016 §7 closeout — the "no-activity rule" delivery channel must respect
// working hours like every other F016 notification, not fire at 2am.
test("F016 §7: outside configured business hours, the tick defers entirely — no claim is even attempted, so notified_at is never consumed on an item nobody will see for hours", async () => {
  mock.timers.enable({ apis: ["Date"], now: OUT_OF_HOURS });
  try {
    const { runtime, calls } = fakeRuntime({ claimed: [{ id: "queue-1", organization_id: org, lead_id: lead, due_at: "2026-09-10T02:00:00.000Z", status: "active" }] });
    const result = await dispatchNurtureQueueNotificationsHandler(null, null, {}, runtime);
    assert.equal(result.deferred, true);
    assert.equal(result.claimed, 0);
    assert.ok(!calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_lead_nurture_queue queue")), "claiming must not even be attempted outside business hours");
  } finally {
    mock.timers.reset();
  }
});
