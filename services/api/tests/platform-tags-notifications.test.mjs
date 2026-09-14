import assert from "node:assert/strict";
import test from "node:test";

import { createTagDefinition, assignEntityTag, TagError } from "../src/core/tags.js";
import { setNotificationPreference, NotificationPreferenceError } from "../src/core/notification-preferences.js";

test("createTagDefinition rejects a non-hex-color value", async () => {
  const client = { query: async () => ({ rows: [{}] }) };
  await assert.rejects(
    createTagDefinition(client, { organizationId: "org-1", userId: "user-1" }, {
      entityType: "crm.lead",
      name: "Hot",
      color: "not-a-color",
    }),
    (error) => error instanceof TagError && error.status === 400,
  );
});

test("assignEntityTag 404s when the target tag definition is not active or belongs to a different entity type (cannot cross-assign)", async () => {
  const client = {
    query: async (sql) => {
      if (/INSERT INTO entity_tags/.test(sql)) return { rows: [] }; // filtered out by the WHERE join -> no insert
      if (/SELECT entity_tag\.tag_id/.test(sql)) return { rows: [] }; // and no pre-existing assignment either
      return { rows: [] };
    },
  };
  await assert.rejects(
    assignEntityTag(client, { organizationId: "org-1", userId: "user-1" }, {
      tagId: "tag-1",
      entityType: "crm.lead",
      entityId: "lead-1",
    }),
    (error) => error instanceof TagError && error.status === 404,
  );
});

test("setNotificationPreference rejects an unknown channel", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    setNotificationPreference(client, { organizationId: "org-1", userId: "user-1" }, {
      channel: "carrier-pigeon",
      category: "approval",
    }),
    (error) => error instanceof NotificationPreferenceError && error.status === 400,
  );
});
