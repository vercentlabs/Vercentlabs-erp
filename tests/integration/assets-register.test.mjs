// Real PostgreSQL integration test -- the asset register (F231-F238): categories and locations, identity
// and tag codes, scoped visibility, creation from a posted vendor bill, and capitalisation with its
// Accounting journal and maker-checker.
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTANT, MANAGER, buildAssetsWorld, connectAdmin } from "./assets-test-kit.mjs";

const ROLES = {
  mgr: MANAGER,
  acctA: [...ACCOUNTANT, "accounting.view", "accounting.payables.manage", "accounting.payables.approve"],
  acctB: [...ACCOUNTANT, "accounting.view", "accounting.payables.manage", "accounting.payables.approve"],
  custodian: ["assets.view"],
};

test("Asset register, identity and capitalisation against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAssetsWorld(admin, ROLES, "asrg");
  const { api, run, denied, sql, accounts } = w;
  const ids = {};

  try {
    await t.test("F232: a category needs real posting accounts and sane percentages", async () => {
      await denied("custodian", (c, x) => api.saveAssetCategory(c, x, w.categoryInput()), 403);
      const group = (await sql(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND code='1000'`, [w.orgId, w.companyId]))[0];
      const bad = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ assetAccountId: group.id }))).catch((e) => e);
      assert.equal(bad.status, 409, "a group account cannot back a category");
      const pct = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ residualValuePercent: 150 }))).catch((e) => e);
      assert.equal(pct.status, 400);
      const cat = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ code: "it", capitalizationThreshold: 500, residualValuePercent: 10, tagPrefix: "IT" })));
      assert.equal(cat.code, "IT");
      ids.cat = cat.id;
      const list = await run("custodian", (c, x) => api.listAssetDeskCategories(c, x));
      assert.ok(list.some((r) => r.id === cat.id));
    });

    await t.test("F234: locations form a tree and refuse a loop", async () => {
      const site = await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "hq", name: "Head office", locationType: "site" }));
      const room = await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "srv", name: "Server room", locationType: "room", parentId: site.id }));
      assert.equal(room.parent_id, site.id);
      const loop = await run("mgr", (c, x) => api.saveAssetLocation(c, x, { id: site.id, code: "hq", name: "Head office", parentId: room.id })).catch((e) => e);
      assert.equal(loop.status, 400, "a parent that is a descendant would create a loop");
      ids.site = site.id;
      ids.room = room.id;
    });

    await t.test("F231/F233: an asset gets an identity, a tag code, and duplicates are refused", async () => {
      const a = await run("mgr", (c, x) => api.registerAsset(c, x, { name: "Server rack", categoryId: ids.cat, acquisitionCost: 12000, serialNumber: "SN-1", locationId: ids.room, criticality: "high" }));
      assert.equal(a.status, "draft");
      assert.ok(a.asset_number && a.tag_code);
      assert.equal(a.residual_value, null, "a manager without a value permission is not shown cost or residual");
      assert.equal(Number((await sql(`SELECT residual_value FROM tenant.assets WHERE id=$1`, [a.id]))[0].residual_value), 1200, "the category's 10% residual applies");
      ids.a1 = a.id;
      ids.tag = a.tag_code;
      const dup = await run("mgr", (c, x) => api.registerAsset(c, x, { name: "Copy", categoryId: ids.cat, acquisitionCost: 100, serialNumber: "SN-1" })).catch((e) => e);
      assert.equal(dup.status, 409, "a serial number is unique");
      const scanned = await run("mgr", (c, x) => api.resolveAssetByTag(c, x, ids.tag));
      assert.equal(scanned.id, a.id);
      const notFound = await run("mgr", (c, x) => api.resolveAssetByTag(c, x, "NOPE")).catch((e) => e);
      assert.equal(notFound.status, 404);
      const payload = await run("mgr", (c, x) => api.getAssetTagPayload(c, x, a.id));
      assert.ok(payload.qr.includes(ids.tag) && !("acquisition_cost" in payload), "a label payload never carries value");
    });

    await t.test("F231: component hierarchy refuses a cycle; documents attach", async () => {
      const child = await run("mgr", (c, x) => api.registerAsset(c, x, { name: "PSU", categoryId: ids.cat, acquisitionCost: 800, parentAssetId: ids.a1 }));
      const cyc = await run("mgr", (c, x) => api.updateAssetRecord(c, x, ids.a1, { parentAssetId: child.id })).catch((e) => e);
      assert.equal(cyc.status, 400, "the parent cannot become its own descendant");
      const doc = await run("mgr", (c, x) => api.addAssetDocument(c, x, ids.a1, { documentType: "manual", title: "Rack manual", referenceUrl: "https://example.test/manual.pdf" }));
      assert.ok(doc.id);
      const profile = await run("mgr", (c, x) => api.getAssetProfile(c, x, ids.a1));
      assert.equal(profile.children.length, 1);
      assert.equal(profile.documents.length, 1);
    });

    await t.test("F237: capitalisation needs a different person, the threshold, and posts a balanced journal", async () => {
      // the registering user (mgr) holds no capitalize permission at all
      await denied("mgr", (c, x) => api.capitalizeAssetRecord(c, x, ids.a1, {}), 403);
      const tiny = await run("mgr", (c, x) => api.registerAsset(c, x, { name: "Stapler", categoryId: ids.cat, acquisitionCost: 50 }));
      const below = await run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, tiny.id, {})).catch((e) => e);
      assert.equal(below.status, 409, "below the category threshold it must be expensed");
      const cap = await run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, ids.a1, { capitalizationDate: w.today }));
      assert.equal(cap.status, "available");
      assert.equal(cap.accounting_status, "posted");
      assert.equal(Number(cap.net_book_value), 12000);
      const [j] = await sql(`SELECT sum(base_debit_amount) AS d, sum(base_credit_amount) AS cr FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [w.orgId, cap.capitalization_journal_id]);
      assert.equal(Number(j.d), 12000);
      assert.equal(Number(j.d), Number(j.cr));
      const [line] = await sql(`SELECT account_id FROM tenant.accounting_journal_lines WHERE journal_entry_id=$1 AND base_debit_amount>0`, [cap.capitalization_journal_id]);
      assert.equal(line.account_id, accounts.asset, "the debit lands on the category's asset account");
      const twice = await run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, ids.a1, {})).catch((e) => e);
      assert.equal(twice.status, 409, "a capitalized asset cannot be capitalized again");
      const schedule = await sql(`SELECT count(*)::int AS n,sum(depreciation_amount) AS total FROM tenant.asset_depreciation_schedules WHERE asset_id=$1`, [ids.a1]);
      assert.equal(schedule[0].n, 12);
      assert.equal(Number(schedule[0].total), 10800, "cost minus residual is depreciated over the life");
    });

    await t.test("F237: the same person who registered an asset cannot capitalize it (when configured)", async () => {
      await run("acctA", (c, x) => api.registerAsset(c, x, { name: "Self-made", categoryId: ids.cat, acquisitionCost: 900 })).catch((e) => e);
      // acctA holds no assets.create, so register through the owner path: give acctA create for this check
      const self = await w.tx(async (client) => {
        const r = await client.query(`INSERT INTO tenant.assets(organization_id,company_id,asset_number,name,category_id,acquisition_cost,residual_value,currency_code,useful_life_months,depreciation_method,status,created_by) VALUES($1,$2,'SELF-1','Self',$3,900,0,'INR',12,'straight_line','draft',$4) RETURNING id`, [w.orgId, w.companyId, ids.cat, w.users.acctA]);
        return r.rows[0].id;
      });
      const blocked = await run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, self, {})).catch((e) => e);
      assert.equal(blocked.code, "SELF_APPROVAL_BLOCKED");
      const ok = await run("acctB", (c, x) => api.capitalizeAssetRecord(c, x, self, {}));
      assert.equal(ok.status, "available");
    });

    await t.test("F237: financial fields lock at capitalisation; descriptive fields stay editable", async () => {
      const locked = await run("mgr", (c, x) => api.updateAssetRecord(c, x, ids.a1, { acquisitionCost: 1 })).catch((e) => e);
      assert.equal(locked.status, 409);
      const ok = await run("mgr", (c, x) => api.updateAssetRecord(c, x, ids.a1, { name: "Server rack A", conditionRating: "fair" }));
      assert.equal(ok.name, "Server rack A");
    });

    await t.test("F238: an asset is created from a posted vendor bill line once, and only after the bill is posted", async () => {
      const { bill } = await run("acctA", (c, x) => api.createVendorBill(c, x, { companyId: w.companyId, partyId: w.supplierId, lines: [{ description: "Forklift", unitPrice: 25000 }] }));
      const line = (await sql(`SELECT id FROM tenant.accounting_vendor_bill_lines WHERE vendor_bill_id=$1`, [bill.id]))[0];
      const early = await run("mgr", (c, x) => api.createAssetFromSource(c, x, { sourceType: "vendor_bill_line", sourceId: line.id, categoryId: ids.cat })).catch((e) => e);
      assert.equal(early.status, 409, "the bill is still a draft");
      const submitted = await run("acctA", (c, x) => api.submitVendorBill(c, x, bill.id));
      await run("acctB", (c, x) => api.approveVendorBill(c, x, bill.id, submitted.contentHash));
      await run("acctA", (c, x) => api.postVendorBill(c, x, bill.id));
      const first = await run("mgr", (c, x) => api.createAssetFromSource(c, x, { sourceType: "vendor_bill_line", sourceId: line.id, categoryId: ids.cat }));
      assert.equal(first.reused, false);
      assert.equal(first.asset.name, "Forklift");
      assert.equal(Number((await sql(`SELECT acquisition_cost FROM tenant.assets WHERE id=$1`, [first.asset.id]))[0].acquisition_cost), 25000);
      const again = await run("mgr", (c, x) => api.createAssetFromSource(c, x, { sourceType: "vendor_bill_line", sourceId: line.id, categoryId: ids.cat }));
      assert.equal(again.reused, true);
      assert.equal(again.asset.id, first.asset.id, "the same line never produces a second asset");
      const cap = await run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, first.asset.id, {}));
      const [debit] = await sql(`SELECT account_id FROM tenant.accounting_journal_lines WHERE journal_entry_id=$1 AND base_credit_amount>0`, [cap.capitalization_journal_id]);
      assert.notEqual(debit.account_id, accounts.clearing, "the credit reclassifies the bill's expense account, not the clearing account");
    });

    await t.test("value fields are hidden from a custodian, who sees only their own assets", async () => {
      await run("mgr", (c, x) => api.assignAssetToCustodian(c, x, ids.a1, { userId: w.users.custodian }));
      const own = await run("custodian", (c, x) => api.listAssetRegister(c, x, {}));
      assert.equal(own.length, 1, "only the assigned asset is visible");
      assert.equal(own[0].net_book_value, null);
      assert.equal(own[0].acquisition_cost, null);
      const all = await run("mgr", (c, x) => api.listAssetRegister(c, x, {}));
      assert.ok(all.length >= 4);
      const other = all.find((r) => r.id !== ids.a1);
      const hidden = await run("custodian", (c, x) => api.getAssetProfile(c, x, other.id)).catch((e) => e);
      assert.equal(hidden.status, 404, "an asset that is not theirs does not exist to a custodian");
      const financial = await run("acctA", (c, x) => api.listAssetRegister(c, x, { search: "Server" }));
      assert.equal(Number(financial[0].net_book_value), 12000);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
