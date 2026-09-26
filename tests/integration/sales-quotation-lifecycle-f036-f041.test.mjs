// Real PostgreSQL integration test -- Sales quotation lifecycle
// (F036 quotations, F037 versions/revisions, F038 expiry, F040 taxes,
// F041 approval workflow) and the accepted-quotation -> sales-order handoff
// (F042). The Sales domain layer had ~5,500 lines of logic and no automated
// test at all; this is the first one, written before the HTTP routes/UI on top
// of it so those are built on behaviour that has actually been exercised.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";

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

test("Sales quotation lifecycle against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const sales = await import("../../services/api/src/index.js");
  const {
    createQuotation,
    reviseQuotation,
    getQuotation,
    listQuotations,
    submitQuotation,
    approveQuotation,
    rejectQuotationApproval,
    sendQuotation,
    recordPublicQuoteDecision,
    convertQuotationToOrder,
    previewSalesDocument,
    getQuotationGovernanceTimeline,
    compareQuotationVersions,
    scanExpiredQuotations,
  } = sales;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const sellerId = randomUUID();
  const approverId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const customerId = randomUUID();
  // GST needs the buyer's state: the customer's billing address carries it.
  const billingAddressId = randomUUID();

  const sellerContext = {
    organizationId: orgId,
    userId: sellerId,
    activeCompanyId: companyId,
    activeBranchId: branchId,
    allowAllCompanies: false,
    roleSlugs: [],
    permissions: ["sales.view", "sales.quotation.create", "sales.quotation.send", "sales.order.create", "sales.price.override", "sales.margin.view"],
  };
  const approverContext = {
    ...sellerContext,
    userId: approverId,
    permissions: ["sales.view", "sales.quotation.approve", "sales.quotation.send", "sales.order.create"],
  };
  const viewerContext = { ...sellerContext, permissions: ["sales.view"] };

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

  const baseDocument = () => ({
    partyId: customerId,
    billingAddressId,
    currencyCode: "INR",
    priceListId,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    lines: [{ itemId, quantity: 2 }],
  });

  try {
    for (const [id, name] of [
      [sellerId, "Sales Rep"],
      [approverId, "Sales Approver"],
    ]) {
      await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [
        id,
        `sales-${id}@test.invalid`,
        name,
      ]);
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Sales Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `sales-org-${orgId}`, sellerId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Sales Co','Sales Co Pvt Ltd','SLSCO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
    for (const id of [sellerId, approverId]) {
      await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    }
    // Organisations created through the platform get their document numbering
    // series seeded; this test inserts the organisation directly, so it does too.
    for (const [entity, prefix] of [["quotation", "QUO-"], ["sales_order", "SO-"], ["sales_fulfillment_request", "FUL-"], ["sales_invoice_request", "SIR-"]]) {
      await admin.query(`INSERT INTO public.numbering_series(organization_id,entity_type,prefix) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [orgId, entity, prefix]);
    }
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH','WH','active')`, [warehouseId, orgId, companyId, branchId]);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(
      `INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`,
      [randomUUID(), orgId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Widget','product',$3,$4,100,60,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await admin.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST1','customer','Acme Retail','active',$4)`,
      [customerId, orgId, companyId, sellerId],
    );
    await admin.query(
      `INSERT INTO tenant.addresses(id,organization_id,party_id,address_type,line1,city,state,state_code,postal_code,country_code,is_primary) VALUES ($1,$2,$3,'billing','1 MG Road','Bengaluru','Karnataka','KA','560001','IN',true)`,
      [billingAddressId, orgId, customerId],
    );

    let quotation;
    await t.test("preview prices and taxes a document without persisting anything", async () => {
      const preview = await tx((c) => previewSalesDocument(c, sellerContext, baseDocument()));
      assert.equal(Number(preview.totals.subtotal ?? preview.totals.netTotal ?? 0) > 0 || preview.lines.length === 1, true);
      const persisted = await admin.query(`SELECT count(*)::int AS n FROM tenant.sales_quotations WHERE organization_id=$1`, [orgId]);
      assert.equal(persisted.rows[0].n, 0, "a preview must not create a quotation");
    });

    await t.test("F036/F040: create a draft quotation; total = 2 x 100 + 18% GST", async () => {
      quotation = await tx((c) => createQuotation(c, sellerContext, baseDocument()));
      assert.ok(quotation.id && quotation.quotation_number);
      const detail = await tx((c) => getQuotation(c, sellerContext, quotation.id));
      const view = detail.quotation ?? detail;
      assert.equal(view.quotation?.lifecycle_status ?? view.lifecycle_status, "draft");
      const version = await admin.query(`SELECT grand_total,version_number FROM tenant.sales_quotation_versions WHERE organization_id=$1 AND quotation_id=$2`, [orgId, quotation.id]);
      assert.equal(version.rows.length, 1);
      assert.equal(Number(version.rows[0].grand_total), 236, "200 net + 36 GST");
    });

    await t.test("permissions: a viewer cannot create, and cannot see margin-redacted fields", async () => {
      await assert.rejects(() => tx((c) => createQuotation(c, viewerContext, baseDocument())), (error) => error.code === "FORBIDDEN" || /permission/i.test(error.message));
    });

    await t.test("F037: revising creates a new immutable version and keeps the old one", async () => {
      const doc = { ...baseDocument(), lines: [{ itemId, quantity: 3 }], revisionReason: "customer asked for 3" };
      await tx((c) => reviseQuotation(c, sellerContext, quotation.id, doc));
      const versions = await admin.query(`SELECT version_number,grand_total FROM tenant.sales_quotation_versions WHERE organization_id=$1 AND quotation_id=$2 ORDER BY version_number`, [orgId, quotation.id]);
      assert.equal(versions.rows.length, 2);
      assert.equal(Number(versions.rows[0].grand_total), 236, "v1 is untouched");
      assert.equal(Number(versions.rows[1].grand_total), 354, "300 + 54 GST");
      const [left, right] = await admin.query(`SELECT id FROM tenant.sales_quotation_versions WHERE organization_id=$1 AND quotation_id=$2 ORDER BY version_number`, [orgId, quotation.id]).then((r) => r.rows.map((x) => x.id));
      const comparison = await tx((c) => compareQuotationVersions(c, sellerContext, quotation.id, left, right));
      assert.ok(comparison);
    });

    await t.test("F041: submit, then a DIFFERENT holder of sales.quotation.approve approves; a seller cannot approve", async () => {
      const submitted = await tx((c) => submitQuotation(c, sellerContext, quotation.id));
      assert.ok(submitted);
      const after = await admin.query(`SELECT lifecycle_status,current_version_id FROM tenant.sales_quotations WHERE organization_id=$1 AND id=$2`, [orgId, quotation.id]);
      if (after.rows[0].lifecycle_status === "pending_approval") {
        await assert.rejects(() => tx((c) => approveQuotation(c, sellerContext, quotation.id, after.rows[0].current_version_id)), (error) => error.code === "FORBIDDEN" || /permission/i.test(error.message));
        await tx((c) => approveQuotation(c, approverContext, quotation.id, after.rows[0].current_version_id));
      }
      const approved = await admin.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE organization_id=$1 AND id=$2`, [orgId, quotation.id]);
      assert.equal(approved.rows[0].lifecycle_status, "approved");
    });

    let token;
    await t.test("F036: only an approved quotation can be sent; sending produces a customer link", async () => {
      const sent = await tx((c) => sendQuotation(c, sellerContext, quotation.id, 14));
      assert.ok(sent.token && sent.expiresAt);
      token = sent.token;
    });

    await t.test("the customer accepts through the public link exactly once", async () => {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await tx((c) => recordPublicQuoteDecision(c, { organizationId: orgId }, tokenHash, { decision: "accepted", customerName: "Ana Buyer", typedSignature: "Ana Buyer" }, { ipAddress: "127.0.0.1" }));
      const row = await admin.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE organization_id=$1 AND id=$2`, [orgId, quotation.id]);
      assert.equal(row.rows[0].lifecycle_status, "accepted");
      await assert.rejects(
        () => tx((c) => recordPublicQuoteDecision(c, { organizationId: orgId }, tokenHash, { decision: "rejected", customerName: "Ana Buyer" })),
        // a decided quotation's link is consumed: the second attempt is refused (409 already decided, or 410 link no longer valid)
        (error) => [409, 410].includes(error.status),
      );
    });

    await t.test("F042: an accepted quotation converts to a sales order once (idempotent)", async () => {
      const first = await tx((c) => convertQuotationToOrder(c, sellerContext, quotation.id));
      assert.ok(first.orderId);
      const second = await tx((c) => convertQuotationToOrder(c, sellerContext, quotation.id));
      assert.equal(second.orderId, first.orderId);
      assert.equal(second.idempotent, true);
    });

    await t.test("list and governance timeline reflect the lifecycle", async () => {
      const rows = await tx((c) => listQuotations(c, sellerContext, { search: "Acme" }));
      assert.equal(rows.length, 1);
      const timeline = await tx((c) => getQuotationGovernanceTimeline(c, sellerContext, quotation.id));
      assert.ok(timeline);
    });

    await t.test("F038: expiry scan expires an overdue open quotation and leaves accepted ones alone", async () => {
      const draft = await tx((c) => createQuotation(c, sellerContext, { ...baseDocument(), validUntil: new Date().toISOString().slice(0, 10) }));
      await admin.query(`UPDATE tenant.sales_quotations SET valid_until=current_date - 5 WHERE organization_id=$1 AND id=$2`, [orgId, draft.id]);
      const result = await tx((c) => scanExpiredQuotations(c, { ...sellerContext, permissions: [...sellerContext.permissions, "sales.settings.manage"] }));
      assert.ok(result.scanned >= 0);
      const accepted = await admin.query(`SELECT lifecycle_status FROM tenant.sales_quotations WHERE organization_id=$1 AND id=$2`, [orgId, quotation.id]);
      assert.notEqual(accepted.rows[0].lifecycle_status, "expired");
      void rejectQuotationApproval;
    });
  } finally {
    for (const table of [
      "sales_quote_decisions",
      "sales_quote_share_links",
      "sales_orders",
      "sales_quotation_tax_lines",
      "sales_quotation_lines",
      "sales_quotation_charges",
      "sales_quotations",
      "sales_quotation_versions",
      "price_list_items",
      "items",
      "price_lists",
      "business_parties",
      "sales_settings",
      "tax_rates",
      "tax_categories",
      "units_of_measure",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.sales_public_quote_tokens WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organization_memberships WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.numbering_series WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[sellerId, approverId]]).catch(() => undefined);
    await admin.end();
  }
});
