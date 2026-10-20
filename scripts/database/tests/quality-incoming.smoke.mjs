// Quality MVP 31 (Incoming Inspection): a goods receipt's control point opens the inspection; samples and observations; review;
// Quality's authorized disposition of exact quantities (80 / 15 / 5 and its reinspection); Inventory releases only what was accepted;
// supplier return, receipt reversal, evidence, amendments, manual inspections, queues and reports.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:quality-incoming     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the Quality suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

let passed = 0;
const failures = [];
async function check(name, work) {
  await client.query("SAVEPOINT smoke_check");
  try {
    await work();
    await client.query("RELEASE SAVEPOINT smoke_check");
    passed += 1;
    console.log("  ok   ", name);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_check");
    failures.push(name);
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 5).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function rejects(work, code) {
  try { await work(); } catch (error) { if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  throw new Error(`expected rejection ${code ?? ""}`);
}
const n = (value) => Number(value);

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const suppliers = await api("modules/procurement/suppliers/index.js");
  const po = { ...(await api("modules/procurement/purchase-orders/index.js")), ...(await api("modules/procurement/supplier-bills/index.js")), ...(await api("modules/procurement/purchase-returns/index.js")), ...(await api("modules/procurement/vendor-credits/index.js")) };
  const accounting = await api("modules/accounting/index.js");
  const { getDocumentRenderer } = await api("orchestration/documents/registry.js");

  const tag = Math.random().toString(16).slice(2, 10);
  const register = (name) => registerOrganization(client, {
    fullName: "Smoke Owner", email: `${name}-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `${name} ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const other = await register("otherpo");
  const registered = await register("purchasing");
  const organizationId = registered.organizationId;
  const switchTo = (org) => client.query("SELECT set_config('app.current_organization_id', $1, true)", [org]);
  await switchTo(organizationId);
  async function contextFor(userId, org = organizationId) {
    const { rows } = await client.query(
      `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
              COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
         LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [org, userId]);
    return { organizationId: org, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
  }
  async function addMember(roleSlug, name) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status) VALUES (gen_random_uuid(), $1, $2, 'x', 'active') RETURNING id`,
      [`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`,
      [organizationId, id, roleSlug]);
    return contextFor(id);
  }
  const owner = await contextFor(registered.userId);
  const rahul = await addMember("buyer", "Rahul Buyer");
  const meera = await addMember("purchase_manager", "Meera Manager");
  const gopal = await addMember("goods_receipt_user", "Gopal Stores");
  const anita = await addMember("accounts_payable_executive", "Anita Payables");
  const fiona = await addMember("finance_manager", "Fiona Finance");
  const reena = await addMember("purchase_requester", "Reena Requester");
  const without = (context, ...keys) => ({ ...context, permissions: context.permissions.filter((key) => !keys.includes(key)) });
  const today = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const day = (offset) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

  // The buying company in Maharashtra; GST 18% from the seeded categories; Net 30 for purchases.
  await client.query(`INSERT INTO tenant.tax_registrations (organization_id, code, name, legal_name, registration_number, state_code, state_name, address_line1, city, is_default)
                      VALUES ($1, 'MH', 'Vercent Mumbai', 'Vercent Industries Pvt Ltd', '27AAACV1111A1Z1', '27', 'Maharashtra', 'Andheri East', 'Mumbai', true)`, [organizationId]);
  const gst18 = (await client.query(`SELECT id FROM tenant.tax_categories WHERE organization_id = $1 AND code = 'GST-18'`, [organizationId])).rows[0].id;
  const net30 = (await client.query(`INSERT INTO tenant.payment_terms (organization_id, code, name, default_due_days, is_sales_enabled, is_purchase_enabled) VALUES ($1, 'NET30', 'Net 30', 30, true, true) RETURNING id`, [organizationId])).rows[0].id;
  const net60 = (await client.query(`INSERT INTO tenant.payment_terms (organization_id, code, name, default_due_days, is_sales_enabled, is_purchase_enabled) VALUES ($1, 'NET60', 'Net 60', 60, true, true) RETURNING id`, [organizationId])).rows[0].id;
  const unit = async (code, name, category, places) => (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = EXCLUDED.decimal_places RETURNING id`, [organizationId, code, name, category, places])).rows[0].id;
  const nos = await unit("NOS", "Numbers", "quantity", 0);
    const kg = await unit("KG", "Kilogram", "weight", 3);
    const hr = await unit("HR", "Hour", "time", 2);
  const mumbai = (await client.query(`INSERT INTO tenant.warehouses (organization_id, code, name) VALUES ($1, 'MUM', 'Mumbai') RETURNING id`, [organizationId])).rows[0].id;
  const qc = (await client.query(`INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, code, name, location_type) VALUES ($1, $2, 'QC', 'Quality', 'quality') RETURNING id`, [organizationId, mumbai])).rows[0].id;
  const item = async (code, name, type, tracked, uom, price, extra = {}) => (await client.query(
    `INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, purchase_uom_id, purchase_price, standard_cost, tax_category_id, track_inventory, hsn_sac_code, tracking_type, is_purchasable)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7, $8, $9, $10, true) RETURNING id`,
    [organizationId, code, name, type, uom, price, extra.taxCategoryId === undefined ? gst18 : extra.taxCategoryId, tracked, type === "service" ? "998719" : "8413", extra.tracking ?? "none"])).rows[0].id;
  const pump = await item("PUMP", "Industrial Pump", "product", true, nos, 9000);
  const cable = await item("CABLE", "Cable Kit", "product", false, nos, 200);
  const steel = await item("STEEL", "Steel Rod", "product", true, kg, 75);
  const service = await item("AMC", "Pump Maintenance", "service", false, hr, 1500);
  const valve = await item("VALVE", "Batch Valve", "product", true, nos, 400, { tracking: "batch" });
  const stockOf = async (itemId, locationId = null) => n((await client.query(
    `SELECT COALESCE(sum(quantity), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND ($3::uuid IS NULL OR warehouse_location_id = $3)`, [organizationId, itemId, locationId])).rows[0].q);
  const movementsOf = async (itemId) => Number((await client.query(`SELECT count(*) FROM tenant.stock_movements WHERE organization_id = $1 AND item_id = $2`, [organizationId, itemId])).rows[0].count);
  const payables = async () => n((await client.query(`SELECT COALESCE(sum(grand_total), 0) AS t FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND status IN ('posted','partially_paid','paid')`, [organizationId])).rows[0].t);

  const abc = (await suppliers.createSupplier(client, rahul, {
    supplierName: "ABC Components", supplierType: "business", category: "raw_materials", defaultCurrency: "INR", paymentTermId: net30, gstin: "27AAACA1234B1Z5", gstRegistrationType: "registered_regular",
    assignedBuyerId: rahul.userId, address: { line1: "Plot 4, MIDC", city: "Pune", state: "Maharashtra", postalCode: "411026" },
    primaryContact: { firstName: "Priya", lastName: "Sharma", email: "priya@abc.example" },
  })).supplier;
  const karnataka = (await suppliers.createSupplier(client, rahul, {
    supplierName: "Bangalore Castings", supplierType: "business", category: "raw_materials", defaultCurrency: "INR", paymentTermId: net30, gstin: "29AAACB1234C1Z2", gstRegistrationType: "registered_regular",
    address: { line1: "Peenya", city: "Bengaluru", state: "Karnataka", postalCode: "560058" }, primaryContact: { firstName: "Kiran", email: "kiran@bc.example" },
  })).supplier;
  const pumpLine = (quantity, unitPrice = "10000", extra = {}) => ({ productId: pump, quantity: String(quantity), unitPrice, warehouseId: mumbai, ...extra });
  const order = (context, lines, extra = {}) => po.createPurchaseOrder(client, context, { supplierId: abc.id, defaultWarehouseId: mumbai, expectedDeliveryDate: day(10), lines, ...extra });
  const read = (id, context = owner) => po.getPurchaseOrder(client, context, id);
  const confirmed = async (lines, extra = {}) => { const made = await order(rahul, lines, extra); await po.confirmPurchaseOrder(client, meera, made.id); return made; };
  const receive = (context, id, lines, extra = {}) => po.createGoodsReceiptFromPurchaseOrder(client, context, id, { lines, post: true, ...extra });
  const lineOf = async (orderId, index = 0) => (await read(orderId)).lines[index];
  // A bill recorded by Accounts Payable, then submitted and approved by Finance and posted.
  const postBill = async (billId) => {
    const submitted = await accounting.submitSubledgerDocument(client, anita, "vendor_bill", billId);
    if (submitted.status === "pending_approval") await accounting.approveSubledgerDocument(client, fiona, "vendor_bill", billId, submitted.contentHash);
    return accounting.postVendorBill(client, owner, billId);
  };
  console.log("workspace ready");
  {
  // ---- Quality — Quality Control Points on the procurement fixture.
  const qs = await api("modules/quality/specifications/index.js");
  const qcp = await api("modules/quality/control-points/index.js");
  const QH = await api("modules/stock/quality-holds.js");
  const stockApi = await api("modules/stock/index.js");
  const products = await api("modules/products/index.js");
  const qm = await addMember("quality_manager", "Quinn Quality");
  const qm2 = await addMember("quality_manager", "Rita Reviewer");
  const sup = await addMember("quality_supervisor", "Sam Supervisor");
  const insp = await addMember("quality_inspector", "Ivy Inspector");
  const fin = await addMember("finance_manager", "Farah Finance");
  let seq = 0;
  // A refusal in its own savepoint, as each request is its own transaction.
  const refused = async (work, code) => {
    await client.query("SAVEPOINT refused");
    try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
    await client.query("RELEASE SAVEPOINT refused");
    throw new Error(`expected rejection ${code}`);
  };
  const newItem = async (label) => item(`QC${++seq}-${tag}`.toUpperCase().slice(0, 30), label, "product", true, nos, 100);
  const visual = (extra = {}) => ({ code: "CON", name: "Connector condition", checkType: "VISUAL", acceptanceText: "No visible damage", instructions: "Inspect both ends", ...extra });
  const specFor = async (itemId, extra = {}) => {
    const made = await qs.createInspectionSpecification(client, sup, { name: "Incoming check", description: "Incoming", stage: "INCOMING", itemId, checks: [visual()], ...extra });
    await qs.submitSpecificationForReview(client, sup, made.specificationId, made.versionId);
    await qs.approveSpecificationVersion(client, qm, made.specificationId, made.versionId, { publish: true });
    return made;
  };
  const newQcp = (ctx, extra = {}) => qcp.createQualityControlPoint(client, ctx, { name: "Incoming inspection", description: "Hold until Quality clears", triggerEvent: "INVENTORY_GOODS_RECEIPT_CONFIRMED",
    requirementType: "MANDATORY", gateType: "HOLD_STOCK", specBinding: "FAMILY", ...extra });
  const publishQcp = async (made, versionId = made.versionId) => {
    await qcp.submitQualityControlPoint(client, qm2, made.controlPointId, versionId);
    return qcp.approveQualityControlPointVersion(client, qm, made.controlPointId, versionId, { publish: true });
  };
  const gated = async (itemId, specificationId, extra = {}) => {
    const made = await newQcp(qm2, { specificationId, rules: [{ scope: "ITEM", itemId }], ...extra });
    await publishQcp(made);
    return made;
  };
  const available = async (itemId) => Number((await stockApi.getStockAvailability(client, owner, { itemId })).availableQuantity);
  const receiveFor = async (itemId, qty, held = 0, extra = {}) => {
    const made = await confirmed([{ productId: itemId, quantity: String(qty), unitPrice: "10", warehouseId: mumbai }], extra.order ?? {});
    const ln = await lineOf(made.id);
    const grn = await receive(gopal, made.id, [{ purchaseOrderLineId: ln.id, receivedQuantity: String(qty), heldQuantity: String(held) }], extra.receipt ?? {});
    const line = (await client.query(`SELECT * FROM tenant.goods_receipt_lines WHERE goods_receipt_id = $1`, [grn.id])).rows[0];
    const obligations = (await client.query(`SELECT * FROM tenant.quality_inspection_obligations WHERE source_line_id = $1 ORDER BY created_at`, [line.id])).rows;
    const disposition = (await client.query(`SELECT * FROM tenant.goods_receipt_dispositions WHERE goods_receipt_line_id = $1 AND disposition = 'inspection_hold'`, [line.id])).rows[0] ?? null;
    const hold = (await client.query(`SELECT * FROM tenant.inventory_stock_holds WHERE source_line_id = $1`, [line.id])).rows[0] ?? null;
    return { order: made, grn, line, obligations, disposition, hold };
  };
  const obligation = async (id) => (await client.query(`SELECT * FROM tenant.quality_inspection_obligations WHERE id = $1`, [id])).rows[0];
  // Executing an inspection (MVP 31): start (samples), record each sample's checks to the given outcome, submit, review when it goes to
  // review, then the authorized disposition (default: accept a pass, reject a failure; or the given one).
  const qin = await api("modules/quality/incoming/index.js");
  const observationFor = (ch, outcome) => {
    const pass = outcome === "pass";
    switch (ch.checkType) {
      case "NUMERIC_RANGE": case "NUMERIC_TARGET_TOLERANCE": {
        const ok = ch.criterion.match(/([0-9.]+)[–-]([0-9.]+)/);
        return { value: ok ? (pass ? ok[1] : String(Number(ok[2]) + 1)) : pass ? "1" : "999" };
      }
      case "BOOLEAN": return { value: pass ? ch.expected !== false : ch.expected === false };
      case "ENUM": return { value: (ch.choices.find((x) => x.acceptable === pass) ?? ch.choices[0]).value };
      case "TEXT_OBSERVATION": return { value: "Observed", judgement: pass ? "PASS" : "FAIL" };
      default: return { judgement: pass ? "PASS" : "FAIL" };
    }
  };
  const runInspection = async (inspectionId, outcomes, decide = null) => {
    await qin.startIncomingInspection(client, insp, inspectionId, {});
    let detail = await qin.getIncomingInspection(client, qm, inspectionId);
    const results = [];
    detail.samples.forEach((s, i) => detail.characteristics.forEach((ch) => results.push({ sampleId: s.id, characteristicId: ch.id, ...observationFor(ch, outcomes[i] ?? "pass") })));
    await qin.recordIncomingResults(client, insp, inspectionId, { results });
    const submitted = await qin.submitIncomingInspection(client, insp, inspectionId, {});
    if (submitted.status === "AWAITING_REVIEW") await qin.reviewIncomingInspection(client, qm, inspectionId, { decision: "APPROVE", outcome: submitted.evaluation.proposed === "PASS" ? "PASS" : "FAIL" });
    detail = await qin.getIncomingInspection(client, qm, inspectionId);
    const decision = decide ?? (detail.proposed === "PASS" ? { decision: "ACCEPT" } : { decision: "REJECT" });
    if (decision !== false) await qin.authorizeQualityDisposition(client, qm, inspectionId, { reason: "Decided on the evidence", ...decision });
    return (await client.query(`SELECT * FROM tenant.quality_inspections WHERE id = $1`, [inspectionId])).rows[0];
  };
  const inspect = (inspectionId, outcomes, decide = null) => runInspection(inspectionId, outcomes, decide);

  // ---- Quality — Incoming Inspection (MVP 31): a goods receipt's control point opens the inspection; an inspector records sample-level
  // evidence; review; Quality's authorized disposition of exact quantities; Inventory releases only what was accepted.
  await unit("M", "Metre", "length", 3);
  const ian = await addMember("quality_inspector", "Ian Inspector");
  const cableChecks = (extra = {}) => [
    { code: "LEN", name: "Cable length", checkType: "NUMERIC_RANGE", lowerLimit: "0.95", upperLimit: "1.05", unitCode: "M", criticality: "MAJOR", instructions: "Measure with the approved ruler" },
    { code: "CON", name: "Connector condition", checkType: "VISUAL", acceptanceText: "No visible damage", criticality: "MAJOR", instructions: "Inspect both ends" },
    { code: "CHG", name: "Charging function", checkType: "BOOLEAN", expectedBoolean: true, criticality: "CRITICAL", instructions: "Test using the approved setup", ...extra },
  ];
  const held = async (label, qty, extra = {}) => {
    const itemId = await newItem(label);
    const spec = await specFor(itemId, { samplingMethod: "FIXED_COUNT", sampleValue: "3", checks: cableChecks(extra.chg) });
    await gated(itemId, spec.specificationId);
    const r = await receiveFor(itemId, qty);
    return { itemId, spec, r, inspectionId: r.obligations[0].inspection_id };
  };
  const detail = (id, ctx = qm) => qin.getIncomingInspection(client, ctx, id);
  const charOf = (d, code) => d.characteristics.find((x) => x.code === code).id;
  const allPass = (d) => d.samples.flatMap((s) => [{ sampleId: s.id, characteristicId: charOf(d, "LEN"), value: "1.00" },
    { sampleId: s.id, characteristicId: charOf(d, "CON"), judgement: "PASS" }, { sampleId: s.id, characteristicId: charOf(d, "CHG"), value: true }]);
  const BAD = { LEN: { value: "1.20" }, CON: { judgement: "FAIL" }, CHG: { value: false } };
  // Start, record every sample (the first sample failing the given checks), submit; a second Quality manager approves when it goes to review.
  const inspectWith = async (inspectionId, fail = [], who = insp) => {
    await qin.startIncomingInspection(client, who, inspectionId, {});
    const d = await detail(inspectionId);
    const code = (id) => d.characteristics.find((x) => x.id === id).code;
    const results = allPass(d).map((x) => (x.sampleId === d.samples[0].id && fail.includes(code(x.characteristicId)) ? { ...x, ...BAD[code(x.characteristicId)] } : x));
    await qin.recordIncomingResults(client, who, inspectionId, { results });
    const sent = await qin.submitIncomingInspection(client, who, inspectionId, {});
    if (sent.status === "AWAITING_REVIEW") await qin.reviewIncomingInspection(client, qm2, inspectionId, { decision: "APPROVE", note: "Evidence checked" });
    return detail(inspectionId);
  };
  const dispose = (ctx, id, input) => qin.authorizeQualityDisposition(client, ctx, id, { reason: "Decided on the evidence", ...input });
  const receiptNumber = async (grnId) => (await client.query(`SELECT receipt_number FROM tenant.goods_receipts WHERE id = $1`, [grnId])).rows[0].receipt_number;

  await check("IN1. Linked to the receipt: the control point opens one inspection awaiting an inspector, bound to the exact receipt line, its quantity, the requirement and the frozen specification; only a company member is assigned, and the assigned inspector works it", async () => {
    const { r, inspectionId } = await held("Assigned cable", 40);
    let d = await detail(inspectionId);
    assert(d.supplier === "ABC Components" && d.purchaseOrder?.number && d.unit === "NOS", JSON.stringify([d.supplier, d.purchaseOrder, d.unit]));
    assert(d.status === "PENDING" && d.quantity === 40 &&d.receipt?.number === await receiptNumber(r.grn.id) && d.version?.id && d.characteristics.length === 3,
      JSON.stringify([d.status, d.quantity, d.receipt, d.version]));
    const row = (await client.query(`SELECT goods_receipt_line_id, obligation_id, qcp_version_id FROM tenant.quality_inspections WHERE id = $1`, [inspectionId])).rows[0];
    assert(row.goods_receipt_line_id === r.line.id && row.obligation_id === r.obligations[0].id && row.qcp_version_id === r.obligations[0].qcp_version_id, JSON.stringify(row));
    assert((await qin.listIncomingInspections(client, qm, { view: "awaiting" })).some((x) => x.id === inspectionId), "in the awaiting queue");
    const stranger = (await client.query(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
    await refused(async () => qin.assignIncomingInspector(client, qm, inspectionId, { inspectorId: stranger }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(async () => qin.assignIncomingInspector(client, insp, inspectionId, { inspectorId: insp.userId }), "QUALITY_INCOMING_ACCESS_DENIED");
    await qin.assignIncomingInspector(client, sup, inspectionId, { inspectorId: insp.userId, priority: "HIGH", dueAt: day(1) });
    d = await detail(inspectionId);
    assert(d.status === "ASSIGNED" && d.inspector?.id === insp.userId && d.priority === "HIGH" && d.dueAt, JSON.stringify([d.status, d.inspector, d.priority]));
    assert((await qin.listIncomingInspections(client, insp, { view: "mine" })).some((x) => x.id === inspectionId), "in the inspector's own queue");
    await refused(async () => qin.startIncomingInspection(client, ian, inspectionId, {}), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => qin.assignIncomingInspector(client, sup, inspectionId, { inspectorId: ian.userId, version: d.rowVersion - 1 }), "QUALITY_INCOMING_CONCURRENT_CHANGE");
  });

  await check("IN2. Samples and results: starting selects the plan's samples once (S01…); results are evaluated as saved — out of limit is a failed observation, malformed values and other units are refused, not-applicable needs a reason — and saving again keeps the earlier observation", async () => {
    const { inspectionId } = await held("Measured cable", 40);
    await qin.startIncomingInspection(client, insp, inspectionId, {});
    await qin.startIncomingInspection(client, insp, inspectionId, {});
    let d = await detail(inspectionId);
    assert(d.status === "IN_PROGRESS" && d.samples.map((s) => s.code).join() === "S01,S02,S03" && d.inspector?.id === insp.userId, JSON.stringify(d.samples.map((s) => s.code)));
    const s1 = d.samples[0].id;
    const len = charOf(d, "LEN");
    await refused(async () => qin.recordIncomingResults(client, insp, inspectionId, { results: [{ sampleId: s1, characteristicId: len, value: "abc" }] }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(async () => qin.recordIncomingResults(client, insp, inspectionId, { results: [{ sampleId: s1, characteristicId: len, value: "100", unit: "CM" }] }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(async () => qin.recordIncomingResults(client, insp, inspectionId, { results: [{ sampleId: s1, characteristicId: charOf(d, "CON"), notApplicable: true }] }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(async () => qin.recordIncomingResults(client, ian, inspectionId, { results: [{ sampleId: s1, characteristicId: len, value: "1.00" }] }), "QUALITY_INCOMING_ACCESS_DENIED");
    const saved = await qin.recordIncomingResults(client, insp, inspectionId, { results: [{ sampleId: s1, characteristicId: len, value: "1.07" }] });
    assert(saved.saved === 1 && saved.evaluation.proposed === null && saved.evaluation.incomplete > 0, JSON.stringify(saved.evaluation));
    d = await detail(inspectionId);
    assert(d.observations.find((o) => o.characteristicId === len).outcome === "FAIL", "an out-of-limit length is a failed observation");
    await qin.recordIncomingResults(client, insp, inspectionId, { results: [{ sampleId: s1, characteristicId: len, value: "1.02", notes: "Re-measured" }] });
    d = await detail(inspectionId);
    const current = d.observations.filter((o) => o.characteristicId === len);
    assert(current.length === 1 && current[0].outcome === "PASS" && d.superseded.length === 1 && d.superseded[0].value === "1.07", JSON.stringify([current, d.superseded]));
  });

  await check("IN3. Completing the evidence releases nothing: every required check is needed to submit; a passing inspection completes without review, the stock stays held until Quality's disposition, and only then can Inventory release it", async () => {
    const { itemId, r, inspectionId } = await held("Clean cable", 40);
    await qin.startIncomingInspection(client, insp, inspectionId, {});
    let d = await detail(inspectionId);
    await qin.recordIncomingResults(client, insp, inspectionId, { results: allPass(d).slice(0, 4) });
    await refused(async () => qin.submitIncomingInspection(client, insp, inspectionId, {}), "QUALITY_INCOMING_RESULT_MISSING");
    await qin.recordIncomingResults(client, insp, inspectionId, { results: allPass(d) });
    const done = await qin.submitIncomingInspection(client, insp, inspectionId, {});
    assert(done.status === "COMPLETED" && done.evaluation.proposed === "PASS", JSON.stringify(done));
    d = await detail(inspectionId);
    assert(d.status === "COMPLETED" && d.disposition === "NONE" && d.inventory.stillHeld === 40 && d.inventory.cleared === 0 && d.actions.decide, JSON.stringify(d.inventory));
    await refused(async () => po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "1" }), "QUALITY_QCP_GATE_ACTIVE");
    await refused(async () => qin.recordIncomingResults(client, insp, inspectionId, { results: allPass(d).slice(0, 1) }), "QUALITY_INCOMING_STATE");
    assert((await qin.listIncomingInspections(client, qm, { view: "disposition" })).some((x) => x.id === inspectionId), "awaits a disposition");
    const usable = await available(itemId);
    const decided = await dispose(qm, inspectionId, { decision: "ACCEPT", reason: "All samples passed" });
    d = await detail(inspectionId);
    assert(/^QD/.test(decided.number) && decided.effects.waiting.length === 1 && d.inventory.cleared === 40 && d.inventory.awaitingRelease === 40 && d.inventory.requirement.label === "Accepted",
      JSON.stringify([decided, d.inventory]));
    await po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "40" });
    assert(await available(itemId) === usable + 40, "released after the disposition");
    assert((await qin.listIncomingInspections(client, qm, { view: "completed" })).some((x) => x.id === inspectionId), "completed");
  });

  await check("IN4. Review: a failed inspection goes to review, never by the person who submitted it; sending it back needs a note, a changed result then needs a reason, and every submission is kept", async () => {
    const { inspectionId } = await held("Reviewed cable", 40);
    await qin.startIncomingInspection(client, sup, inspectionId, {});
    let d = await detail(inspectionId);
    const results = allPass(d);
    results[0] = { ...results[0], value: "1.20" };
    await qin.recordIncomingResults(client, sup, inspectionId, { results });
    const sent = await qin.submitIncomingInspection(client, sup, inspectionId, {});
    assert(sent.status === "AWAITING_REVIEW" && sent.evaluation.proposed === "FAIL" && !sent.evaluation.criticalFail, JSON.stringify(sent.evaluation));
    await refused(async () => qin.reviewIncomingInspection(client, sup, inspectionId, { decision: "APPROVE" }), "QUALITY_INCOMING_SELF_DECISION");
    await refused(async () => qin.reviewIncomingInspection(client, insp, inspectionId, { decision: "APPROVE" }), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => qin.recordIncomingResults(client, sup, inspectionId, { results: [results[0]] }), "QUALITY_INCOMING_STATE");
    await refused(async () => qin.reviewIncomingInspection(client, qm, inspectionId, { decision: "REQUEST_CHANGES" }), "QUALITY_INCOMING_REASON_REQUIRED");
    await qin.reviewIncomingInspection(client, qm, inspectionId, { decision: "REQUEST_CHANGES", note: "Sample 1 length looks like a typing error: measure again" });
    await refused(async () => qin.recordIncomingResults(client, sup, inspectionId, { results: [{ ...results[0], value: "1.01" }] }), "QUALITY_INCOMING_REASON_REQUIRED");
    await qin.recordIncomingResults(client, sup, inspectionId, { results: [{ ...results[0], value: "1.01", amendmentReason: "Measured again: 1.01 m" }] });
    const again = await qin.submitIncomingInspection(client, sup, inspectionId, {});
    d = await detail(inspectionId);
    assert(again.status === "COMPLETED" && d.reviews.filter((x) => x.action === "SUBMITTED").length === 2 && d.reviews.some((x) => x.action === "CHANGES_REQUESTED"), JSON.stringify(d.reviews.map((x) => x.action)));
    const corrected = d.observations.find((o) => o.sampleId === results[0].sampleId && o.characteristicId === results[0].characteristicId);
    assert(d.superseded.some((o) => o.value === "1.2") && corrected.amendment === "Measured again: 1.01 m", JSON.stringify(corrected));
  });

  await check("IN5. The definition of done: 100 received and held; the authorized disposition accepts 80, rejects 15 and sends 5 to reinspection — only the 80 become available, the 15 stay controlled on a rejection case, the 5 cannot be released until their linked reinspection clears them, and the original inspection is not overwritten", async () => {
    const { itemId, r, inspectionId } = await held("Done cable", 100);
    const d0 = await inspectWith(inspectionId, ["LEN"]);
    assert(d0.status === "COMPLETED" && d0.proposed === "FAIL" && !d0.criticalFailure, JSON.stringify([d0.status, d0.proposed]));
    const original = d0.observations.map((o) => o.id).sort().join();
    const usable = await available(itemId);
    const decided = await dispose(qm, inspectionId, { decision: "PARTIAL_ACCEPT", acceptQuantity: "80", rejectQuantity: "15", reinspectQuantity: "5", rejectRoute: "RETURN_TO_SUPPLIER",
      reason: "Segregated: 15 short cables, 5 borderline", reinspection: { standard: "ORIGINAL", reason: "Borderline lengths" }, nonconformance: { severity: "major", description: "15 cables short of length" } });
    let d = await detail(inspectionId);
    assert(d.totals.accept === 80 && d.totals.reject === 15 && d.totals.reinspect === 5 && d.totals.undecided === 0 && d.disposition === "DECIDED", JSON.stringify(d.totals));
    assert(decided.reinspectionId && decided.nonconformanceId && d.nonconformances.length === 1 && d.reinspections.length === 1 && d.reinspections[0].quantity === 5 && d.reinspections[0].standard === "ORIGINAL",
      JSON.stringify([decided, d.reinspections]));
    assert(d.inventory.cleared === 80 && d.inventory.requirement.status === "PENDING" && d.inventory.requirement.label === "Decided 95 of 100", JSON.stringify(d.inventory));
    assert(decided.effects.rejectionId && d.dispositions[0].rejection?.id === decided.effects.rejectionId && d.inventory.blocked === 15, JSON.stringify([decided.effects, d.inventory]));
    await refused(async () => po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "81" }), "QUALITY_QCP_GATE_ACTIVE");
    await po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "80" });
    assert(await available(itemId) === usable + 80, "only the 80 become available");
    await refused(async () => po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "1" }), "QUALITY_QCP_GATE_ACTIVE");
    await refused(async () => dispose(qm, inspectionId, { decision: "ACCEPT" }), "QUALITY_INCOMING_QUANTITY_MISMATCH");
    // The 5: a linked reinspection under the original standard.
    const re = await detail(decided.reinspectionId);
    assert(re.reinspectionOf?.id === inspectionId && re.quantity === 5 && re.version.id === d.version.id && re.status === "PENDING" && re.standardDecision === "ORIGINAL",
      JSON.stringify([re.reinspectionOf, re.quantity, re.status]));
    assert((await qin.listIncomingInspections(client, qm, { view: "reinspection" })).some((x) => x.id === re.id), "in the reinspection queue");
    await inspectWith(re.id, []);
    await dispose(qm, re.id, { decision: "ACCEPT", reason: "Measured again: in tolerance" });
    d = await detail(inspectionId);
    assert(d.observations.map((o) => o.id).sort().join() === original && d.totals.accept === 80, "the original inspection keeps its own evidence and decision");
    assert(d.inventory.cleared === 85 && d.inventory.requirement.status === "FAILED" && d.inventory.requirement.label === "Partly accepted", JSON.stringify(d.inventory));
    await po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "5" });
    assert(await available(itemId) === usable + 85, "85 in the end");
    // Nothing held is left undecided: the 15 rejected are handled only through their rejection case.
    await refused(async () => po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "1" }), "GOODS_RECEIPT_RELEASE_EXCEEDS_HELD");
    const root = (await client.query(`SELECT accepted_quantity, rejected_quantity, status FROM tenant.quality_inspections WHERE id = $1`, [inspectionId])).rows[0];
    assert(Number(root.accepted_quantity) === 85 && Number(root.rejected_quantity) === 15 && root.status === "failed", JSON.stringify(root));
  });

  await check("IN6. A supplier return of rejected goods takes them out of the Quality location once: on-hand falls by exactly the returned quantity, usable stock is unchanged, and the case cannot be returned twice", async () => {
    const { itemId, r, inspectionId } = await held("Returned cable", 50);
    await inspectWith(inspectionId, ["CON"]);
    const decided = await dispose(qm, inspectionId, { decision: "PARTIAL_ACCEPT", acceptQuantity: "40", rejectQuantity: "10", rejectRoute: "RETURN_TO_SUPPLIER", reason: "10 with damaged connectors" });
    await po.releaseHeldGoods(client, gopal, r.disposition.id, { quantity: "40" });
    const onHand = await stockOf(itemId);
    const usable = await available(itemId);
    await po.recordRejectionResolution(client, gopal, decided.effects.rejectionId, { type: "purchase_return_posted", notes: "Damaged connectors back to ABC" });
    assert(await stockOf(itemId) === onHand - 10 && await available(itemId) === usable, JSON.stringify([onHand, await stockOf(itemId), usable, await available(itemId)]));
    const d = await detail(inspectionId);
    assert(d.inventory.returned === 10 && d.inventory.stillHeld === 0 && d.inventory.released === 40, JSON.stringify(d.inventory));
    await refused(async () => po.recordRejectionResolution(client, gopal, decided.effects.rejectionId, { type: "purchase_return_posted", notes: "Again" }));
    assert(await stockOf(itemId) === onHand - 10, "never subtracted twice");
  });

  await check("IN7. Decision rules: a failed lot is not simply accepted; a reason is required; quantities never exceed what is undecided (one unit is never both accepted and rejected); a deviation needs the waive permission and its conditions; a retried decision is not applied twice", async () => {
    const { inspectionId } = await held("Ruled cable", 30);
    await inspectWith(inspectionId, ["CON"]);
    await refused(async () => dispose(qm, inspectionId, { decision: "ACCEPT" }), "QUALITY_INCOMING_CRITICAL_FAILURE");
    await refused(async () => qin.authorizeQualityDisposition(client, qm, inspectionId, { decision: "REJECT" }), "QUALITY_INCOMING_REASON_REQUIRED");
    await refused(async () => dispose(qm, inspectionId, { decision: "PARTIAL_ACCEPT", acceptQuantity: "25", rejectQuantity: "10" }), "QUALITY_INCOMING_QUANTITY_MISMATCH");
    await refused(async () => dispose(qm, inspectionId, { decision: "PARTIAL_ACCEPT", acceptQuantity: "30" }), "QUALITY_INCOMING_QUANTITY_MISMATCH");
    await refused(async () => dispose(sup, inspectionId, { decision: "REJECT" }), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => dispose(without(qm, "quality.disposition.waive"), inspectionId, { decision: "CONDITIONAL_ACCEPT", conditionalQuantity: "10", conditions: "Test rigs only" }), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => dispose(qm, inspectionId, { decision: "CONDITIONAL_ACCEPT", conditionalQuantity: "10" }), "QUALITY_INCOMING_REASON_REQUIRED");
    const key = `cond-${tag}`;
    const first = await dispose(qm, inspectionId, { decision: "CONDITIONAL_ACCEPT", conditionalQuantity: "10", conditions: "Use only on internal test rigs", reason: "Cosmetic connector marks", idempotencyKey: key });
    const retry = await dispose(qm, inspectionId, { decision: "CONDITIONAL_ACCEPT", conditionalQuantity: "10", conditions: "Use only on internal test rigs", reason: "Cosmetic connector marks", idempotencyKey: key });
    assert(retry.replayed && retry.id === first.id, JSON.stringify(retry));
    await refused(async () => dispose(qm, inspectionId, { decision: "REJECT", rejectQuantity: "21" }), "QUALITY_INCOMING_QUANTITY_MISMATCH");
    await dispose(qm, inspectionId, { decision: "SCRAP", reason: "Connectors beyond repair" });
    const d = await detail(inspectionId);
    assert(d.dispositions.length === 2 && d.totals.conditional === 10 && d.totals.reject === 20 && d.totals.undecided === 0 && d.inventory.cleared === 10 && d.inventory.requirement.label === "Partly accepted",
      JSON.stringify([d.totals, d.inventory]));
    await refused(async () => dispose(qm, inspectionId, { decision: "HOLD_FOR_REVIEW" }), "QUALITY_INCOMING_QUANTITY_MISMATCH");
    const conditional = await qin.getIncomingReport(client, qm, "conditional");
    assert(conditional.rows.some((x) => x.inspection === d.number && Number(x.quantity) === 10 && /test rigs/.test(x.conditions)), JSON.stringify(conditional.rows));
  });

  await check("IN8. A critical failure stops acceptance: the lot is not accepted outright, accepting any part of it needs the waive permission, and the failed critical check stays on the record", async () => {
    const { inspectionId } = await held("Critical cable", 20);
    const d = await inspectWith(inspectionId, ["CHG"]);
    assert(d.criticalFailure && d.proposed === "FAIL" && d.evaluation.failed.some((x) => x.criticality === "CRITICAL"), JSON.stringify(d.evaluation));
    await refused(async () => dispose(qm, inspectionId, { decision: "ACCEPT" }), "QUALITY_INCOMING_CRITICAL_FAILURE");
    await refused(async () => dispose(without(qm, "quality.disposition.waive"), inspectionId, { decision: "PARTIAL_ACCEPT", acceptQuantity: "19", rejectQuantity: "1" }), "QUALITY_INCOMING_CRITICAL_FAILURE");
    await dispose(without(qm, "quality.disposition.waive"), inspectionId, { decision: "REJECT", rejectQuantity: "20", rejectRoute: "SCRAP", reason: "Charging fails: scrap the lot" });
    const after = await detail(inspectionId);
    assert(after.totals.reject === 20 && after.inventory.cleared === 0 && after.inventory.requirement.label === "Rejected", JSON.stringify(after.inventory));
  });

  await check("IN9. The inspector doesn't decide their own inspection: a Quality manager who inspected it is refused, another one decides", async () => {
    const { inspectionId } = await held("Self cable", 10);
    const d = await inspectWith(inspectionId, [], qm);
    assert(d.status === "COMPLETED" && d.inspector?.id === qm.userId, JSON.stringify([d.status, d.inspector]));
    await refused(async () => dispose(qm, inspectionId, { decision: "ACCEPT" }), "QUALITY_INCOMING_SELF_DECISION");
    await dispose(qm2, inspectionId, { decision: "ACCEPT", reason: "All checks passed" });
  });

  await check("IN10. Receipt reversal: once inspection starts the receipt can't be reversed; a reviewer cancels the inspection with a reason, then the reversal cancels the requirement — and a decided inspection is never cancelled", async () => {
    const { r, inspectionId } = await held("Reversal cable", 12);
    await qin.startIncomingInspection(client, insp, inspectionId, {});
    await refused(async () => po.reversePostedGoodsReceipt(client, meera, r.grn.id, { reason: "Wrong truck" }), "GOODS_RECEIPT_IN_USE");
    await refused(async () => qin.cancelIncomingInspection(client, insp, inspectionId, { reason: "Wrong truck" }), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => qin.cancelIncomingInspection(client, qm, inspectionId, {}), "QUALITY_INCOMING_REASON_REQUIRED");
    await qin.cancelIncomingInspection(client, qm, inspectionId, { reason: "Wrong truck: the receipt is being reversed" });
    await po.reversePostedGoodsReceipt(client, meera, r.grn.id, { reason: "Wrong truck" });
    const d = await detail(inspectionId);
    const ob = await obligation(r.obligations[0].id);
    assert(d.status === "CANCELLED" && d.cancelReason && d.history.some((h) => h.label === "Cancelled") && ob.status === "CANCELLED" && ob.source_reversed, JSON.stringify([d.status, ob.status]));
    const second = await held("Decided cable", 6);
    await inspectWith(second.inspectionId, []);
    await dispose(qm, second.inspectionId, { decision: "ACCEPT", reason: "Passed" });
    await refused(async () => qin.cancelIncomingInspection(client, qm, second.inspectionId, { reason: "Changed my mind" }), "QUALITY_INCOMING_STATE");
    await refused(async () => po.reversePostedGoodsReceipt(client, meera, second.r.grn.id, { reason: "Wrong truck" }), "GOODS_RECEIPT_IN_USE");
  });

  await check("IN11. Evidence: a check that requires evidence can't be submitted without it; only photos and documents are accepted; a file a result refers to stays, and nothing is removed once submitted", async () => {
    const { inspectionId } = await held("Evidence cable", 10, { chg: { evidenceRequired: true, evidenceNote: "Photo of the tester" } });
    await qin.startIncomingInspection(client, insp, inspectionId, {});
    let d = await detail(inspectionId);
    await qin.recordIncomingResults(client, insp, inspectionId, { results: allPass(d) });
    await refused(async () => qin.submitIncomingInspection(client, insp, inspectionId, {}), "QUALITY_INCOMING_EVIDENCE_MISSING");
    await refused(async () => qin.prepareInspectionEvidenceUpload({ fileName: "tool.exe", bytes: Buffer.from("MZ") }), "QUALITY_INCOMING_EVIDENCE_MISSING");
    const png = () => qin.prepareInspectionEvidenceUpload({ fileName: "tester.png", bytes: Buffer.from("89504e470d0a1a0a", "hex") });
    await refused(async () => qin.uploadInspectionEvidence(client, rahul, inspectionId, { prepared: await png() }), "QUALITY_INCOMING_ACCESS_DENIED");
    const photo = await qin.uploadInspectionEvidence(client, insp, inspectionId, { prepared: await png() });
    const spare = await qin.uploadInspectionEvidence(client, insp, inspectionId, { prepared: await png() });
    await qin.recordIncomingResults(client, insp, inspectionId, { results: [{ sampleId: d.samples[0].id, characteristicId: charOf(d, "CHG"), value: true, evidenceFileIds: [photo.id] }] });
    await refused(async () => qin.removeInspectionEvidence(client, insp, inspectionId, photo.id), "QUALITY_INCOMING_STATE");
    await qin.removeInspectionEvidence(client, insp, inspectionId, spare.id);
    const done = await qin.submitIncomingInspection(client, insp, inspectionId, {});
    assert(done.status === "COMPLETED", JSON.stringify(done));
    await refused(async () => qin.removeInspectionEvidence(client, insp, inspectionId, photo.id), "QUALITY_INCOMING_STATE");
    d = await detail(inspectionId, rahul);
    assert(d.files.length === 1 && d.files[0].id === photo.id && d.observations.some((o) => o.evidence.includes(photo.id)), JSON.stringify(d.files));
  });

  await check("IN12. A completed result is corrected only with a reason, by someone allowed to correct, before a disposition is made on it — the earlier value stays in the history", async () => {
    const { inspectionId } = await held("Amended cable", 10);
    let d = await inspectWith(inspectionId, []);
    const target = { sampleId: d.samples[1].id, characteristicId: charOf(d, "LEN"), value: "1.03" };
    await refused(async () => qin.amendIncomingResult(client, sup, inspectionId, { results: [target] }), "QUALITY_INCOMING_REASON_REQUIRED");
    await refused(async () => qin.amendIncomingResult(client, insp, inspectionId, { reason: "Typo", results: [target] }), "QUALITY_INCOMING_ACCESS_DENIED");
    await qin.amendIncomingResult(client, sup, inspectionId, { reason: "Transcription error on S02", results: [target] });
    d = await detail(inspectionId);
    assert(d.status === "COMPLETED" && d.proposed === "PASS" && d.superseded.some((o) => o.sampleId === target.sampleId && o.value === "1") && d.history.some((h) => h.label === "Result corrected"),
      JSON.stringify([d.status, d.superseded]));
    await dispose(qm, inspectionId, { decision: "ACCEPT", reason: "Passed" });
    await refused(async () => qin.amendIncomingResult(client, sup, inspectionId, { reason: "Another", results: [target] }), "QUALITY_INCOMING_STATE");
  });

  await check("IN13. A manual inspection of a receipt line (no control point): only for someone allowed, bound to the specification in force, once per request; no approved specification means none", async () => {
    const itemId = await newItem("Manual cable");
    await specFor(itemId, { samplingMethod: "FIXED_COUNT", sampleValue: "2", checks: cableChecks() });
    const r = await receiveFor(itemId, 8);
    assert(r.obligations.length === 0, "no control point: nothing held");
    await refused(async () => qin.createManualIncomingInspection(client, insp, { goodsReceiptLineId: r.line.id }), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => qin.createManualIncomingInspection(client, sup, { goodsReceiptLineId: r.line.id, quantity: "0" }), "QUALITY_INCOMING_QUANTITY_MISMATCH");
    const made = await qin.createManualIncomingInspection(client, sup, { goodsReceiptLineId: r.line.id, quantity: "8", reason: "Complaints about this supplier", idempotencyKey: `man-${tag}` });
    const again = await qin.createManualIncomingInspection(client, sup, { goodsReceiptLineId: r.line.id, quantity: "8", idempotencyKey: `man-${tag}` });
    assert(again.replayed && again.id === made.id, JSON.stringify(again));
    const d = await detail(made.id);
    assert(d.status === "PENDING" && d.quantity === 8 && d.version?.id && d.receipt?.number === await receiptNumber(r.grn.id) && d.history.some((h) => h.label === "Created by hand"), JSON.stringify([d.status, d.receipt]));
    const bare = await receiveFor(await newItem("Unspecified cable"), 3);
    await refused(async () => qin.createManualIncomingInspection(client, sup, { goodsReceiptLineId: bare.line.id, quantity: "3" }), "QUALITY_INCOMING_SPEC_MISSING");
  });

  await check("IN14. Queues, counts, dashboard and the fifteen reports follow the permissions and the Company: viewers read but don't act, other roles and other Companies see nothing", async () => {
    const { itemId, inspectionId } = await held("Reported cable", 9);
    const counts = await qin.getIncomingCounts(client, qm);
    assert(counts.awaiting >= 1 && typeof counts.exceptions === "number" && typeof counts.review === "number", JSON.stringify(counts));
    const board = await qin.getIncomingDashboard(client, qm);
    assert(board.receiptsHeld >= 1 && board.quantityHeld >= 9, JSON.stringify(board));
    const code = (await client.query(`SELECT code FROM tenant.items WHERE id = $1`, [itemId])).rows[0].code;
    const found = await qin.listIncomingInspections(client, qm, { search: code });
    assert(found.length === 1 && found[0].id === inspectionId, JSON.stringify(found));
    for (const kind of Object.keys(qin.INCOMING_REPORTS)) {
      const report = await qin.getIncomingReport(client, qm, kind);
      assert(Array.isArray(report.rows) && report.title, kind);
    }
    assert(Object.keys(qin.INCOMING_REPORTS).length === 15, "fifteen reports");
    await refused(async () => qin.getIncomingReport(client, qm, "nope"), "QUALITY_INCOMING_NOT_FOUND");
    const csv = await qin.exportIncomingReport(client, qm, "register");
    assert(csv.fileName === "incoming-register.csv" && csv.body.split("\n")[0].startsWith("inspection,receipt") && csv.body.includes(found[0].number), csv.body.slice(0, 200));
    await refused(async () => qin.exportIncomingReport(client, insp, "register"), "QUALITY_INCOMING_ACCESS_DENIED");
    const status = await qin.getIncomingInventoryStatus(client, rahul, inspectionId);
    assert(status.inventory.held === 9 && status.inventory.cleared === 0 && found[0].purchaseOrder?.number && found[0].unit === "NOS", JSON.stringify([status, found[0].purchaseOrder, found[0].unit]));
    assert((await qin.getIncomingInspection(client, rahul, inspectionId)).actions.start === false, "a buyer reads but doesn't act");
    await refused(async () => qin.startIncomingInspection(client, rahul, inspectionId, {}), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => qin.listIncomingInspections(client, anita, {}), "QUALITY_INCOMING_ACCESS_DENIED");
    await switchTo(other.organizationId);
    const outsider = await contextFor(other.userId, other.organizationId);
    await refused(async () => qin.getIncomingInspection(client, outsider, inspectionId), "QUALITY_INCOMING_NOT_FOUND");
    assert(!(await qin.listIncomingInspections(client, outsider, {})).some((x) => x.id === inspectionId), "another Company's list");
    await switchTo(organizationId);
  });
  }
} catch (error) {
  failures.push("setup");
  console.log("FATAL", error);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ": " + failures.join(" | ") : ""}`);
console.log("(transaction rolled back: the database is unchanged)");
process.exit(failures.length ? 1 : 0);
