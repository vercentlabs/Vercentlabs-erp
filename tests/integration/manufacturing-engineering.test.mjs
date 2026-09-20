// Real PostgreSQL integration test -- BOM lifecycle, versions/revisions, alternates, multi-level
// explosion, where-used and engineering change control, with role permission sets (no owner bypass).
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
  engineer: ["manufacturing.view", "manufacturing.bom.view", "manufacturing.bom.manage"],
  approver: ["manufacturing.view", "manufacturing.bom.view", "manufacturing.bom.manage", "manufacturing.manage"],
  viewer: ["manufacturing.view"],
};

test("Manufacturing engineering against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { manufacturingContext, createBom, updateDraftBom, submitBom, approveBom, rejectBom, obsoleteBom, reviseBom, addComponentAlternate, removeComponentAlternate, listBoms, getBom, explodeBom, resolveBomForItem, whereUsed, createEngineeringChange, submitEngineeringChange, decideEngineeringChange, implementEngineeringChange, cancelEngineeringChange, listEngineeringChanges } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), bike: randomUUID(), wheel: randomUUID(), frame: randomUUID(), spoke: randomUUID(), rim: randomUUID(), tube: randomUUID(), alt: randomUUID(), inactive: randomUUID() };
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

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `eng-${role}-${id}@test.invalid`, `Eng ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Eng Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `eng-org-${orgId}`, users.engineer]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Eng Co','Eng Co Pvt Ltd','ENGCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    const item = (id, code, status = "active") => admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,$4,$5,'product',$6,$7,true)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom, status]);
    for (const [key, code] of [["bike", "BIKE"], ["wheel", "WHEEL"], ["frame", "FRAME"], ["spoke", "SPOKE"], ["rim", "RIM"], ["tube", "TUBE"], ["alt", "TUBE2"]]) await item(ids[key], code);
    await item(ids.inactive, "OLD", "inactive");

    let wheelBom;
    await t.test("F145: a BOM is created as a draft with numbered components; validation and permissions hold", async () => {
      const line = (itemId, quantity, extra = {}) => ({ itemId, quantity, ...extra });
      await assert.rejects(() => run("viewer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [line(ids.spoke, 36)] })), forbidden);
      await assert.rejects(() => run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [] })), (e) => e.code === "MFG_COMPONENTS_REQUIRED");
      await assert.rejects(() => run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [line(ids.wheel, 1)] })), (e) => e.code === "MFG_BOM_SELF_REFERENCE");
      await assert.rejects(() => run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [line(ids.spoke, 0)] })), (e) => e.code === "MFG_QUANTITY_INVALID");
      await assert.rejects(() => run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [line(ids.spoke, 1, { scrapPercent: 100 })] })), (e) => e.code === "MFG_SCRAP_INVALID");
      await assert.rejects(() => run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [line(ids.inactive, 1)] })), (e) => e.code === "MFG_ITEM_INACTIVE");
      await assert.rejects(() => run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "W1", components: [line(ids.spoke, 1), line(ids.spoke, 2)] })), (e) => e.code === "MFG_COMPONENT_DUPLICATE");
      wheelBom = await run("engineer", (c, x) => createBom(c, x, { itemId: ids.wheel, code: "w1", outputQuantity: 1, components: [line(ids.spoke, 36, { scrapPercent: 5 }), line(ids.rim, 1), line(ids.tube, 1)] }));
      assert.equal(wheelBom.status, "draft");
      assert.equal(wheelBom.code, "W1");
      assert.equal(wheelBom.version, 1);
      const detail = await run("viewer", (c, x) => getBom(c, x, wheelBom.id));
      assert.deepEqual(detail.components.map((l) => l.line_number), [1, 2, 3]);
    });

    await t.test("F145/F147: approval needs a different person; an active BOM cannot be edited", async () => {
      await assert.rejects(() => run("engineer", (c, x) => approveBom(c, x, wheelBom.id)), (e) => e.code === "MFG_BOM_STATE_INVALID", "not submitted yet");
      await run("engineer", (c, x) => submitBom(c, x, wheelBom.id));
      await assert.rejects(() => run("engineer", (c, x) => approveBom(c, x, wheelBom.id)), (e) => e.code === "MFG_BOM_SELF_APPROVAL");
      await assert.rejects(() => run("approver", (c, x) => rejectBom(c, x, wheelBom.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
      const back = await run("approver", (c, x) => rejectBom(c, x, wheelBom.id, "Add the tube"));
      assert.equal(back.status, "draft");
      assert.equal(back.rejection_reason, "Add the tube");
      await run("engineer", (c, x) => updateDraftBom(c, x, wheelBom.id, { revision: "A2" }));
      await run("engineer", (c, x) => submitBom(c, x, wheelBom.id));
      const active = await run("approver", (c, x) => approveBom(c, x, wheelBom.id));
      assert.equal(active.status, "active");
      assert.equal(active.is_default, true);
      await assert.rejects(() => run("engineer", (c, x) => updateDraftBom(c, x, wheelBom.id, { name: "x" })), (e) => e.code === "MFG_BOM_STATE_INVALID");
    });

    await t.test("F146: multi-level explosion (scrap allowance included), circular structures refused, where-used", async () => {
      const bikeBom = await run("engineer", (c, x) => createBom(c, x, { itemId: ids.bike, code: "B1", components: [{ itemId: ids.wheel, quantity: 2 }, { itemId: ids.frame, quantity: 1 }] }));
      await run("engineer", (c, x) => submitBom(c, x, bikeBom.id));
      await run("approver", (c, x) => approveBom(c, x, bikeBom.id));
      const plan = await run("viewer", (c, x) => explodeBom(c, x, { itemId: ids.bike, quantity: 10 }));
      assert.equal(plan.lines.filter((l) => l.level === 1).length, 2);
      const wheels = plan.lines.find((l) => l.itemCode === "WHEEL");
      assert.equal(Number(wheels.requiredQuantity), 20);
      assert.equal(wheels.isSubAssembly, true);
      const spokes = plan.purchasedTotals.find((l) => l.itemCode === "SPOKE");
      assert.ok(Math.abs(Number(spokes.requiredQuantity) - (36 * 20) / 0.95) < 0.001, "36 per wheel x 20 wheels, with 5% scrap allowance");
      assert.ok(plan.purchasedTotals.some((l) => l.itemCode === "FRAME"), "a component with no BOM is a bought leaf");
      assert.ok(!plan.purchasedTotals.some((l) => l.itemCode === "WHEEL"), "a sub-assembly is expanded, not bought");
      // a wheel that contains the bike would loop
      await assert.rejects(() => run("engineer", (c, x) => reviseBom(c, x, wheelBom.id).then((draft) => updateDraftBom(c, x, draft.id, { components: [{ itemId: ids.bike, quantity: 1 }] }))), (e) => e.code === "MFG_BOM_CYCLE");
      const used = await run("viewer", (c, x) => whereUsed(c, x, { itemId: ids.spoke }));
      assert.deepEqual(used.map((u) => [u.level, u.itemCode]), [[1, "WHEEL"], [2, "BIKE"]]);
    });

    await t.test("F147/F148: a revision is a new draft version copied from the source; only one revision at a time", async () => {
      const draft = await run("engineer", (c, x) => reviseBom(c, x, wheelBom.id, { revisionNote: "Heavier spokes" }));
      assert.equal(draft.version, 2);
      assert.equal(draft.status, "draft");
      assert.equal(draft.supersedes_bom_id, wheelBom.id);
      const detail = await run("engineer", (c, x) => getBom(c, x, draft.id));
      assert.equal(detail.components.length, 3, "copied from the source");
      await assert.rejects(() => run("engineer", (c, x) => reviseBom(c, x, wheelBom.id)), (e) => e.code === "MFG_REVISION_IN_PROGRESS");
      await run("engineer", (c, x) => updateDraftBom(c, x, draft.id, { components: [{ itemId: ids.spoke, quantity: 40 }, { itemId: ids.rim, quantity: 1 }, { itemId: ids.tube, quantity: 1 }] }));
      await run("engineer", (c, x) => submitBom(c, x, draft.id));
      await run("approver", (c, x) => approveBom(c, x, draft.id));
      const list = await run("viewer", (c, x) => listBoms(c, x, { itemId: ids.wheel }));
      assert.equal(list.find((b) => b.version === 2).status, "active");
      assert.equal(list.find((b) => b.version === 1).status, "inactive", "the superseded version is retired");
      const current = await run("viewer", (c, x) => resolveBomForItem(c, x, ids.wheel));
      assert.equal(current.version, 2);
      const versions = (await run("viewer", (c, x) => getBom(c, x, draft.id))).versions;
      assert.deepEqual(versions.map((v) => v.version), [2, 1]);
    });

    await t.test("F147: effectivity dates decide which version applies on a date", async () => {
      const future = await run("engineer", (c, x) => reviseBom(c, x, (list) => list, { effectiveFrom: "2099-01-01" }).catch((e) => e));
      assert.ok(future instanceof Error, "a bad id is refused");
      const active = (await run("viewer", (c, x) => listBoms(c, x, { itemId: ids.wheel, status: "active" })))[0];
      const draft = await run("engineer", (c, x) => reviseBom(c, x, active.id, { effectiveFrom: "2099-01-01" }));
      await run("engineer", (c, x) => submitBom(c, x, draft.id));
      await run("approver", (c, x) => approveBom(c, x, draft.id));
      // v3 is active but not yet effective; v2 was retired by approval, so today nothing applies until 2099
      assert.equal(await run("viewer", (c, x) => resolveBomForItem(c, x, ids.wheel, "2099-06-01")).then((b) => b.version), 3);
      assert.equal(await run("viewer", (c, x) => resolveBomForItem(c, x, ids.wheel, "2026-01-01")), null);
    });

    await t.test("F149: an alternate component is added on a draft only; an alternate BOM coexists with the default", async () => {
      const active = (await run("viewer", (c, x) => listBoms(c, x, { itemId: ids.bike, status: "active" })))[0];
      const draft = await run("engineer", (c, x) => reviseBom(c, x, active.id));
      const detail = await run("engineer", (c, x) => getBom(c, x, draft.id));
      const component = detail.components.find((l) => l.item_code === "WHEEL");
      await assert.rejects(() => run("engineer", (c, x) => addComponentAlternate(c, x, component.id, { itemId: ids.wheel })), (e) => e.code === "MFG_ALTERNATE_INVALID");
      const alt = await run("engineer", (c, x) => addComponentAlternate(c, x, component.id, { itemId: ids.alt, ratio: 1.5, priority: 1 }));
      await assert.rejects(() => run("engineer", (c, x) => addComponentAlternate(c, x, component.id, { itemId: ids.alt })), (e) => e.code === "MFG_ALTERNATE_DUPLICATE");
      assert.equal((await run("engineer", (c, x) => getBom(c, x, draft.id))).components.find((l) => l.item_code === "WHEEL").alternates.length, 1);
      await run("engineer", (c, x) => removeComponentAlternate(c, x, alt.id));
      await assert.rejects(() => run("engineer", (c, x) => addComponentAlternate(c, x, (activeComponent) => activeComponent, {})), (e) => e.status === 400);
      const alternateBom = await run("engineer", (c, x) => createBom(c, x, { itemId: ids.bike, code: "B1-ALT", isAlternate: true, alternatePriority: 1, components: [{ itemId: ids.wheel, quantity: 2 }, { itemId: ids.frame, quantity: 2 }] }));
      await run("engineer", (c, x) => submitBom(c, x, alternateBom.id));
      const live = await run("approver", (c, x) => approveBom(c, x, alternateBom.id));
      assert.equal(live.is_default, false);
      assert.equal((await run("viewer", (c, x) => resolveBomForItem(c, x, ids.bike))).code, "B1", "the default is unchanged by an alternate");
      assert.equal((await run("viewer", (c, x) => listBoms(c, x, { itemId: ids.bike, status: "active" }))).length, 2);
    });

    await t.test("F190: an engineering change is approved by someone else, then implemented into a new active version", async () => {
      const target = (await run("viewer", (c, x) => listBoms(c, x, { itemId: ids.bike, status: "active" }))).find((b) => b.is_default);
      const proposal = [{ itemId: ids.wheel, quantity: 2 }, { itemId: ids.frame, quantity: 1 }, { itemId: ids.tube, quantity: 1 }];
      await assert.rejects(() => run("engineer", (c, x) => createEngineeringChange(c, x, { targetBomId: target.id, title: "", reason: "r", components: proposal })), (e) => e.code === "MFG_TITLE_REQUIRED");
      await assert.rejects(() => run("engineer", (c, x) => createEngineeringChange(c, x, { targetBomId: target.id, title: "Add spare tube", reason: "", components: proposal })), (e) => e.code === "MFG_REASON_REQUIRED");
      const change = await run("engineer", (c, x) => createEngineeringChange(c, x, { targetBomId: target.id, title: "Add spare tube", reason: "Field failures", components: proposal }));
      assert.match(change.change_number, /^ECN-/);
      await assert.rejects(() => run("approver", (c, x) => decideEngineeringChange(c, x, change.id, { approve: true })), (e) => e.code === "MFG_CHANGE_STATE_INVALID");
      await run("engineer", (c, x) => submitEngineeringChange(c, x, change.id));
      await assert.rejects(() => run("engineer", (c, x) => decideEngineeringChange(c, x, change.id, { approve: true })), forbidden, "the engineer lacks manufacturing.manage");
      await assert.rejects(() => run("approver", (c, x) => decideEngineeringChange(c, x, change.id, { approve: false })), (e) => e.code === "MFG_REASON_REQUIRED");
      await assert.rejects(() => run("approver", (c, x) => implementEngineeringChange(c, x, change.id)), (e) => e.code === "MFG_CHANGE_STATE_INVALID", "not approved yet");
      await run("approver", (c, x) => decideEngineeringChange(c, x, change.id, { approve: true, note: "OK" }));
      const done = await run("engineer", (c, x) => implementEngineeringChange(c, x, change.id));
      assert.equal(done.bom.status, "active");
      assert.equal(done.bom.supersedes_bom_id, target.id);
      const detail = await run("viewer", (c, x) => getBom(c, x, done.bom.id));
      assert.equal(detail.components.length, 3);
      assert.equal((await run("viewer", (c, x) => getBom(c, x, target.id))).status, "inactive");
      assert.equal((await run("viewer", (c, x) => listEngineeringChanges(c, x, { status: "implemented" }))).length, 1);
      await assert.rejects(() => run("engineer", (c, x) => cancelEngineeringChange(c, x, change.id, "x")), (e) => e.code === "MFG_CHANGE_STATE_INVALID");
    });

    await t.test("obsoleting needs a reason and is refused while open work orders use the BOM", async () => {
      const inactive = (await run("viewer", (c, x) => listBoms(c, x, { itemId: ids.bike, status: "inactive" })))[0];
      await assert.rejects(() => run("engineer", (c, x) => obsoleteBom(c, x, inactive.id, "")), (e) => e.code === "MFG_REASON_REQUIRED");
      const woWh = randomUUID();
      await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'EW','EW','active')`, [woWh, orgId, companyId]);
      await admin.query(`INSERT INTO tenant.manufacturing_work_orders(organization_id,company_id,work_order_number,item_id,bom_id,quantity_planned,status,wip_warehouse_id,finished_goods_warehouse_id,created_by) VALUES ($1,$2,'WO-T1',$3,$4,1,'planned',$5,$5,$6)`, [orgId, companyId, ids.bike, inactive.id, woWh, users.engineer]);
      await assert.rejects(() => run("engineer", (c, x) => obsoleteBom(c, x, inactive.id, "Superseded")), (e) => e.code === "MFG_BOM_IN_USE");
      await admin.query(`UPDATE tenant.manufacturing_work_orders SET status='cancelled' WHERE organization_id=$1 AND work_order_number='WO-T1'`, [orgId]);
      assert.equal((await run("engineer", (c, x) => obsoleteBom(c, x, inactive.id, "Superseded"))).status, "obsolete");
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["manufacturing_engineering_changes", "manufacturing_bom_component_alternates", "manufacturing_work_orders", "manufacturing_bom_components", "manufacturing_boms", "manufacturing_events", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});
