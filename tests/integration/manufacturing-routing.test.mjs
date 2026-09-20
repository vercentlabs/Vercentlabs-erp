// Real PostgreSQL integration test -- work centres, shift calendars, routings and capacity.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";
async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

const ROLES = {
  planner: ["manufacturing.view", "manufacturing.routing.manage", "manufacturing.settings.manage", "manufacturing.costing.view"],
  clerk: ["manufacturing.view", "manufacturing.routing.manage"],
  viewer: ["manufacturing.view"],
};

test("Manufacturing routing and capacity against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, saveCalendar, addShift, removeShift, addCalendarException, removeCalendarException, listCalendars, listShifts, listCalendarExceptions, saveWorkCenter, listWorkCenters, createRouting, updateDraftRouting, activateRouting, reviseRouting, obsoleteRouting, listRoutings, getRouting, getCapacityPlan } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), item: randomUUID() };
  const ctx = Object.fromEntries(Object.entries(ROLES).map(([r, permissions]) => [r, manufacturingContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));

  async function tx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  const forbidden = (e) => e.status === 403;
  const run = (who, fn) => tx((c) => fn(c, ctx[who]));

  // the next Monday (UTC) so the arithmetic below does not depend on the day the test runs
  const monday = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
  })();
  const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `rt-${role}-${id}@test.invalid`, `Rt ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Rt Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `rt-org-${orgId}`, users.planner]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Rt Co','Rt Co Pvt Ltd','RTCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,'RP','Item RP','product',$4,'active',true)`, [ids.item, orgId, companyId, ids.uom]);

    let calendar;
    await t.test("F154: a calendar has shifts (no overlap, sane times) and closures; only a settings manager edits it", async () => {
      await assert.rejects(() => run("clerk", (c, x) => saveCalendar(c, x, { code: "std", name: "Standard" })), forbidden);
      await assert.rejects(() => run("planner", (c, x) => saveCalendar(c, x, { code: "std", name: "Standard", workingWeekdays: [1, 9] })), (e) => e.code === "MFG_WEEKDAYS_INVALID");
      calendar = await run("planner", (c, x) => saveCalendar(c, x, { code: "std", name: "Standard", workingWeekdays: [1, 2, 3, 4, 5] }));
      assert.equal(calendar.code, "STD");
      await assert.rejects(() => run("planner", (c, x) => addShift(c, x, { calendarId: calendar.id, name: "Bad", startTime: "10:00", endTime: "09:00" })), (e) => e.code === "MFG_TIME_INVALID");
      await assert.rejects(() => run("planner", (c, x) => addShift(c, x, { calendarId: calendar.id, name: "Bad", startTime: "08:00", endTime: "09:00", breakMinutes: 90 })), (e) => e.code === "MFG_TIME_INVALID");
      await run("planner", (c, x) => addShift(c, x, { calendarId: calendar.id, name: "Day", startTime: "08:00", endTime: "16:00", breakMinutes: 60 }));
      await assert.rejects(() => run("planner", (c, x) => addShift(c, x, { calendarId: calendar.id, name: "Overlap", startTime: "15:00", endTime: "20:00" })), (e) => e.code === "MFG_SHIFT_OVERLAP");
      const second = await run("planner", (c, x) => addShift(c, x, { calendarId: calendar.id, name: "Evening", startTime: "16:00", endTime: "20:00" }));
      assert.equal((await run("viewer", (c, x) => listCalendars(c, x)))[0].daily_minutes, 7 * 60 + 4 * 60);
      await run("planner", (c, x) => removeShift(c, x, second.id));
      assert.equal((await run("viewer", (c, x) => listShifts(c, x))).length, 1);
      const closure = await run("planner", (c, x) => addCalendarException(c, x, { calendarId: calendar.id, exceptionDate: addDays(monday, 1), name: "Founders day" }));
      await assert.rejects(() => run("planner", (c, x) => addCalendarException(c, x, { calendarId: calendar.id, exceptionDate: "", name: "x" })), (e) => e.code === "MFG_DATE_INVALID");
      assert.equal((await run("viewer", (c, x) => listCalendarExceptions(c, x))).length, 1);
      await run("planner", (c, x) => removeCalendarException(c, x, closure.id));
      await run("planner", (c, x) => addCalendarException(c, x, { calendarId: calendar.id, exceptionDate: addDays(monday, 1), name: "Founders day" }));
    });

    let press;
    let paint;
    await t.test("F152/F153: work centres validate, cost rates need costing.view, capacity = shift x machines x efficiency", async () => {
      await assert.rejects(() => run("viewer", (c, x) => saveWorkCenter(c, x, { code: "PR", name: "Press" })), forbidden);
      await assert.rejects(() => run("clerk", (c, x) => saveWorkCenter(c, x, { code: "PR", name: "Press", machineCount: 0 })), (e) => e.code === "MFG_MACHINES_INVALID");
      await assert.rejects(() => run("clerk", (c, x) => saveWorkCenter(c, x, { code: "PR", name: "Press", efficiencyPercent: 0 })), (e) => e.code === "MFG_EFFICIENCY_INVALID");
      await assert.rejects(() => run("clerk", (c, x) => saveWorkCenter(c, x, { code: "PR", name: "Press", centerType: "robot" })), (e) => e.code === "MFG_TYPE_INVALID");
      await assert.rejects(() => run("clerk", (c, x) => saveWorkCenter(c, x, { code: "PR", name: "Press", calendarId: randomUUID() })), (e) => e.code === "MFG_CALENDAR_NOT_FOUND");
      press = await run("clerk", (c, x) => saveWorkCenter(c, x, { code: "pr", name: "Press", calendarId: calendar.id, machineCount: 2, efficiencyPercent: 50, hourlyRate: 120, overheadRate: 30 }));
      paint = await run("clerk", (c, x) => saveWorkCenter(c, x, { code: "PT", name: "Paint", calendarId: calendar.id }));
      await assert.rejects(() => run("clerk", (c, x) => saveWorkCenter(c, x, { code: "PR", name: "Dup" })), (e) => e.code === "MFG_WORK_CENTER_DUPLICATE");
      const asPlanner = (await run("planner", (c, x) => listWorkCenters(c, x))).find((w) => w.code === "PR");
      assert.equal(asPlanner.daily_minutes, 420 * 2 * 0.5, "420 shift minutes x 2 machines x 50%");
      assert.equal(Number(asPlanner.hourly_rate), 120);
      const asViewer = (await run("viewer", (c, x) => listWorkCenters(c, x))).find((w) => w.code === "PR");
      assert.equal(asViewer.hourly_rate, null, "rates hidden without costing.view");
      const renamed = await run("clerk", (c, x) => saveWorkCenter(c, x, { id: press.id, name: "Big Press" }));
      assert.equal(renamed.code, "PR", "the code never changes");
      assert.equal(renamed.name, "Big Press");
      assert.equal(renamed.machine_count, 2, "unspecified fields are kept");
    });

    let routing;
    await t.test("F150/F151: a routing needs operations with work centres; sequences are unique; activation makes it the product's default", async () => {
      const op = (extra) => ({ name: "Op", workCenterId: press.id, setupMinutes: 10, runMinutesPerUnit: 2, ...extra });
      await assert.rejects(() => run("viewer", (c, x) => createRouting(c, x, { code: "R1", name: "R", operations: [op({})] })), forbidden);
      await assert.rejects(() => run("clerk", (c, x) => createRouting(c, x, { code: "R1", name: "R", operations: [] })), (e) => e.code === "MFG_OPERATIONS_REQUIRED");
      await assert.rejects(() => run("clerk", (c, x) => createRouting(c, x, { code: "R1", name: "R", operations: [op({ sequence: 10 }), op({ sequence: 10 })] })), (e) => e.code === "MFG_SEQUENCE_DUPLICATE");
      await assert.rejects(() => run("clerk", (c, x) => createRouting(c, x, { code: "R1", name: "R", operations: [op({ workCenterId: null })] })), (e) => e.code === "MFG_WORK_CENTER_REQUIRED");
      await assert.rejects(() => run("clerk", (c, x) => createRouting(c, x, { code: "R1", name: "R", operations: [op({ setupMinutes: -1 })] })), (e) => e.code === "MFG_QUANTITY_INVALID");
      routing = await run("clerk", (c, x) => createRouting(c, x, { code: "r1", name: "Rim routing", itemId: ids.item, operations: [op({ name: "Press", sequence: 10 }), op({ name: "Paint", sequence: 20, workCenterId: paint.id, runMinutesPerUnit: 1 }), { name: "Outside plating", sequence: 30, subcontracted: true }] }));
      assert.equal(routing.status, "draft");
      const detail = await run("viewer", (c, x) => getRouting(c, x, routing.id));
      assert.deepEqual(detail.operations.map((o) => o.sequence), [10, 20, 30]);
      await run("clerk", (c, x) => updateDraftRouting(c, x, routing.id, { operations: [op({ name: "Press", sequence: 10 }), op({ name: "Paint", sequence: 20, workCenterId: paint.id, runMinutesPerUnit: 1 })] }));
      const active = await run("clerk", (c, x) => activateRouting(c, x, routing.id));
      assert.equal(active.status, "active");
      assert.equal(active.is_default, true);
      await assert.rejects(() => run("clerk", (c, x) => updateDraftRouting(c, x, routing.id, { name: "x" })), (e) => e.code === "MFG_ROUTING_STATE_INVALID");
    });

    await t.test("F150: revising an active routing makes a draft copy; activating it retires the old default", async () => {
      const draft = await run("clerk", (c, x) => reviseRouting(c, x, routing.id));
      assert.equal(draft.version, 2);
      assert.equal((await run("viewer", (c, x) => getRouting(c, x, draft.id))).operations.length, 2);
      await assert.rejects(() => run("clerk", (c, x) => reviseRouting(c, x, routing.id)), (e) => e.code === "MFG_REVISION_IN_PROGRESS");
      await run("clerk", (c, x) => activateRouting(c, x, draft.id));
      const list = await run("viewer", (c, x) => listRoutings(c, x));
      assert.equal(list.find((r) => r.version === 1).status, "inactive");
      assert.equal(list.find((r) => r.version === 2).is_default, true);
      assert.equal(Number(list.find((r) => r.version === 2).run_minutes_per_unit), 3);
      routing = draft;
    });

    await t.test("F153: capacity counts working days only (closure and weekend give none) and flags overload", async () => {
      const bomId = randomUUID();
      await admin.query(`INSERT INTO tenant.manufacturing_boms(id,organization_id,company_id,item_id,code,version,status,created_by) VALUES ($1,$2,$3,$4,'RB',1,'active',$5)`, [bomId, orgId, companyId, ids.item, users.planner]);
      const wh = randomUUID();
      await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'RW','RW','active')`, [wh, orgId, companyId]);
      const wo = randomUUID();
      await admin.query(`INSERT INTO tenant.manufacturing_work_orders(id,organization_id,company_id,work_order_number,item_id,bom_id,quantity_planned,status,planned_start_at,wip_warehouse_id,finished_goods_warehouse_id,created_by) VALUES ($1,$2,$3,'WO-RT',$4,$5,10,'planned',$6,$7,$7,$8)`, [wo, orgId, companyId, ids.item, bomId, `${monday}T09:00:00Z`, wh, users.planner]);
      await admin.query(`INSERT INTO tenant.manufacturing_work_order_operations(organization_id,work_order_id,sequence,name,work_center_id,status,planned_minutes) VALUES ($1,$2,10,'Press',$3,'pending',500)`, [orgId, wo, press.id]);
      const plan = await run("viewer", (c, x) => getCapacityPlan(c, x, { from: monday, days: 7 }));
      const center = plan.centers.find((k) => k.code === "PR");
      assert.equal(center.days.length, 7);
      assert.equal(center.days[0].available, 420, "Monday: 420 x 2 x 50%");
      assert.equal(center.days[0].load, 500);
      assert.equal(center.days[0].utilization, 119);
      assert.equal(center.days[1].available, 0, "Tuesday is a closure");
      assert.equal(center.days[5].available, 0, "Saturday is not a working day");
      assert.equal(center.overloadedDays, 1);
      assert.equal(center.loadTotal, 500);
      // a work centre in maintenance gives no capacity
      await run("clerk", (c, x) => saveWorkCenter(c, x, { id: paint.id, status: "maintenance" }));
      const after = await run("viewer", (c, x) => getCapacityPlan(c, x, { from: monday, days: 3 }));
      assert.equal(after.centers.find((k) => k.code === "PT").days[0].available, 0);
      // a centre with an open operation cannot be deactivated
      await assert.rejects(() => run("clerk", (c, x) => saveWorkCenter(c, x, { id: press.id, status: "inactive" })), (e) => e.code === "MFG_WORK_CENTER_IN_USE");
      await assert.rejects(() => run("planner", (c, x) => obsoleteRouting(c, x, routing.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
      await admin.query(`DELETE FROM tenant.manufacturing_work_order_operations WHERE organization_id=$1`, [orgId]);
      await admin.query(`DELETE FROM tenant.manufacturing_work_orders WHERE organization_id=$1`, [orgId]);
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_work_order_operations", "manufacturing_work_orders", "manufacturing_routing_operations", "manufacturing_routings", "manufacturing_work_centers", "manufacturing_shifts", "manufacturing_calendar_exceptions", "manufacturing_calendars", "manufacturing_boms", "manufacturing_events", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});
