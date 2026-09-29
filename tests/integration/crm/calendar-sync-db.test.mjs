// F014 inbound calendar sync worker against real PostgreSQL, with a
// deterministic provider stand-in (no real Google/Microsoft credentials are
// used or claimed): pagination cursors, duplicate provider events, deleted
// events, expired sync tokens, provider failure/timeout, and untrusted
// cursor URLs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getMeetingAvailability } from "../../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";
import { publicMeetingContext } from "../../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/public-meetings.js";
import { syncCalendarAccountsHandler } from "../../../services/worker/src/handlers/crm-calendar-sync.js";
import { createRuntimeKit } from "../shared-runtime/runtime-kit.mjs";

const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const googleEvent = (id, hour, extra = {}) => ({
  id,
  status: "confirmed",
  summary: `Event ${id}`,
  start: { dateTime: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z` },
  end: { dateTime: `${day}T${String(hour + 1).padStart(2, "0")}:00:00.000Z` },
  ...extra,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("F014 scheduled calendar sync", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice"]);
    const alice = org.ids.alice;
    const environment = { CRM_TEST_CALENDAR_TOKEN: JSON.stringify({ accessToken: "test-token" }) };
    const account = async (provider, cursor = null) => {
      const id = randomUUID();
      await kit.owner.query(
        `INSERT INTO tenant.crm_sync_accounts(id,organization_id,company_id,user_id,provider,display_name,credential_reference,status,sync_direction,calendar_cursor)
         VALUES($1,$2,$3,$4,$5,'Calendar','env:CRM_TEST_CALENDAR_TOKEN','connected','two_way',$6)`,
        [id, org.organizationId, org.companyId, alice, provider, cursor],
      );
      return id;
    };
    const makeDue = (id) => kit.owner.query(`UPDATE tenant.crm_sync_accounts SET last_synced_at=now()-interval '1 hour', sync_lock_until=NULL WHERE id=$1`, [id]);
    const disable = (id) => kit.owner.query(`UPDATE tenant.crm_sync_accounts SET status='disabled' WHERE id=$1`, [id]);
    const requests = [];
    const run = (fetchImpl) =>
      syncCalendarAccountsHandler(null, null, {}, {
        organizationId: org.organizationId,
        pool: kit.pool,
        withTenantClient: (_pool, organizationId, work) => kit.tenant(organizationId, work),
        environment,
        fetchImpl: async (url, init) => {
          requests.push({ url: String(url), init });
          return fetchImpl(new URL(String(url)), init);
        },
      });
    const events = () => kit.owner.query(`SELECT external_event_id,title,provider_status FROM tenant.crm_calendar_events WHERE organization_id=$1 ORDER BY external_event_id`, [org.organizationId]).then((r) => r.rows);
    const google = await account("gmail");

    await t.test("first page: events land, and a page token is stored as a page cursor (never replayed as a syncToken)", async () => {
      const result = await run(() => json({ items: [googleEvent("g1", 10), googleEvent("g2", 12)], nextPageToken: "P2" }));
      assert.equal(result.synced, 1);
      assert.equal(result.events, 2);
      assert.equal(requests.at(-1).init.headers.Authorization, "Bearer test-token");
      const row = await kit.owner.query(`SELECT calendar_cursor,status,sync_lock_until FROM tenant.crm_sync_accounts WHERE id=$1`, [google]);
      assert.match(row.rows[0].calendar_cursor, /^page:P2\|/);
      assert.equal(row.rows[0].status, "connected");
      assert.equal(row.rows[0].sync_lock_until, null, "the lease is released");
    });

    await t.test("an account synced recently is not claimed again (no provider call)", async () => {
      const before = requests.length;
      const result = await run(() => json({ items: [] }));
      assert.equal(result.accounts, 0);
      assert.equal(requests.length, before);
    });

    await t.test("next page uses pageToken; a duplicate event updates in place and a cancelled one closes the row", async () => {
      await makeDue(google);
      await run((url) => {
        assert.equal(url.searchParams.get("pageToken"), "P2");
        assert.equal(url.searchParams.get("syncToken"), null);
        return json({ items: [googleEvent("g1", 10, { summary: "Renamed" }), { id: "g2", status: "cancelled" }], nextSyncToken: "S1" });
      });
      const rows = await events();
      assert.deepEqual(rows.map((row) => [row.external_event_id, row.title, row.provider_status]), [
        ["g1", "Renamed", "confirmed"],
        ["g2", "Event g2", "cancelled"],
      ]);
      const cursor = await kit.owner.query(`SELECT calendar_cursor FROM tenant.crm_sync_accounts WHERE id=$1`, [google]);
      assert.equal(cursor.rows[0].calendar_cursor, "S1");
    });

    await t.test("synced busy time blocks the host's public slots; the cancelled event frees its slot", async () => {
      const linkId = randomUUID();
      await kit.owner.query(
        `INSERT INTO tenant.crm_meeting_links(id,organization_id,company_id,owner_user_id,name,slug,duration_minutes,timezone,availability,minimum_notice_minutes,maximum_days_ahead,status)
         VALUES($1,$2,$3,$4,'Sync check',$5,60,'UTC',$6::jsonb,0,30,'active')`,
        [linkId, org.organizationId, org.companyId, alice, `sync-${linkId.slice(0, 8)}`, JSON.stringify(Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => [d, [{ start: "09:00", end: "17:00" }]])))],
      );
      const slots = await kit.tenant(org.organizationId, (client) => getMeetingAvailability(client, publicMeetingContext({ organizationId: org.organizationId, hostUserId: alice }), linkId, day));
      const starts = slots.map((slot) => slot.startsAt);
      assert.ok(!starts.includes(`${day}T10:00:00.000Z`), "g1 (10:00-11:00) is busy");
      assert.ok(starts.includes(`${day}T12:00:00.000Z`), "g2 was cancelled in the provider, so 12:00 is free");
    });

    await t.test("an expired sync token (410) restarts from a full window instead of failing forever", async () => {
      await makeDue(google);
      let calls = 0;
      await run((url) => {
        calls += 1;
        if (url.searchParams.get("syncToken")) return json({ error: "gone" }, 410);
        assert.ok(url.searchParams.get("timeMin"), "the restart lists from now");
        return json({ items: [googleEvent("g3", 14)], nextSyncToken: "S2" });
      });
      assert.equal(calls, 2);
      const cursor = await kit.owner.query(`SELECT calendar_cursor,status FROM tenant.crm_sync_accounts WHERE id=$1`, [google]);
      assert.deepEqual(cursor.rows[0], { calendar_cursor: "S2", status: "connected" });
    });

    await t.test("a provider outage is recorded on the account (not rolled back), and the lease is released", async () => {
      await makeDue(google);
      const result = await run(() => json({ error: "boom" }, 503));
      assert.equal(result.failed, 1);
      const row = await kit.owner.query(`SELECT status,last_error,sync_lock_until FROM tenant.crm_sync_accounts WHERE id=$1`, [google]);
      assert.equal(row.rows[0].status, "error");
      assert.match(row.rows[0].last_error, /503/);
      assert.equal(row.rows[0].sync_lock_until, null);
      const jobs = await kit.owner.query(`SELECT status FROM tenant.crm_provider_sync_jobs WHERE sync_account_id=$1 ORDER BY created_at DESC LIMIT 1`, [google]);
      assert.equal(jobs.rows[0].status, "failed");
    });

    await t.test("a hung provider times out as a retryable failure", async () => {
      await makeDue(google);
      await run(() => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      });
      const job = await kit.owner.query(`SELECT metadata->>'code' AS code FROM tenant.crm_provider_sync_jobs WHERE sync_account_id=$1 ORDER BY created_at DESC LIMIT 1`, [google]);
      assert.equal(job.rows[0].code, "CRM_PROVIDER_TIMEOUT");
      await disable(google);
    });

    await t.test("a tampered cursor URL never receives the bearer token", async () => {
      const evil = await account("microsoft365", "https://attacker.example/steal");
      const before = requests.length;
      await run(() => json({ value: [] }));
      assert.equal(requests.length, before, "no request was made");
      const job = await kit.owner.query(`SELECT metadata->>'code' AS code FROM tenant.crm_provider_sync_jobs WHERE sync_account_id=$1`, [evil]);
      assert.equal(job.rows[0].code, "CRM_PROVIDER_URL_UNTRUSTED");
      await disable(evil);
    });

    await t.test("Microsoft @removed items cancel the matching event instead of being dropped", async () => {
      const microsoft = await account("microsoft365");
      await run(() =>
        json({
          value: [{ id: "m1", subject: "Kept", start: { dateTime: `${day}T15:00:00.000Z` }, end: { dateTime: `${day}T16:00:00.000Z` } }, { id: "m0", subject: "Doomed", start: { dateTime: `${day}T16:00:00.000Z` }, end: { dateTime: `${day}T16:30:00.000Z` } }],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=D1",
        }),
      );
      await makeDue(microsoft);
      await run((url) => {
        assert.equal(url.hostname, "graph.microsoft.com");
        return json({ value: [{ id: "m0", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=D2" });
      });
      const rows = (await events()).filter((row) => row.external_event_id.startsWith("m"));
      assert.deepEqual(rows.map((row) => [row.external_event_id, row.provider_status]), [
        ["m0", "cancelled"],
        ["m1", "confirmed"],
      ]);
    });
  } finally {
    await kit.close();
  }
});
