// Real PostgreSQL integration test — F303 Day-end / Z report.
//
// Scenario: a store with two terminals. Terminal T1 has two CLOSED shifts
// (A and B) on the same IST business date (2024-01-16), plus one shift left
// OPEN with its own completed sale (must be excluded). Terminal T2 has one
// more CLOSED shift (C) on the same IST date, used to prove the
// business-day scope aggregates per-terminal when a terminal is given and
// store-wide when it is not. Shift A's closed_at is a UTC timestamp that
// falls on the PREVIOUS calendar day in UTC but on 2024-01-16 in the
// store's Asia/Kolkata timezone — this is the deliberate proof that the
// business-date cutoff uses the store's configured timezone, not server
// UTC. Every source row (sales, a return, cash movements) is inserted with
// fixed, hand-picked amounts so this test can assert literal expected
// totals, not just "some number came back".
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import pg from "pg";
const { Client } = pg;

// node-postgres's default DATE (OID 1082) parser builds a JS Date from
// LOCAL year/month/day components, not UTC -- .toISOString() on that value
// then shifts by the machine's own timezone offset and can print the WRONG
// calendar day. Since this suite specifically asserts calendar dates
// (business_date), read DATE columns back as their raw 'YYYY-MM-DD' text
// instead of ever constructing a Date from them.
pg.types.setTypeParser(1082, (value) => value);

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

