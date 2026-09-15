import assert from "node:assert/strict";
import test from "node:test";

import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  NotificationError,
} from "../src/core/notifications.js";

const session = { organizationId: "org-1", userId: "user-1" };

test("listNotifications scopes strictly to organization + user, defaulting to 'all'", async () => {
  let captured;
  const client = { query: async (sql, values) => { captured = values; return { rows: [] }; } };
  await listNotifications(client, session);
  assert.deepEqual(captured, ["org-1", "user-1", "all", 50]);
});

test("markNotificationRead 404s when the notification does not belong to this user/org", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    markNotificationRead(client, session, "not-mine"),
    (error) => error instanceof NotificationError && error.status === 404,
  );
});

test("markNotificationRead is idempotent — marking an already-read notification again does not error", async () => {
  const client = {
    query: async (sql) => {
      if (/UPDATE notifications/.test(sql)) return { rows: [] }; // already read, no row matched read_at IS NULL
      return { rows: [{ id: "n-1", read_at: new Date("2026-01-01") }] };
    },
  };
  const result = await markNotificationRead(client, session, "n-1");
  assert.equal(result.id, "n-1");
});

test("getUnreadNotificationCount and markAllNotificationsRead scope to organization + user", async () => {
  const countClient = { query: async (sql, values) => { assert.deepEqual(values, ["org-1", "user-1"]); return { rows: [{ count: 3 }] }; } };
  assert.equal(await getUnreadNotificationCount(countClient, session), 3);

  const markAllClient = { query: async (sql, values) => { assert.deepEqual(values, ["org-1", "user-1"]); return { rows: [{ id: "n-1" }, { id: "n-2" }] }; } };
  const result = await markAllNotificationsRead(markAllClient, session);
  assert.equal(result.updated, 2);
});
