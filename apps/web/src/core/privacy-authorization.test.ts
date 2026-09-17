import { test } from "node:test";
import assert from "node:assert/strict";

import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { assertPrivacyManage } from "./privacy-authorization.ts";
import { HttpError } from "./http-errors.ts";

// Stage A2 §16 (SEC-002): a real behavioral negative test for the gate
// deferred from the F002 §13 checkpoint. platform.privacy.manage is
// deliberately excluded from the default "privileged" role bundle
// (packages/permissions/src/roles.js) — an ordinary CRM manager holding
// crm.accounts.manage, or even every other CRM permission, must still be
// rejected here.
test("assertPrivacyManage rejects a caller without platform.privacy.manage, even a broad CRM admin", () => {
  assert.throws(
    () => assertPrivacyManage({ permissions: ["crm.view", "crm.accounts.manage", "crm.settings.manage", "crm.privacy.manage"] }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("assertPrivacyManage rejects a caller with no permissions array at all", () => {
  assert.throws(
    () => assertPrivacyManage({}),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test("assertPrivacyManage allows a caller who actually holds platform.privacy.manage", () => {
  assert.doesNotThrow(() => assertPrivacyManage({ permissions: [CORE_PERMISSIONS.platformPrivacyManage] }));
});
