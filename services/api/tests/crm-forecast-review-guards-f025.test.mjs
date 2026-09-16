import assert from "node:assert/strict";
import test from "node:test";

import { assertLifecycleUpdate } from "../src/modules/crm/crm-data-operations-and-customization/record-policy.js";

const owner = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";

// F025 Stage A2 §11 — the generic PATCH path has no per-resource
// "who may approve" concept beyond the transition table itself; without
// these guards a rep could self-approve their own forecast (or set a
// manager adjustment on themselves) through the exact same route they
// use to edit their own draft.

test("F025: a rep cannot move their own forecast submission to approved", () => {
  const before = { status: "submitted", ownerUserId: owner };
  assert.throws(
    () => assertLifecycleUpdate("forecast-submissions", before, { status: "approved" }, { userId: owner }),
    (error) => error.code === "CRM_FORECAST_SELF_REVIEW_FORBIDDEN" && error.status === 403,
  );
});

test("F025: a rep cannot move their own forecast submission to rejected", () => {
  const before = { status: "submitted", ownerUserId: owner };
  assert.throws(
    () => assertLifecycleUpdate("forecast-submissions", before, { status: "rejected" }, { userId: owner }),
    (error) => error.code === "CRM_FORECAST_SELF_REVIEW_FORBIDDEN",
  );
});

test("F025: a reviewer (a different user) CAN move a submission to approved", () => {
  const before = { status: "submitted", ownerUserId: owner };
  assert.doesNotThrow(() => assertLifecycleUpdate("forecast-submissions", before, { status: "approved" }, { userId: manager }));
});

test("F025: a rep CAN still submit their own draft (status change unrelated to approve/reject is unaffected)", () => {
  const before = { status: "draft", ownerUserId: owner };
  assert.doesNotThrow(() => assertLifecycleUpdate("forecast-submissions", before, { status: "submitted" }, { userId: owner }));
});

test("F025: a rep cannot set a manager adjustment on their own submission, even without a status change", () => {
  const before = { status: "submitted", ownerUserId: owner };
  assert.throws(
    () => assertLifecycleUpdate("forecast-submissions", before, { managerAdjustment: 5000 }, { userId: owner }),
    (error) => error.code === "CRM_FORECAST_SELF_ADJUSTMENT_FORBIDDEN" && error.status === 403,
  );
});

test("F025: a reviewer CAN set a manager adjustment on someone else's submission", () => {
  const before = { status: "submitted", ownerUserId: owner };
  assert.doesNotThrow(() => assertLifecycleUpdate("forecast-submissions", before, { managerAdjustment: 5000 }, { userId: manager }));
});

test("F025: an ownerless (team-level) submission has no self-review/self-adjustment concept to violate", () => {
  const before = { status: "submitted", ownerUserId: null };
  assert.doesNotThrow(() => assertLifecycleUpdate("forecast-submissions", before, { status: "approved" }, { userId: manager }));
  assert.doesNotThrow(() => assertLifecycleUpdate("forecast-submissions", before, { managerAdjustment: 1000 }, { userId: manager }));
});