test("F303: day-end (Z) report generation, review/finalize, reproducibility, duplicate prevention and immutability against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    generatePosDayEndReport,
    reviewPosDayEndReport,
    finalizePosDayEndReport,
    recordPosDayEndVariance,
    getPosDayEndReport,
    listPosDayEndReports,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const cashierId = randomUUID();
  const supervisorId = randomUUID(); // generates + reviews
  const managerId = randomUUID(); // finalizes (a different authority)
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();
  const storeId = randomUUID();
  const terminal1Id = randomUUID();
  const terminal2Id = randomUUID();
  const shiftAId = randomUUID();
  const shiftBId = randomUUID();
  const shiftCId = randomUUID();
  const shiftOpenId = randomUUID();

  const supervisorContext = { organizationId: orgId, companyId, userId: supervisorId, roleSlugs: [], permissions: ["pos.view", "pos.report.generate", "pos.report.view"] };
  const managerContext = { organizationId: orgId, companyId, userId: managerId, roleSlugs: [], permissions: ["pos.view", "pos.report.finalize", "pos.report.view"] };
  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };

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

  async function insertSale(id, { shiftId, storeIdArg = storeId, terminalId, subtotal, discount, tax, grand, status = "completed" }) {
    await admin.query(
      `INSERT INTO tenant.pos_sales
        (id,organization_id,company_id,store_id,terminal_id,shift_id,receipt_number,currency_code,
         subtotal,discount_total,tax_total,rounding_adjustment,grand_total,paid_total,change_total,status,
         idempotency_key,created_by,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'INR',$8,$9,$10,0,$11,$11,0,$12,$7,$13,now())`,
      [id, orgId, companyId, storeIdArg, terminalId, shiftId, `RCPT-${id}`, subtotal, discount, tax, grand, status, cashierId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_sale_lines
        (id,organization_id,sale_id,line_number,item_id,description,quantity,unit_price,discount_amount,tax_amount,line_total,warehouse_id)
       VALUES ($1,$2,$3,1,$4,'Line',1,$5,$6,$7,$8,$9)`,
      [randomUUID(), orgId, id, itemId, subtotal, discount, tax, grand, warehouseId],
    );
    if (status === "completed" || status === "partially_returned" || status === "returned") {
      await admin.query(
        `INSERT INTO tenant.pos_payments (id,organization_id,company_id,sale_id,shift_id,payment_method,amount,status,created_by)
         VALUES ($1,$2,$3,$4,$5,'cash',$6,'captured',$7)`,
        [randomUUID(), orgId, companyId, id, shiftId, grand, cashierId],
      );
    }
  }

  async function insertCashMovement({ shiftId, movementType, amount }) {
    await admin.query(
      `INSERT INTO tenant.pos_cash_movements (id,organization_id,company_id,shift_id,movement_number,movement_type,amount,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), orgId, companyId, shiftId, `CASH-${randomUUID()}`, movementType, amount, cashierId],
    );
  }

  try {
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F303 Cashier','x','active',now())`, [
      cashierId,
      `f303-cashier-${cashierId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F303 Supervisor','x','active',now())`, [
      supervisorId,
      `f303-supervisor-${supervisorId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F303 Manager','x','active',now())`, [
      managerId,
      `f303-manager-${managerId}@test.invalid`,
    ]);
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F303 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f303-org-${orgId}`, cashierId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F303 Co','F303 Co Pvt Ltd','F303CO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(
      `INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`,
      [branchId, orgId, companyId],
    );
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main WH','active')`,
      [warehouseId, orgId, companyId, branchId],
    );
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F303 Widget','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgId, companyId, itemId, warehouseId],
    );
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    // Store timezone is deliberately Asia/Kolkata (UTC+5:30) -- see shiftA below.
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,timezone,created_by)
       VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR','Asia/Kolkata',$7)`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, cashierId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminal1Id,
      orgId,
      companyId,
      storeId,
      cashierId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [
      terminal2Id,
      orgId,
      companyId,
      storeId,
      cashierId,
    ]);

    // Shift A: closed_at is 2024-01-15 20:00:00 UTC == 2024-01-16 01:30 IST.
    // The UTC calendar date (Jan 15) differs from the IST calendar date
    // (Jan 16) -- proving the business_date below is computed from the
    // STORE's timezone, not server UTC.
    await admin.query(
      `INSERT INTO tenant.pos_shifts(id,organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opening_cash,expected_cash,counted_cash,cash_variance,opened_at,opened_by,closed_at,closed_by)
       VALUES ($1,$2,$3,$4,$5,'SHIFT-A',$6,'closed',500,1553,1550,-3,'2024-01-15 10:00:00+00',$6,'2024-01-15 20:00:00+00',$6)`,
      [shiftAId, orgId, companyId, storeId, terminal1Id, cashierId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_shifts(id,organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opening_cash,expected_cash,counted_cash,cash_variance,opened_at,opened_by,closed_at,closed_by)
       VALUES ($1,$2,$3,$4,$5,'SHIFT-B',$6,'closed',300,890,890,0,'2024-01-16 08:00:00+00',$6,'2024-01-16 10:00:00+00',$6)`,
      [shiftBId, orgId, companyId, storeId, terminal1Id, cashierId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_shifts(id,organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opening_cash,expected_cash,counted_cash,cash_variance,opened_at,opened_by,closed_at,closed_by)
       VALUES ($1,$2,$3,$4,$5,'SHIFT-C',$6,'closed',100,336,336,0,'2024-01-16 09:00:00+00',$6,'2024-01-16 11:00:00+00',$6)`,
      [shiftCId, orgId, companyId, storeId, terminal2Id, cashierId],
    );
    // An OPEN shift on the same terminal/date must be entirely excluded.
    await admin.query(
      `INSERT INTO tenant.pos_shifts(id,organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opening_cash,expected_cash,opened_at,opened_by)
       VALUES ($1,$2,$3,$4,$5,'SHIFT-OPEN',$6,'open',0,0,'2024-01-16 12:00:00+00',$6)`,
      [shiftOpenId, orgId, companyId, storeId, terminal1Id, cashierId],
    );

    // Shift A source facts: opening 500, sale S1 (1000/50/171/1121), a
    // completed return R1 (refund 118), paid_in 200, paid_out -150.
    await insertCashMovement({ shiftId: shiftAId, movementType: "opening", amount: "500" });
    const sale1Id = randomUUID();
    await insertSale(sale1Id, { shiftId: shiftAId, terminalId: terminal1Id, subtotal: "1000", discount: "50", tax: "171", grand: "1121" });
    await insertCashMovement({ shiftId: shiftAId, movementType: "sale", amount: "1121" });
    const saleLine1 = await admin.query(`SELECT id FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale1Id]);
    const returnId = randomUUID();
    await admin.query(
      `INSERT INTO tenant.pos_returns(id,organization_id,company_id,store_id,terminal_id,shift_id,sale_id,return_number,reason,status,refund_total,requested_by,approved_by,approved_at,completed_by,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'RET-1','damaged','completed',118,$8,$8,now(),$8,now())`,
      [returnId, orgId, companyId, storeId, terminal1Id, shiftAId, sale1Id, supervisorId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_return_lines(id,organization_id,return_id,sale_line_id,quantity,refund_amount,restock) VALUES ($1,$2,$3,$4,1,118,false)`,
      [randomUUID(), orgId, returnId, saleLine1.rows[0].id],
    );
    await insertCashMovement({ shiftId: shiftAId, movementType: "refund", amount: "-118" });
    await insertCashMovement({ shiftId: shiftAId, movementType: "paid_in", amount: "200" });
    await insertCashMovement({ shiftId: shiftAId, movementType: "paid_out", amount: "-150" });
    // In-flight facts on shift A that must be EXCLUDED: a draft sale and a
    // voided sale.
    await insertSale(randomUUID(), { shiftId: shiftAId, terminalId: terminal1Id, subtotal: "999", discount: "0", tax: "0", grand: "999", status: "draft" });
    await insertSale(randomUUID(), { shiftId: shiftAId, terminalId: terminal1Id, subtotal: "500", discount: "0", tax: "0", grand: "500", status: "voided" });

    // Shift B: opening 300, sale S2 (500/0/90/590).
    await insertCashMovement({ shiftId: shiftBId, movementType: "opening", amount: "300" });
    await insertSale(randomUUID(), { shiftId: shiftBId, terminalId: terminal1Id, subtotal: "500", discount: "0", tax: "90", grand: "590" });
    await insertCashMovement({ shiftId: shiftBId, movementType: "sale", amount: "590" });

    // Shift C (terminal 2): opening 100, sale S3 (200/0/36/236).
    await insertCashMovement({ shiftId: shiftCId, movementType: "opening", amount: "100" });
    await insertSale(randomUUID(), { shiftId: shiftCId, terminalId: terminal2Id, subtotal: "200", discount: "0", tax: "36", grand: "236" });
    await insertCashMovement({ shiftId: shiftCId, movementType: "sale", amount: "236" });

    // Open shift's sale must never be counted anywhere.
    await insertSale(randomUUID(), { shiftId: shiftOpenId, terminalId: terminal1Id, subtotal: "999", discount: "0", tax: "0", grand: "999" });

    let report;
    await t.test("a plain cashier (no pos.report.generate) cannot generate a day-end report", async () => {
      await assert.rejects(
        () => tx((c) => generatePosDayEndReport(c, cashierContext, { storeId, scopeType: "business_day", businessDate: "2024-01-16", terminalId: terminal1Id })),
        (error) => error.code === "FORBIDDEN",
      );
    });

    await t.test("F303: business-day Z report for terminal 1 aggregates only CLOSED shifts A+B on the IST business date, excluding the open shift and in-flight sales", async () => {
      report = await tx((c) =>
        generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "business_day", businessDate: "2024-01-16", terminalId: terminal1Id }),
      );
      assert.equal(report.status, "draft");
      assert.equal(report.business_date instanceof Date ? report.business_date.toISOString().slice(0, 10) : report.business_date, "2024-01-16");
      assert.equal(report.sale_count, 2);
      assert.equal(report.gross_sales_total, "1500.000000");
      assert.equal(report.discount_total, "50.000000");
      assert.equal(report.tax_total, "261.000000");
      assert.equal(report.net_sales_total, "1450.000000");
      assert.equal(report.grand_sales_total, "1711.000000");
      assert.equal(report.return_count, 1);
      assert.equal(report.return_total, "118.000000");
      assert.equal(report.opening_cash_total, "800.000000");
      assert.equal(report.paid_in_total, "200.000000");
      assert.equal(report.paid_out_total, "-150.000000");
      assert.equal(report.expected_cash_total, "2443.000000");
      assert.equal(report.counted_cash_total, "2440.000000");
      assert.equal(report.cash_variance_total, "-3.000000");
      assert.deepEqual(report.tender_totals, [{ method: "cash", amount: "1711.000000", count: 2 }]);
      assert.equal(report.lineage.shiftIds.length, 2);
      assert.equal(report.lineage.saleIds.length, 2);
      assert.equal(report.lineage.returnIds.length, 1);
      assert.ok(report.report_number.startsWith("ZREP-"));
    });

    await t.test("F303: the same store-wide business-day scope (no terminal) also includes shift C on terminal 2", async () => {
      const storeWide = await tx((c) => generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "business_day", businessDate: "2024-01-16" }));
      assert.equal(storeWide.sale_count, 3);
      assert.equal(storeWide.gross_sales_total, "1700.000000");
      assert.equal(storeWide.grand_sales_total, "1947.000000");
      assert.equal(storeWide.expected_cash_total, "2779.000000");
      assert.equal(storeWide.counted_cash_total, "2776.000000");
      assert.equal(storeWide.cash_variance_total, "-3.000000");
    });

    await t.test("F303: a per-shift report derives its business_date from the STORE's timezone (Asia/Kolkata), not server UTC", async () => {
      const shiftReport = await tx((c) => generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "shift", shiftId: shiftAId }));
      // shiftA.closed_at = 2024-01-15 20:00:00 UTC -> 2024-01-16 01:30 IST.
      const businessDate = shiftReport.business_date instanceof Date ? shiftReport.business_date.toISOString().slice(0, 10) : shiftReport.business_date;
      assert.equal(businessDate, "2024-01-16");
      assert.equal(shiftReport.sale_count, 1);
      assert.equal(shiftReport.grand_sales_total, "1121.000000");
      assert.equal(shiftReport.cash_variance_total, "-3.000000");
    });

    await t.test("F303 reproducibility: regenerating the SAME draft scope twice yields byte-identical totals and the SAME row (not a duplicate)", async () => {
      const first = await tx((c) =>
        generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "business_day", businessDate: "2024-01-16", terminalId: terminal1Id }),
      );
      const second = await tx((c) =>
        generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "business_day", businessDate: "2024-01-16", terminalId: terminal1Id }),
      );
      assert.equal(first.id, second.id);
      assert.equal(first.report_number, second.report_number);
      for (const field of [
        "sale_count",
        "gross_sales_total",
        "discount_total",
        "tax_total",
        "net_sales_total",
        "grand_sales_total",
        "return_count",
        "return_total",
        "opening_cash_total",
        "paid_in_total",
        "paid_out_total",
        "expected_cash_total",
        "counted_cash_total",
        "cash_variance_total",
      ]) {
        assert.equal(first[field], second[field], `field ${field} must be identical across regenerations`);
      }
      assert.deepEqual(first.tender_totals, second.tender_totals);
      assert.deepEqual(first.lineage, second.lineage);

      const countRows = await admin.query(
        `SELECT count(*)::int AS n FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND store_id=$2 AND terminal_id=$3 AND business_date='2024-01-16' AND scope_type='business_day'`,
        [orgId, storeId, terminal1Id],
      );
      assert.equal(countRows.rows[0].n, 1, "regenerating a draft must never create a second row for the same scope");
    });

    let finalReport;
    await t.test("F303 state machine: draft -> reviewed (supervisor) -> the SAME person cannot finalize their own report", async () => {
      const reviewed = await tx((c) => reviewPosDayEndReport(c, supervisorContext, report.id));
      assert.equal(reviewed.status, "reviewed");
      // Real role templates never grant both pos.report.generate AND
      // pos.report.finalize to one role (see the pos_day_end_generate_
      // finalize SoD conflict in packages/permissions/src/roles.js) -- this
      // asserts the runtime maker-checker check itself, for the case a
      // custom role (or an org owner) legitimately holds both.
      const supervisorWithFinalizeContext = { ...supervisorContext, permissions: [...supervisorContext.permissions, "pos.report.finalize"] };
      await assert.rejects(
        () => tx((c) => finalizePosDayEndReport(c, supervisorWithFinalizeContext, report.id)),
        (error) => error.code === "POS_DAY_END_SELF_FINALIZE_BLOCKED",
      );
    });

    await t.test("F303 state machine: a DIFFERENT authority (pos.report.finalize) finalizes and locks the report", async () => {
      finalReport = await tx((c) => finalizePosDayEndReport(c, managerContext, report.id));
      assert.equal(finalReport.status, "closed");
      assert.equal(finalReport.finalized_by, managerId);
    });

    await t.test("F303 duplicate prevention: generating again for the same CLOSED scope returns the existing report unchanged, never a new one", async () => {
      const replay = await tx((c) =>
        generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "business_day", businessDate: "2024-01-16", terminalId: terminal1Id }),
      );
      assert.equal(replay.replayed, true);
      assert.equal(replay.id, finalReport.id);
      assert.equal(replay.status, "closed");
      const countRows = await admin.query(
        `SELECT count(*)::int AS n FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND store_id=$2 AND terminal_id=$3 AND business_date='2024-01-16' AND scope_type='business_day'`,
        [orgId, storeId, terminal1Id],
      );
      assert.equal(countRows.rows[0].n, 1);
    });

    await t.test("F303 immutability: a direct SQL UPDATE against a closed report is rejected by the database trigger, not just application code", async () => {
      await assert.rejects(
        () => tx((c) => c.query(`UPDATE tenant.pos_day_end_reports SET net_sales_total=net_sales_total+1 WHERE organization_id=$1 AND id=$2`, [orgId, finalReport.id])),
        /immutable/i,
      );
      await assert.rejects(
        () => tx((c) => reviewPosDayEndReport(c, supervisorContext, finalReport.id)),
        (error) => error.code === "POS_DAY_END_STATE_INVALID",
      );
    });

    await t.test("F303 correction: recording a variance against a closed report creates a NEW linked row and leaves the original provably untouched", async () => {
      const before = await tx((c) => getPosDayEndReport(c, managerContext, finalReport.id));
      const correction = await tx((c) =>
        recordPosDayEndVariance(c, managerContext, finalReport.id, {
          varianceType: "cash_variance",
          reason: "Manual bank-drop recount found an extra 3.00",
          adjustment: [{ field: "cash_variance_total", previousValue: "-3.000000", correctedValue: "0.000000" }],
        }),
      );
      assert.ok(correction.id);
      assert.equal(correction.original_report_id, finalReport.id);
      assert.ok(correction.correction_number.startsWith("ZCORR-"));

      const after = await tx((c) => getPosDayEndReport(c, managerContext, finalReport.id));
      // Bit-for-bit: every column on the ORIGINAL report row is identical
      // before and after the correction (corrections[] is fetched
      // separately by getPosDayEndReport and is not a column on the row).
      const { corrections: beforeCorrections, ...beforeRow } = before;
      const { corrections: afterCorrections, ...afterRow } = after;
      assert.deepEqual(JSON.parse(JSON.stringify(afterRow)), JSON.parse(JSON.stringify(beforeRow)));
      assert.equal(beforeCorrections.length, 0);
      assert.equal(afterCorrections.length, 1);
      assert.equal(afterCorrections[0].id, correction.id);
    });

    await t.test("F303: the list endpoint returns the closed report scoped to this store/company", async () => {
      const rows = await tx((c) => listPosDayEndReports(c, managerContext, { storeId, status: "closed" }));
      assert.ok(rows.some((row) => row.id === finalReport.id));
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_day_end_report_corrections",
      "pos_day_end_reports",
      "pos_return_lines",
      "pos_returns",
      "pos_sale_lines",
      "pos_payments",
      "pos_cash_movements",
      "pos_sales",
      "pos_shifts",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
      "stock_balances",
      "items",
      "price_lists",
      "tax_categories",
      "units_of_measure",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[cashierId, supervisorId, managerId]]).catch(() => undefined);
    await admin.end();
  }
});
