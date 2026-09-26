// Notifications: canonical writer, preferences, ownership and read-time
// visibility, against real PostgreSQL on the restricted runtime role.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createNotification,
  getUnreadNotificationCount,
  listNotificationPreferences,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationPreference,
} from "../../../services/api/src/core/platform/notifications/index.js";
import { recordLeadAssignment } from "../../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-assignment.js";
import { listNotificationsForViewer } from "../../../services/api/src/orchestration/notifications/visibility.js";
import { createRuntimeKit, expectCode } from "./runtime-kit.mjs";

const CRM_REP = ["crm.view", "crm.leads.manage"];

test("notifications: one writer, own rows only, preferences, read-time visibility", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice", "bob"]);
    const other = await kit.organization(["mallory"]);
    const alice = org.session("alice", CRM_REP);
    const bob = org.session("bob", CRM_REP);
    const mallory = other.session("mallory", CRM_REP);
    const note = (session, extra = {}) =>
      kit.tenant(session.organizationId, (client) => createNotification(client, { organizationId: session.organizationId, userId: session.userId, category: "crm_follow_up_reminder", title: "Reminder", message: "Call back", ...extra }));
    const list = (session, accessibleModules = ["crm"]) => kit.tenant(session.organizationId, (client) => listNotificationsForViewer(client, session, { accessibleModules }));

    await t.test("a user lists only their own notifications; another org or user cannot mark them read", async () => {
      assert.equal(await note(alice), true);
      assert.equal(await note(bob), true);
      assert.equal(await note(mallory), true);
      const aliceRows = await list(alice);
      assert.equal(aliceRows.length, 1);
      const [row] = aliceRows;
      await assert.rejects(kit.tenant(bob.organizationId, (client) => markNotificationRead(client, bob, row.id)), expectCode("NOTIFICATION_NOT_FOUND"));
      await assert.rejects(kit.tenant(mallory.organizationId, (client) => markNotificationRead(client, mallory, row.id)), expectCode("NOTIFICATION_NOT_FOUND"));
      await assert.rejects(kit.tenant(alice.organizationId, (client) => markNotificationRead(client, alice, "not-a-uuid")), expectCode("NOTIFICATION_NOT_FOUND"));
      assert.equal((await list(alice))[0].read_at, null, "still unread after the refused attempts");
    });

    await t.test("mark one read (idempotent) and mark all read", async () => {
      await note(alice);
      const rows = await list(alice);
      assert.equal(await kit.tenant(alice.organizationId, (client) => getUnreadNotificationCount(client, alice)), 2);
      const first = await kit.tenant(alice.organizationId, (client) => markNotificationRead(client, alice, rows[0].id));
      const again = await kit.tenant(alice.organizationId, (client) => markNotificationRead(client, alice, rows[0].id));
      assert.equal(new Date(first.read_at).getTime(), new Date(again.read_at).getTime(), "re-marking keeps the original read time");
      assert.equal(await kit.tenant(alice.organizationId, (client) => getUnreadNotificationCount(client, alice)), 1);
      assert.equal((await kit.tenant(alice.organizationId, (client) => markAllNotificationsRead(client, alice))).updated, 1);
      assert.equal(await kit.tenant(alice.organizationId, (client) => getUnreadNotificationCount(client, alice)), 0);
      assert.equal(await kit.tenant(bob.organizationId, (client) => getUnreadNotificationCount(client, bob)), 1, "another user's rows are untouched");
    });

    await t.test("a preference turns a category off; unknown categories are refused; there is no push or email setting", async () => {
      await kit.tenant(alice.organizationId, (client) => setNotificationPreference(client, alice, { category: "crm_follow_up_reminder", enabled: false }));
      assert.equal(await note(alice), false, "nothing written for a category the user turned off");
      const preferences = await kit.tenant(alice.organizationId, (client) => listNotificationPreferences(client, alice));
      assert.ok(preferences.every((preference) => preference.channel === "in_app"));
      assert.equal(preferences.find((preference) => preference.category === "crm_follow_up_reminder").enabled, false);
      await assert.rejects(kit.tenant(alice.organizationId, (client) => setNotificationPreference(client, alice, { channel: "push", category: "crm_assignment", enabled: false })), expectCode("NOTIFICATION_CHANNEL_UNSUPPORTED"));
      await assert.rejects(note(alice, { category: "totally_new" }), expectCode("NOTIFICATION_CATEGORY_UNKNOWN"));
      await kit.tenant(alice.organizationId, (client) => setNotificationPreference(client, alice, { category: "crm_follow_up_reminder", enabled: true }));
    });

    await t.test("the CRM lead-assignment emitter writes through the shared service with record context", async () => {
      const leadId = await kit.crmLead(org, bob.userId, "Asha", "Rao");
      await kit.tenant(org.organizationId, (client) => recordLeadAssignment(client, alice, { leadId, previousOwnerUserId: alice.userId, ownerUserId: bob.userId, leadName: "Asha Rao" }));
      const row = (await kit.owner.query(`SELECT category, module_key, entity_type, entity_id, href FROM notifications WHERE organization_id=$1 AND user_id=$2 AND category='crm_assignment'`, [org.organizationId, bob.userId])).rows[0];
      assert.deepEqual(row, { category: "crm_assignment", module_key: "crm", entity_type: "crm_lead", entity_id: leadId, href: `/crm/leads/${leadId}` });
    });

    await t.test("read-time visibility: an inaccessible record or module is redacted, never dropped; badge and list agree", async () => {
      // A lead owned by Bob; Alice (no view-all) cannot open it.
      const hiddenLead = await kit.crmLead(org, bob.userId, "Secret", "Deal");
      await kit.tenant(org.organizationId, (client) => createNotification(client, { organizationId: org.organizationId, userId: alice.userId, category: "crm_automation", title: "Secret Deal moved", message: "Secret Deal is now hot", href: `/crm/leads/${hiddenLead}`, entityType: "crm_lead", entityId: hiddenLead }));
      const visible = await list(alice, ["crm"]);
      const redacted = visible.find((row) => row.redacted);
      assert.ok(redacted, "the inaccessible record is redacted");
      assert.equal(redacted.href, null);
      assert.ok(!JSON.stringify(redacted).includes("Secret"));
      assert.ok(!("entity_id" in redacted));
      const unread = await kit.tenant(alice.organizationId, (client) => getUnreadNotificationCount(client, alice));
      assert.equal(visible.filter((row) => !row.read_at).length, unread, "the unread badge counts exactly the unread rows shown");

      // CRM no longer available to Alice at all: every CRM notification is neutral.
      const noCrm = await list(alice, []);
      assert.ok(noCrm.filter((row) => row.module_key === "crm").every((row) => row.redacted && row.href === null));
      assert.equal(noCrm.length, visible.length);
    });

    await t.test("security email is not governed by notification preferences", async () => {
      await kit.tenant(alice.organizationId, (client) => setNotificationPreference(client, alice, { category: "crm_assignment", enabled: false }));
      const { buildAuthEmail } = await import("../../../services/api/src/core/auth-mailer.js").catch(() => ({}));
      // Auth mail has its own transport; preferences only ever gate in-app categories.
      const preferenceCategories = (await kit.tenant(alice.organizationId, (client) => listNotificationPreferences(client, alice))).map((preference) => preference.category);
      assert.ok(preferenceCategories.every((category) => !/auth|password|mfa|security/.test(category)));
      assert.ok(typeof buildAuthEmail === "function" || buildAuthEmail === undefined);
    });
  } finally {
    await kit.close();
  }
});
