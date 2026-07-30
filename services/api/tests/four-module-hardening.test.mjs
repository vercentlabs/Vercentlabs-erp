import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Procurement lifecycle is server-owned and version guarded", () => {
  const service = read("services/api/src/procurement/index.js");
  const validation = read("apps/web/src/lib/procurement-validation.ts");
  assert.match(service, /INITIAL_DOCUMENT_STATUS/);
  assert.doesNotMatch(service, /const status = text\(input\.status/);
  assert.doesNotMatch(service, /!input\.allowLifecycleEdit/);
  assert.match(service, /AND status=\$6 AND version=\$7/);
  assert.match(validation, /expectedVersion: z\.coerce\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(validation, /controlled by the Procurement lifecycle/);
});

test("Procurement matching tolerance is policy controlled", () => {
  const service = read("services/api/src/procurement/index.js");
  assert.match(service, /matchingTolerancePolicy/);
  assert.match(service, /procurement\.matching\.override/);
  assert.match(service, /Tolerance override reason/);
});

test("Accounting settings and close controls reject unsafe shortcuts", () => {
  const setup = read("services/api/src/accounting/setup.js");
  const core = read("services/api/src/accounting/core.js");
  const close = read("services/api/src/accounting/close.js");
  assert.match(core, /export function strictBoolean/);
  assert.match(core, /normalized === "false"/);
  assert.doesNotMatch(setup, /Boolean\(input\[key\]\)/);
  assert.match(close, /ACCOUNTING_PERMISSIONS\.closeWaive/);
  assert.match(close, /Completion and waiver evidence require a type and reference/);
  assert.match(close, /Closed and locked periods can only be produced by a completed governed close run/);
});

test("Billing webhook claims use recoverable leases", () => {
  const route = read("apps/web/src/app/api/billing/webhooks/razorpay/route.ts");
  assert.match(route, /processing_lease_expires_at/);
  assert.match(route, /processing_attempts = processing_attempts \+ 1/);
  assert.match(route, /vercentlabs_checkout_session_id/);
  assert.match(route, /Retry this webhook/);
});

test("Mobile offline queue has bounded retry behaviour", () => {
  const database = read("apps/mobile/src/core/database/database.ts");
  const sync = read("apps/mobile/src/modules/crm/data/sync.ts");
  assert.match(database, /attempts < 5/);
  assert.match(database, /next_attempt_at/);
  assert.match(sync, /Unsupported offline mutation/);
  assert.match(sync, /markMutationSending/);
});

test("Sales orders require version-bound approval before confirmation", () => {
  const service = read("services/api/src/sales/index.js");
  const approvals = read("apps/web/src/lib/approval-commands.ts");
  assert.match(service, /export async function submitSalesOrder/);
  assert.match(service, /export async function approveSalesOrder/);
  assert.match(service, /sales\.order\.approve/);
  assert.match(service, /Only an approved order can be confirmed/);
  assert.doesNotMatch(service, /approval_status=CASE WHEN approval_status='pending' THEN 'approved'/);
  assert.match(approvals, /key: "sales\.order\.approve"/);
});

test("Business-data boolean imports use explicit value mapping", () => {
  const business = read("apps/web/src/lib/business-data-validation.ts");
  const validation = read("apps/web/src/lib/validation.ts");
  assert.match(business, /function booleanInput/);
  assert.match(business, /\["false", "0", "no", "n", "off"\]/);
  assert.doesNotMatch(business, /z\.coerce\.boolean/);
  assert.doesNotMatch(validation, /z\.coerce\.boolean/);
});

test("remaining hardening keeps billing, Procurement and amendments transaction-safe", () => {
  const billingVerify = read("apps/web/src/app/api/billing/verify/route.ts");
  const procurement = read("services/api/src/procurement/index.js");
  const sales = read("services/api/src/sales/index.js");
  const mobileMigrations = read("apps/mobile/src/core/database/migrations/index.ts");

  const checkoutLock = billingVerify.indexOf("FOR UPDATE");
  const subscriptionReplace = billingVerify.indexOf(
    "replaceOrganizationSubscriptionWithClient",
    billingVerify.indexOf("const result = await transaction"),
  );
  assert.ok(checkoutLock >= 0 && subscriptionReplace > checkoutLock);
  assert.match(billingVerify, /status = 'verifying'/);

  assert.match(procurement, /procurement_sourcing_awards/);
  assert.match(procurement, /WHERE organization_id=\$1 AND id=\$2\s+FOR UPDATE/);
  assert.match(procurement, /status='pending_amendment_approval'/);
  assert.match(procurement, /approvePurchaseOrderAmendment/);
  assert.match(procurement, /rejectPurchaseOrderAmendment/);
  assert.match(procurement, /received_quantity=\$3/);

  assert.match(sales, /sales\.order\.amendment\.approve/);
  assert.match(sales, /approval_request_id=\$1/);
  assert.match(sales, /pg_advisory_xact_lock/);
  assert.match(mobileMigrations, /runMobileMigrations/);
});
