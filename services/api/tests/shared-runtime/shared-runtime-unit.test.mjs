// Pure/unit rules of the shared runtime services (no database). Part of `pnpm verify:shared-runtime`.
import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_COMMANDS,
  ApprovalError,
  createApprovalRequest,
  createNotification,
  decodeAuditCursor,
  encodeAuditCursor,
  getApprovalCommand,
  jobPresentation,
  NOTIFICATION_CATEGORIES,
  projectNotificationsForViewer,
  redactJobError,
  safeAuditPayload,
  setNotificationPreference,
  USER_VISIBLE_JOB_TYPES,
  validateApprovalDecision,
} from "../../src/core/platform/index.js";
import { REGISTERED_APPROVAL_COMMAND_KEYS, approvalHref } from "../../src/orchestration/approvals/registry.js";
import { normalizeSearchQuery, searchableProviders } from "../../src/orchestration/search/service.js";

const session = (permissions = [], roleSlugs = []) => ({ organizationId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", permissions, roleSlugs });

test("notification categories: unique keys, module-owned, in-app only", () => {
  const keys = NOTIFICATION_CATEGORIES.map((category) => category.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(NOTIFICATION_CATEGORIES.every((category) => category.moduleKey && category.displayName && !/_/.test(category.displayName)));
});

test("createNotification refuses unknown categories and non-application links", async () => {
  const client = { query: async () => ({ rows: [{ id: "n" }] }) };
  await assert.rejects(createNotification(client, { organizationId: "o", userId: "u", category: "made_up", title: "t", message: "m" }), (e) => e.code === "NOTIFICATION_CATEGORY_UNKNOWN");
  await assert.rejects(createNotification(client, { organizationId: "o", userId: "u", category: "crm_assignment", title: "t", message: "m", href: "https://evil.example" }), (e) => e.code === "NOTIFICATION_HREF_INVALID");
  assert.equal(await createNotification(client, { organizationId: "o", userId: "u", category: "crm_assignment", title: "t", message: "m", href: "/crm/leads/1" }), true);
});

test("preferences: only in-app channel and registered categories", async () => {
  const client = { query: async () => ({ rows: [] }) };
  for (const channel of ["email", "push"]) {
    await assert.rejects(setNotificationPreference(client, session(), { channel, category: "crm_assignment", enabled: false }), (e) => e.code === "NOTIFICATION_CHANNEL_UNSUPPORTED");
  }
  await assert.rejects(setNotificationPreference(client, session(), { category: "auth_password_reset", enabled: false }), (e) => e.code === "NOTIFICATION_CATEGORY_UNKNOWN");
});

test("read-time projection: inaccessible module redacts; adapters decide record visibility; nothing is dropped", async () => {
  const rows = [
    { id: "1", module_key: "crm", title: "Acme deal", message: "secret", href: "/crm/opportunities/x", entity_type: "crm_opportunity", entity_id: "x", read_at: null },
    { id: "2", module_key: "sales", title: "Quote", message: "m", href: "/sales/quotations/y", read_at: null },
    { id: "3", module_key: null, title: "System", message: "m", href: null, read_at: null },
  ];
  const projected = await projectNotificationsForViewer(rows, {
    accessibleModules: ["crm"],
    adapters: { crm: async (items) => items.map((item) => ({ ...item, title: "CRM record updated", href: null, redacted: true })) },
  });
  assert.equal(projected.length, 3, "redacted items stay in the list (unread count and list agree)");
  assert.equal(projected[0].redacted, true);
  assert.equal(projected[1].redacted, true);
  assert.equal(projected[1].href, null);
  assert.ok(!JSON.stringify(projected[1]).includes("Quote"));
  assert.equal(projected[2].title, "System");
  assert.ok(projected.every((row) => !("entity_id" in row)), "target ids are never sent to the browser");
});

test("approval catalogue and orchestration registry match exactly", () => {
  assert.deepEqual([...REGISTERED_APPROVAL_COMMAND_KEYS].sort(), APPROVAL_COMMANDS.map((command) => command.key).sort());
  assert.equal(getApprovalCommand("made.up"), null);
  assert.equal(approvalHref("sales.order.approve", { orderId: "o1" }), "/sales/orders/o1");
  assert.equal(approvalHref("made.up", {}), null);
});

test("createApprovalRequest fails closed on unknown commands and incomplete payloads", async () => {
  const client = { query: async () => ({ rows: [{ id: "r", status: "pending", version: 1 }] }) };
  const base = { organizationId: session().organizationId, requestedBy: session().userId, entityId: "e1", title: "t" };
  await assert.rejects(createApprovalRequest(client, { ...base, commandKey: "made.up", payload: {} }), (e) => e instanceof ApprovalError && e.code === "APPROVAL_COMMAND_UNKNOWN");
  await assert.rejects(createApprovalRequest(client, { ...base, commandKey: "accounting.journal.approve", payload: { journalEntryId: "j" } }), (e) => e.code === "APPROVAL_PAYLOAD_INVALID");
});

test("decision validation: SoD, version, rejection note, one decision only", () => {
  const request = { status: "pending", version: 3, requested_by: "requester" };
  assert.throws(() => validateApprovalDecision(request, { decision: "approved", actorUserId: "requester" }), (e) => e.code === "SELF_APPROVAL_DENIED");
  assert.throws(() => validateApprovalDecision(request, { decision: "approved", expectedVersion: 2, actorUserId: "other" }), (e) => e.code === "APPROVAL_VERSION_CONFLICT");
  assert.throws(() => validateApprovalDecision(request, { decision: "rejected", actorUserId: "other" }), (e) => e.code === "APPROVAL_DECISION_INVALID");
  assert.equal(validateApprovalDecision(request, { decision: "cancelled", actorUserId: "requester" }).decision, "cancelled");
  assert.throws(() => validateApprovalDecision({ ...request, status: "approved" }, { decision: "approved", actorUserId: "other" }), (e) => e.code === "APPROVAL_ALREADY_DECIDED");
});

test("search input: minimum length, cap, wildcard neutralisation; providers gated by module and permission", () => {
  assert.equal(normalizeSearchQuery("a"), null);
  assert.equal(normalizeSearchQuery(" %_ "), null);
  assert.equal(normalizeSearchQuery("ac%me_\\co"), "ac me co");
  assert.equal(normalizeSearchQuery("x".repeat(500)).length, 100);
  assert.deepEqual(searchableProviders(session(["crm.view", "sales.view"]), ["sales"]).map((p) => p.moduleKey), ["sales", "sales"]);
  assert.deepEqual(searchableProviders(session([]), ["crm", "sales"]), []);
  assert.equal(searchableProviders(session([], ["organization_owner"]), ["crm", "sales"]).length, 6);
});

test("jobs: human labels, user-visible set, redacted errors", () => {
  assert.equal(jobPresentation("crm.leads.bulk_update").label, "Bulk lead update");
  assert.equal(jobPresentation("unknown.type").label, "Background task");
  assert.ok(!USER_VISIBLE_JOB_TYPES.includes("crm.pipeline.capture_daily_snapshot"));
  const redacted = redactJobError("connect failed postgresql://app:pw@db:5432/x token=abcd1234 Bearer eyJhbGciOi\n    at stack.js:1");
  assert.ok(!/postgresql:|pw@|abcd1234|eyJ|stack\.js/.test(redacted));
});

test("audit: stable cursor, defensive redaction and size cap", () => {
  const cursor = encodeAuditCursor({ created_at: "2026-09-26T10:00:00.000Z", id: "00000000-0000-4000-8000-000000000009" });
  assert.deepEqual(decodeAuditCursor(cursor), { at: "2026-09-26T10:00:00.000Z", id: "00000000-0000-4000-8000-000000000009" });
  assert.throws(() => decodeAuditCursor("bm90LWEtY3Vyc29y"), /cursor/);
  assert.deepEqual(safeAuditPayload({ password: "x", nested: { apiKey: "y", name: "ok" } }), { password: "[redacted]", nested: { apiKey: "[redacted]", name: "ok" } });
  assert.equal(safeAuditPayload({ blob: "z".repeat(20_000) }).truncated, true);
});
