// Quality MVP 32 (In-Process Inspection): in-process control points (first piece, each output, every N units) check reported production;
// the gates Manufacturing enforces (no accepted reporting, no more output on a run whose first piece waits, acceptance only up to Quality's
// clearance); 500 brackets → 430 accepted, 50 reworked and reinspected, 10 scrapped once by Manufacturing, 10 held; two required checks;
// missing standards; production corrections; critical failures and deviations; manual requests; permissions, reports and isolation.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:quality-inprocess     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
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
async function dbRejects(sql, values) {
  await client.query("SAVEPOINT db_refusal");
  try { await client.query(sql, values); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT db_refusal"); return error; }
  await client.query("RELEASE SAVEPOINT db_refusal");
  throw new Error("expected the database to refuse: " + sql);
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function rejects(work, code) {
  try { await work(); } catch (error) { if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  throw new Error(`expected rejection ${code ?? ""}`);
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const pos = await api("modules/point-of-sale/index.js");
  const stock = await api("modules/stock/index.js");

  const tag = Math.random().toString(16).slice(2, 10);
  const register = (name) => registerOrganization(client, {
    fullName: "Smoke Owner", email: `${name}-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `${name} ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const other = await register("otherregisters");
  const registered = await register("registers");
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
  const manager = await addMember("pos_manager", "Manoj Manager");
  const amit = await addMember("pos_cashier", "Amit Cashier");
  const priya = await addMember("pos_cashier", "Priya Cashier");
  const outsider = await addMember("pos_cashier", "Omar Outsider");
  const without = (context, ...keys) => ({ ...context, permissions: context.permissions.filter((key) => !keys.includes(key)) });

  // An active permission profile granting the chosen catalogue codes (every sensitive grant unlimited unless limits are given).
  const profileFor = async (code, pick = () => true, limits = {}) => {
    const made = await pos.createPermissionProfile(client, owner, { code, name: code, grants: pos.CASHIER_PERMISSION_CATALOGUE.map((item) => ({ code: item.code, enabled: pick(item.code),
      ...(limits[item.code] ? { limitMode: "limited", ...limits[item.code] } : { limitMode: item.limitRequired ? "unlimited" : "not_applicable" }) })) });
    return (await pos.activatePermissionProfile(client, owner, made.id)).id;
  };

  // The company: a Maharashtra registration, two warehouses with locations, a price list with the pump at 1,000, the pump in stock.
  const mh = (await client.query(`INSERT INTO tenant.tax_registrations (organization_id, code, name, legal_name, registration_number, state_code, state_name, is_default)
    VALUES ($1, 'MH', 'Maharashtra GST', 'Vercent Retail Pvt Ltd', '27AAACV1111A1Z1', '27', 'Maharashtra', true) RETURNING id`, [organizationId])).rows[0].id;
  const warehouse = async (code) => (await client.query(`INSERT INTO tenant.warehouses (organization_id, code, name) VALUES ($1, $2, $2) RETURNING id`, [organizationId, code])).rows[0].id;
  const pun = await warehouse("PUN-RETAIL");
  const mum = await warehouse("MUM-RETAIL");
  const location = async (warehouseId, code, extra = {}) => (await client.query(
    `INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, code, name, purpose, disposition, allow_allocation) VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING id`,
    [organizationId, warehouseId, code, extra.purpose ?? "storage", extra.disposition ?? "available", extra.disposition ? false : true])).rows[0].id;
  const shopFloor = await location(pun, "SHOP-FLOOR");
  const counter01 = await location(pun, "COUNTER-01");
  const qcHold = await location(pun, "QC-HOLD", { purpose: "quality_hold", disposition: "quality_hold" });
  const counterA = await location(mum, "COUNTER-A");
  const priceList = (await client.query(`INSERT INTO tenant.price_lists (organization_id, code, name, currency_code, price_list_type, status) VALUES ($1, 'PUN', 'Pune retail', 'INR', 'sales', 'active') RETURNING id`, [organizationId])).rows[0].id;
  const nos = (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, 'NOS', 'Numbers', 'quantity', 0)
    ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = 0 RETURNING id`, [organizationId])).rows[0].id;
  const gst18 = (await client.query(`SELECT id FROM tenant.tax_categories WHERE organization_id = $1 AND code = 'GST-18'`, [organizationId])).rows[0]?.id ?? null;
  const item = async (code) => (await client.query(
    `INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, purchase_uom_id, purchase_price, standard_cost, tax_category_id, track_inventory, hsn_sac_code, is_sellable)
     VALUES ($1, $2, $2, 'product', $3, $3, 600, 600, $4, true, '8413', true) RETURNING id`, [organizationId, code, nos, gst18])).rows[0].id;
  const pump = await item("PUMP-001");
  const valve = await item("VALVE-01");
  for (const itemId of [pump, valve])
    await client.query(`INSERT INTO tenant.price_list_items (organization_id, price_list_id, item_id, rate, uom_id) VALUES ($1, $2, $3, 1000, $4)`, [organizationId, priceList, itemId, nos]);
  const addStock = (itemId, warehouseId, locationId, quantity) => stock.postStockMovement(client, owner, {
    movementType: "adjustment", adjustmentDirection: "increase", itemId, warehouseId, warehouseLocationId: locationId, quantity: String(quantity), unitCost: "600", reason: "Smoke stock" });
  await addStock(pump, pun, counter01, 2);
  await addStock(pump, pun, qcHold, 5);
  const onHandAt = async (itemId, locationId) => Number((await client.query(`SELECT COALESCE(sum(quantity), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND warehouse_location_id = $3`,
    [organizationId, itemId, locationId])).rows[0].q);

  const address = { line1: "FC Road", city: "Pune", state: "Maharashtra", stateCode: "27", postalCode: "411004", countryCode: "IN" };
  const outlet = async (code, warehouseId, extra = {}) => {
    const made = await pos.createOutlet(client, manager, { code, name: `${code} store`, address, timezone: "Asia/Kolkata", warehouseId, taxRegistrationId: mh, priceListId: priceList, ...extra });
    await pos.configureOutletPaymentMethods(client, manager, made.id, [{ method: "cash", enabled: true }, { method: "card", enabled: true }, { method: "upi", enabled: true }]);
    return pos.setOutletStatus(client, manager, made.id, "active");
  };
  const pune = await outlet("PUN", pun, { sellingLocationId: shopFloor });
  const mumbai = await outlet("MUM", mum);
  const ravi = await addMember("pos_cashier", "Ravi Cashier");
  const buyer = await addMember("buyer", "Bina Buyer");
  const { setMemberStatus } = await api("core/organization/administration.js");
  const openSession = (context, terminalId, outletId, extra = {}) => pos.openShift(client, context, { openingCashConfirmed: true, openingCash: "0", storeId: outletId, terminalId, openingCash: 0, idempotencyKey: randomUUID(), ...extra });
  const closeSession = async (sessionId) => {
    await client.query(`UPDATE tenant.pos_shifts SET status = 'closed', closed_at = now(), counted_cash = expected_cash, cash_variance = 0 WHERE id = $1`, [sessionId]);
    await client.query(`UPDATE tenant.pos_cash_sessions SET status = 'closed', closed_at = now() WHERE status <> 'closed' AND id = (SELECT cash_session_id FROM tenant.pos_shifts WHERE id = $1)`, [sessionId]);
  };
  const sell = (context, session, quantity, extra = {}) => pos.completePointOfSale(client, context, {
    shiftId: session.id, lines: [{ itemId: extra.itemId ?? pump, quantity: String(quantity), unitPrice: "1000" }], payments: [{ method: "cash", amount: String(1180 * quantity) }],
    idempotencyKey: extra.idempotencyKey ?? randomUUID() });
  await pos.updatePosSettings(client, owner, { closing_variance_approval_above: null });
  const t01 = await pos.createTerminal(client, manager, { outletId: pune.id, code: "T01", name: "Counter 1" });
  const t02 = await pos.createTerminal(client, manager, { outletId: pune.id, code: "T02", name: "Counter 2" });
  const t03 = await pos.createTerminal(client, manager, { outletId: pune.id, code: "T03", name: "Counter 3" });
  await addStock(valve, pun, shopFloor, 200);
  const catalogue = pos.CASHIER_PERMISSION_CATALOGUE.map((item) => item.code);
  const routine = ["POS_ACCESS", "SESSION_OPEN_OWN", "SESSION_CLOSE_OWN", "SESSION_VIEW_OWN", "SALE_CREATE", "SALE_COMPLETE", "SALE_HOLD", "SALE_RESUME_OWN",
    "SALE_CANCEL_UNPAID", "CUSTOMER_SELECT", "RECEIPT_PRINT", "TRANSACTION_LOOKUP", "RETURN_WITH_RECEIPT"];
  const standardLimits = {
    DISCOUNT_LINE_MANUAL: { maxPercentage: "5", maxAmount: "500" }, DISCOUNT_ORDER_MANUAL: { maxPercentage: "3", maxAmount: "500" }, PRICE_OVERRIDE: { maxPercentage: "10" },
    REFUND_INITIATE: { maxAmount: "2000" }, CASH_MOVEMENT_IN: { maxAmount: "1000" }, CASH_MOVEMENT_OUT: { maxAmount: "1000" },
  };
  const supervisorLimits = {
    ...standardLimits, APPROVE_DISCOUNT_EXCEPTION: { maxPercentage: "20", maxAmount: "5000" }, APPROVE_PRICE_OVERRIDE: { maxPercentage: "30" },
    APPROVE_REFUND_EXCEPTION: { maxAmount: "10000" }, APPROVE_CASH_MOVEMENT_EXCEPTION: { maxAmount: "10000" },
  };
  const basicId = await profileFor("BASIC", (code) => routine.includes(code));
  const standardId = await profileFor("STANDARD", (code) => routine.includes(code) || Object.keys(standardLimits).includes(code), standardLimits);
  const supervisorId = await profileFor("SUPERVISOR", (code) => code !== "RETURN_WITHOUT_RECEIPT", supervisorLimits);
  const cashier = async (person, profileId, outlets = [pune.id]) => pos.createCashier(client, manager, { userId: person.userId, permissionProfileId: profileId, outletIds: outlets, activate: true });
  const amitC = await cashier(amit, standardId);
  const priyaC = await cashier(priya, supervisorId);
  const raviC = await cashier(ravi, basicId);
  const openAt = (context, terminalId) => pos.openShift(client, context, { openingCashConfirmed: true, openingCash: "0", storeId: pune.id, terminalId, openingCash: 5000, idempotencyKey: randomUUID() });
  const s1 = await openAt(amit, t01.id);
  const s2 = await openAt(priya, t02.id);
  const s3 = await openAt(ravi, t03.id);
  const newCart = async (context, session, terminalId) => pos.createPosCart(client, context, { storeId: pune.id, terminalId, shiftId: session.id });
  const addValve = (context, cart, quantity, extra = {}) => pos.addPosCartLine(client, context, cart.id, { itemId: valve, quantity, expectedVersion: cart.version, ...extra });
  const discountLine = (context, cart, percent, extra = {}) => pos.applyPosCartLineDiscount(client, context, cart.id, cart.lines[cart.lines.length - 1].id,
    { type: "percent", value: percent, reason: "Loyal customer", expectedVersion: cart.version, ...extra });
  const complete = (context, cart, key = randomUUID()) => pos.completePosCart(client, context, cart.id, { payments: [{ method: "cash", amount: String(cart.grand_total) }], idempotencyKey: key });
  const fresh = async (context, cartId) => pos.getPosCart(client, context, cartId);
  // ---- Product Search fixtures: categories, products of every kind, barcodes, units and stock at the Pune outlet's selling location.
  const group = async (code, name, parentId = null) => (await client.query(`INSERT INTO tenant.item_groups (organization_id, code, name, parent_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, code, name, parentId])).rows[0].id;
  const groceries = await group("GROC", "Groceries");
  const beverages = await group("BEV", "Beverages");
  const softDrinks = await group("SOFT", "Soft Drinks", beverages);
  const box = (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, 'BOX', 'Box', 'quantity', 0)
    ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = 0 RETURNING id`, [organizationId])).rows[0].id;
  const product = async (code, name, extra = {}) => (await client.query(
    `INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, purchase_uom_id, purchase_price, standard_cost, tax_category_id, track_inventory, hsn_sac_code, is_sellable,
       group_id, tracking_type, status, parent_item_id, is_variant_template, variant_attributes)
     VALUES ($1, $2, $3, $4, $5, $5, 10, 10, $6, $7, $15, $8, $9, $10, $11, $12, $13, $14::jsonb) RETURNING id`,
    [organizationId, code, name, extra.type ?? "product", nos, gst18, extra.tracked ?? (extra.type !== "service"), extra.sellable ?? true, extra.group ?? null, extra.tracking ?? "none",
      extra.status ?? "active", extra.parent ?? null, extra.template ?? false, JSON.stringify(extra.attributes ?? {}),
      extra.hsn ?? (extra.type === "service" ? "998599" : "1905")])).rows[0].id;
  const price = (itemId, rate, uomId = nos) => client.query(`INSERT INTO tenant.price_list_items (organization_id, price_list_id, item_id, rate, uom_id) VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, priceList, itemId, rate, uomId]);
  const barcode = (itemId, value, uomId = null, primary = false) => client.query(
    `INSERT INTO tenant.item_identifiers (organization_id, item_id, identifier_type, value, uom_id, is_primary) VALUES ($1, $2, 'barcode', $3, $4, $5)`, [organizationId, itemId, value, uomId, primary]);
  const milk = await product("MLK-001", "Amul Milk 1 L", { group: groceries });
  await price(milk, 65); await barcode(milk, "0089012345", null, true); await addStock(milk, pun, shopFloor, 30);
  const frother = await product("FRO-01", "Milk Frother MLK-001 edition", { group: groceries });
  await price(frother, 900); await addStock(frother, pun, shopFloor, 4);
  const bread = await product("BRD-001", "Bread 400 g", { group: groceries });
  await price(bread, 45); await addStock(bread, pun, shopFloor, 3);
  const cola = await product("COLA-500", "Cola 500 ml", { group: softDrinks });
  await price(cola, 40); await addStock(cola, pun, shopFloor, 100);
  const water = await product("WTR-001", "Water Bottle 1 L", { group: beverages });
  await price(water, 20); await addStock(water, pun, shopFloor, 30);
  await client.query(`INSERT INTO tenant.item_uom_conversions (organization_id, item_id, from_uom_id, to_uom_id, conversion_factor) VALUES ($1, $2, $3, $4, 12)`, [organizationId, water, box, nos]);
  await barcode(water, "8900000000012", box);
  const wrap = await product("SRV-WRAP", "Gift wrapping", { type: "service", tracked: false });
  await price(wrap, 30);
  const oldSoap = await product("SOP-OLD", "Old Soap 100 g", { group: groceries });
  await price(oldSoap, 38); await barcode(oldSoap, "7700001"); await addStock(oldSoap, pun, shopFloor, 10);
  await client.query(`UPDATE tenant.items SET status = 'inactive' WHERE id = $1`, [oldSoap]);
  const tape = await product("TAPE-INT", "Internal Tape", { sellable: false });
  await price(tape, 12); await addStock(tape, pun, shopFloor, 10);
  const juice = await product("JUICE-01", "Fresh Juice", { group: beverages });
  await addStock(juice, pun, shopFloor, 10);
  const ambA = await product("AMB-A", "Ambiguous Alpha");
  const ambB = await product("AMB-123", "Ambiguous Beta");
  await price(ambA, 10); await price(ambB, 10); await barcode(ambA, "AMB-123");
  const shirt = await product("TSH", "T-Shirt", { template: true, group: groceries });
  await barcode(shirt, "5550001");
  const shirtBlackM = await product("TSH-BLK-M", "T-Shirt Black M", { parent: shirt, attributes: { colour: "Black", size: "M" } });
  await price(shirtBlackM, 499); await addStock(shirtBlackM, pun, shopFloor, 5);
  const phone = await product("PHN-X", "Phone X", { tracking: "serial" });
  await price(phone, 20000);
  const rice = await product("RCE-005", "Rice 5 kg", { group: groceries });
  await price(rice, 420); await addStock(rice, mum, counterA, 100);
  const held = await product("HLD-01", "Held Widget");
  await price(held, 50); await addStock(held, pun, qcHold, 20);
  const reserved = await product("RSV-01", "Reserved Widget");
  await price(reserved, 50); await addStock(reserved, pun, shopFloor, 5);
  await client.query(`UPDATE tenant.stock_balances SET reserved_quantity = quantity WHERE organization_id = $1 AND item_id = $2`, [organizationId, reserved]);
  const at = { cartId: undefined };
  const search = (context, query, extra = {}) => pos.searchPosProducts(client, context, { query, ...extra });
  const scan = (context, value, extra = {}) => pos.lookupPosProductByBarcode(client, context, { barcode: value, ...extra });
  const add = (context, cart, itemId, extra = {}) => pos.addProductToPosCart(client, context, cart.id, { itemId, idempotencyKey: randomUUID(), ...extra });
  const linesOf = async (cartId) => (await client.query(`SELECT item_id, quantity::text, base_quantity::text, uom_id, uom_factor::text FROM tenant.pos_cart_lines WHERE cart_id = $1 ORDER BY line_number`,
    [cartId])).rows;
  const ids = (result) => result.products.map((p) => p.itemId);
  void at;
  // ---- Bill of Materials fixtures: an engineer who prepares recipes, a manager who approves them, a planner who uses them, procurement.
  const mfg = await api("modules/manufacturing/boms/index.js");
  const k = () => randomUUID();
  const n = (value) => Number(value);
  const engineer = await addMember("manufacturing_engineer", "Esha Engineer");
  const mfgManager = await addMember("manufacturing_manager", "Mohan Manager");
  const planner = await addMember("production_planner", "Pooja Planner");
  const purchaser = await addMember("buyer", "Bharat Buyer");
  const unit = async (code, category, places) => (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, $2, $2, $3, $4)
    ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = $4 RETURNING id`, [organizationId, code, category, places])).rows[0].id;
  const mtr = await unit("MTRX", "length", 2);
  const kgm = await unit("KGMX", "weight", 3);
  const part = async (code, name, extra = {}) => {
    const id = await product(code, name, extra);
    if (extra.uom) await client.query(`UPDATE tenant.items SET uom_id = $2, purchase_uom_id = $2 WHERE id = $1`, [id, extra.uom]);
    if (extra.cost !== undefined) await client.query(`UPDATE tenant.items SET standard_cost = $2 WHERE id = $1`, [id, extra.cost]);
    if (extra.salesPrice !== undefined) await client.query(`UPDATE tenant.items SET sales_price = $2 WHERE id = $1`, [id, extra.salesPrice]);
    return id;
  };
  const stockIn = (itemId, quantity, unitCost) => stock.postStockMovement(client, owner, { movementType: "adjustment", adjustmentDirection: "increase", itemId, warehouseId: pun,
    warehouseLocationId: shopFloor, quantity: String(quantity), unitCost: String(unitCost), reason: "BOM test stock" });
  const chair = await part("CHAIR-01", "Office Chair");
  const seat = await part("SEAT-ASM", "Seat Assembly");
  const cushion = await part("CUSH-01", "Seat Cushion");
  const frame = await part("FRAME-01", "Seat Frame", { cost: 0 });
  const screws = await part("SCREW-01", "Screws", { salesPrice: 999 });
  const wheels = await part("WHEEL-01", "Caster Wheel");
  const fabric = await part("FABRIC-01", "Fabric", { uom: mtr, cost: 0 });
  const glue = await part("GLUE-01", "Setup Glue", { cost: 0 });
  const consulting = await part("SVC-INSTALL", "Installation", { type: "service", tracked: false });
  await client.query(`INSERT INTO tenant.item_uom_conversions (organization_id, item_id, from_uom_id, to_uom_id, conversion_factor) VALUES ($1, $2, $3, $4, 12)`, [organizationId, screws, box, nos]);
  await stockIn(screws, 900, 2);
  await stockIn(wheels, 600, 50);
  await stockIn(cushion, 80, 300);
  await stockIn(seat, 50, 900);
  const line = (componentItemId, quantity, uomId = nos, extra = {}) => ({ componentItemId, quantity: String(quantity), uomId, ...extra });
  const movementCount = async () => Number((await client.query(`SELECT count(*) AS n FROM tenant.stock_movements WHERE organization_id = $1`, [organizationId])).rows[0].n);
  const reservationCount = async () => Number((await client.query(`SELECT count(*) AS n FROM tenant.stock_reservations WHERE organization_id = $1`, [organizationId])).rows[0].n);
  const journalCount = async () => Number((await client.query(`SELECT count(*) AS n FROM tenant.accounting_journal_entries WHERE organization_id = $1`, [organizationId])).rows[0].n);
  const approveAndActivate = async (revisionId, from = undefined) => {
    await mfg.submitBomRevision(client, engineer, revisionId);
    await mfg.approveBomRevision(client, mfgManager, revisionId, { note: "Checked on the line" });
    return mfg.activateBomRevision(client, mfgManager, revisionId, from ? { effectiveFrom: from } : {});
  };
  // ---- Production Quality Inspection: 20 office chairs inspected against a checklist; holds, review, sampling, corrections.
  const mo = await api("modules/manufacturing/orders/index.js");
  const mi = await api("modules/manufacturing/issues/index.js");
  const pp = await api("modules/manufacturing/production/index.js");
  const qi = await api("modules/manufacturing/quality/index.js");
  const storekeeper = await addMember("inventory_manager", "Sunil Storekeeper");
  const operator = await addMember("shop_floor_operator", "Omkar Operator");
  const inspector = await addMember("quality_manager", "Isha Inspector");
  const qaLead = await addMember("quality_manager", "Qasim QA Lead");
  const HOUR = 3_600_000;
  const atIn = (ms_) => new Date(Date.now() + ms_).toISOString();
  const seatBom = await mfg.createManufacturingBom(client, engineer, { finishedItemId: seat, outputQuantity: "1", lines: [line(cushion, 1), line(frame, 1), line(screws, 4)] });
  await approveAndActivate(seatBom.revision.id);
  const chairBom = await mfg.createManufacturingBom(client, engineer, { finishedItemId: chair, outputQuantity: "1", lines: [line(seat, 1), line(screws, 12), line(wheels, 5)] });
  await approveAndActivate(chairBom.revision.id);
  const release = async (orderId) => { await mo.submitManufacturingOrder(client, planner, orderId); return mo.approveManufacturingOrder(client, mfgManager, orderId); };
  const matOf = async (orderId, code) => (await mo.getManufacturingOrder(client, planner, orderId)).materials.find((row) => row.code === code);
  const entryOf = async (id) => (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE id = $1`, [id])).rows[0];
  const orderRow = async (id) => (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE id = $1`, [id])).rows[0];
  const setQi = async (fields) => client.query(`UPDATE tenant.manufacturing_settings SET ${Object.entries(fields).map(([key, value]) => `${key} = ${value}`).join(", ")} WHERE organization_id = $1`, [organizationId]);
  await mo.updateManufacturingSettings(client, mfgManager, { moRequireInspection: true });
  const order = await mo.createManufacturingOrder(client, planner, { finishedItemId: chair, plannedQuantity: "20", manufacturingWarehouseId: pun, materialWarehouseId: pun, finishedGoodsWarehouseId: mum,
    plannedStartAt: atIn(HOUR), plannedEndAt: atIn(48 * HOUR) });
  await release(order.id);
  await mi.postMaterialIssue(client, storekeeper, (await mi.createMaterialIssueDraft(client, storekeeper, { manufacturingOrderId: order.id, lines: [
    { materialId: (await matOf(order.id, "SEAT-ASM")).id, quantity: "20" }, { materialId: (await matOf(order.id, "SCREW-01")).id, quantity: "240" },
    { materialId: (await matOf(order.id, "WHEEL-01")).id, quantity: "100" }] })).id, {});
  await mo.startManufacturingProduction(client, mfgManager, order.id, {});
  const report = async (batchRef, quantity, by = operator) => {
    const batch = await pp.createProductionBatch(client, by, order.id, { batchReference: batchRef });
    return (await pp.postProductionEntry(client, by, (await pp.createProductionEntryDraft(client, by, order.id, { productionBatchId: batch.id, quantity: String(quantity) })).id, {})).entryId;
  };
  const e0 = await report("B00", 2);
  const e1 = await report("B01", 8);
  const e2 = await report("B02", 2, mfgManager);
  const e3 = await report("B03", 5);
  const e4 = await report("B04", 3);
  const CRITERIA = [{ name: "Finish", type: "PASS_FAIL" }, { name: "Seat height", type: "NUMERIC", unit: "mm", lower: "450", upper: "500" },
    { name: "Load test", type: "PASS_FAIL", critical: true }, { name: "Colour", type: "CHOICE", choices: ["Black", "Grey", "Red"], acceptedChoices: ["Black", "Grey"], required: false }];
  const passing = [{ key: "finish", value: "PASS" }, { key: "seat_height", value: "470" }, { key: "load_test", value: "PASS" }, { key: "colour", value: "Black" }];
  const draftOn = (entryId, quantity, extra = {}, by = inspector) => qi.createInspectionDraft(client, by, { manufacturingOrderId: order.id, productionEntryId: entryId, quantity: String(quantity), ...extra });
  let checklist;
  let d1;
  let reinspection;

  // ---- Quality — In-Process Inspection (MVP 32): metal brackets drilled on Manufacturing Orders; in-process control points check the reported
  // output; Quality's disposition decides exact quantities; Manufacturing accepts only what Quality cleared and records the scrap.
  const qs = await api("modules/quality/specifications/index.js");
  const qcp = await api("modules/quality/control-points/index.js");
  const qin = await api("modules/quality/incoming/index.js");
  const ipq = await api("modules/quality/inprocess/index.js");
  const qm = qaLead;
  const qm2 = inspector;
  const sup = await addMember("quality_supervisor", "Zoya Supervisor");
  const ins = await addMember("quality_inspector", "Yusuf Inspector");
  const prodSup = await addMember("production_supervisor", "Xavier Supervisor");
  const buyerOnly = await addMember("buyer", "Wanda Buyer");
  const scrapper = { ...qm, permissions: [...qm.permissions, "manufacturing.qi.finalize"] };
  const mmx = await unit("MMX", "length", 2);
  void mmx;
  await mo.updateManufacturingSettings(client, mfgManager, { moRequireInspection: false });
  const refused = async (work, code) => {
    await client.query("SAVEPOINT refused");
    try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
    await client.query("RELEASE SAVEPOINT refused");
    throw new Error(`expected rejection ${code}`);
  };
  let seq = 0;
  const blank = await part("BLANK-01", "Steel Blank");
  await stockIn(blank, 20000, 10);
  // A product drilled from a steel blank, with its BOM in force.
  const newProduct = async (label) => {
    const id = await part(`BRK${++seq}`, label);
    const bom = await mfg.createManufacturingBom(client, engineer, { finishedItemId: id, outputQuantity: "1", lines: [line(blank, 1)] });
    await approveAndActivate(bom.revision.id);
    return id;
  };
  const CHECKS = [
    { code: "HOLE", name: "Hole diameter", checkType: "NUMERIC_RANGE", lowerLimit: "9.90", upperLimit: "10.10", unitCode: "MMX", criticality: "MAJOR", instructions: "Measure with the bore gauge" },
    { code: "POS", name: "Hole position", checkType: "VISUAL", acceptanceText: "Within the drawing limits", criticality: "MAJOR" },
    { code: "CRACK", name: "Free of cracks", checkType: "BOOLEAN", expectedBoolean: true, criticality: "CRITICAL", instructions: "Inspect under the lamp" },
  ];
  const specFor = async (itemId, extra = {}) => {
    const made = await qs.createInspectionSpecification(client, sup, { name: "Bracket drilling check", description: "After drilling", stage: "IN_PROCESS", itemId, samplingMethod: "FIXED_COUNT",
      sampleValue: "5", checks: CHECKS, ...extra });
    await qs.submitSpecificationForReview(client, sup, made.specificationId, made.versionId);
    await qs.approveSpecificationVersion(client, qm, made.specificationId, made.versionId, { publish: true });
    return made;
  };
  const pointFor = async (itemId, specificationId, extra = {}) => {
    const made = await qcp.createQualityControlPoint(client, qm2, { name: "Drilling check", description: "Check drilled output before bending", triggerEvent: "PRODUCTION_OPERATION_READY_FOR_QC",
      requirementType: "MANDATORY", gateType: "BLOCK_PRODUCTION_PROGRESS", specBinding: "FAMILY", specificationId, checkpointType: "OPERATION_COMPLETION", operationLabel: "Drilling (Op 20)",
      rules: [{ scope: "ITEM", itemId }], ...extra });
    await qcp.submitQualityControlPoint(client, qm2, made.controlPointId, made.versionId);
    await qcp.approveQualityControlPointVersion(client, qm, made.controlPointId, made.versionId, { publish: true });
    return made;
  };
  // A released, started order with its material issued.
  const newOrder = async (itemId, quantity) => {
    const made = await mo.createManufacturingOrder(client, planner, { finishedItemId: itemId, plannedQuantity: String(quantity), manufacturingWarehouseId: pun, materialWarehouseId: pun,
      finishedGoodsWarehouseId: mum, plannedStartAt: atIn(HOUR), plannedEndAt: atIn(48 * HOUR) });
    await release(made.id);
    await mi.postMaterialIssue(client, storekeeper, (await mi.createMaterialIssueDraft(client, storekeeper, { manufacturingOrderId: made.id, lines: [
      { materialId: (await matOf(made.id, "BLANK-01")).id, quantity: String(quantity) }] })).id, {});
    await mo.startManufacturingProduction(client, mfgManager, made.id, {});
    return made;
  };
  const batches = new Map();
  const runOf = async (orderId, ref) => {
    const key = `${orderId}:${ref}`;
    if (!batches.has(key)) batches.set(key, await pp.createProductionBatch(client, operator, orderId, { batchReference: ref }));
    return batches.get(key);
  };
  // Output reported awaiting inspection (or accepted at once with extra.acceptedQuantity).
  const produce = async (orderId, ref, quantity, extra = {}) => {
    const batch = await runOf(orderId, ref);
    const draft = await pp.createProductionEntryDraft(client, operator, orderId, { productionBatchId: batch.id, quantity: String(quantity), pendingQuantity: String(quantity), ...extra });
    const posted = await pp.postProductionEntry(client, operator, draft.id, {});
    return { entryId: draft.id, ...posted };
  };
  const inspectionsOf = async (entryId) => (await client.query(`SELECT i.* FROM tenant.quality_inspections i JOIN tenant.quality_inprocess_contexts x ON x.inspection_id = i.id
    WHERE x.production_entry_id = $1 AND i.reinspection_of_id IS NULL ORDER BY i.created_at`, [entryId])).rows;
  const detail = (id, ctx = qm) => qin.getIncomingInspection(client, ctx, id);
  const BAD = { HOLE: { value: "10.14" }, POS: { judgement: "FAIL" }, CRACK: { value: false } };
  const inspect = async (id, fail = []) => {
    await qin.startIncomingInspection(client, ins, id, {});
    const d = await detail(id);
    const code = (cid) => d.characteristics.find((x) => x.id === cid).code;
    const results = d.samples.flatMap((s) => d.characteristics.map((ch) => {
      const base = { sampleId: s.id, characteristicId: ch.id, ...(ch.code === "HOLE" ? { value: "10.02" } : ch.code === "POS" ? { judgement: "PASS" } : { value: true }) };
      return s.id === d.samples[0].id && fail.includes(code(ch.id)) ? { ...base, ...BAD[code(ch.id)] } : base;
    }));
    await qin.recordIncomingResults(client, ins, id, { results });
    const sent = await qin.submitIncomingInspection(client, ins, id, {});
    if (sent.status === "AWAITING_REVIEW") await qin.reviewIncomingInspection(client, qm2, id, { decision: "APPROVE", note: "Checked" });
    return detail(id);
  };
  const dispose = (ctx, id, input) => qin.authorizeQualityDisposition(client, ctx, id, { reason: "Decided on the evidence", ...input });
  // Manufacturing's final acceptance of an entry's output (the quality decision of the order).
  let decisionKey = 0;
  const accept = (orderId, entryId, quantity) => mo.decideManufacturingQuality(client, mfgManager, orderId, { entryId, acceptedQuantity: String(quantity), idempotencyKey: `acc-${tag}-${++decisionKey}` });
  const entryRow = async (id) => (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE id = $1`, [id])).rows[0];
  const brackets = await newProduct("Metal Bracket");
  const bracketSpec = await specFor(brackets);
  await pointFor(brackets, bracketSpec.specificationId);

  await check("IP1. An in-process control point reacts to reported production: the trigger is connected, it says when production is checked (first piece, each output, every N units — N required) and which operation; approved settings are fixed", async () => {
    const item = await newProduct("Checkpoint bracket");
    const spec = await specFor(item);
    const made = await qcp.createQualityControlPoint(client, qm2, { name: "Every 100", description: "Periodic", triggerEvent: "PRODUCTION_OPERATION_READY_FOR_QC", requirementType: "MANDATORY",
      gateType: "BLOCK_PRODUCTION_PROGRESS", specBinding: "FAMILY", specificationId: spec.specificationId, checkpointType: "PERIODIC", rules: [{ scope: "ITEM", itemId: item }] });
    await refused(async () => qcp.submitQualityControlPoint(client, qm2, made.controlPointId, made.versionId));
    await refused(async () => qcp.createQualityControlPoint(client, qm2, { name: "Bad", description: "x", triggerEvent: "PRODUCTION_OPERATION_READY_FOR_QC", specBinding: "FAMILY",
      specificationId: spec.specificationId, checkpointType: "PERIODIC", checkpointInterval: "-5", rules: [{ scope: "ITEM", itemId: item }] }), "QUALITY_QCP_INVALID");
    const ok = await pointFor(item, spec.specificationId, { checkpointType: "PERIODIC", checkpointInterval: "100", operationLabel: "Bending" });
    const d = await qcp.getQualityControlPoint(client, qm, ok.controlPointId);
    assert(d.selected.checkpoint === "PERIODIC" && d.selected.checkpointInterval === 100 && d.selected.operationLabel === "Bending" && d.selected.triggerEnabled, JSON.stringify(d.selected));
    const err = await refused(async () => client.query(`UPDATE tenant.quality_control_point_versions SET checkpoint_interval = 5 WHERE id = $1`, [ok.versionId]));
    assert(/IMMUTABLE/.test(err.message), err.message);
  });

  await check("IP2. Reported output creates one requirement and one in-process inspection bound to the order, the run, the entry, the operation and the frozen versions; output can't be reported as accepted while the check applies; a replayed posting creates nothing more", async () => {
    const order = await newOrder(brackets, 1000);
    await refused(async () => produce(order.id, "R0", 10, { acceptedQuantity: "10", pendingQuantity: "0" }), "QUALITY_IPQC_GATE_ACTIVE");
    const out = await produce(order.id, "R1", 500);
    const [i] = await inspectionsOf(out.entryId);
    assert(i && i.inspection_type === "in_process" && Number(i.lot_quantity) === 500 && i.spec_version_id && i.qcp_version_id && i.obligation_id, JSON.stringify(i));
    const d = await detail(i.id);
    assert(d.production?.order === order.moNumber || d.production?.order, JSON.stringify(d.production));
    assert(d.production.operation === "Drilling (Op 20)" && d.production.checkpoint === "OPERATION_COMPLETION" && d.production.run === "R1" && d.productionStatus.gate.blocking && d.productionStatus.entry.reported === 500,
      JSON.stringify([d.production, d.productionStatus]));
    const again = await pp.postProductionEntry(client, operator, out.entryId, {});
    assert(again.replayed && (await inspectionsOf(out.entryId)).length === 1, "replayed posting");
    assert(out.inProcessInspections.length === 1, JSON.stringify(out));
  });

  let doneOrder;
  let doneEntry;
  let doneInspection;
  await check("IP3. The definition of done: 500 drilled, several defects; completing the inspection clears nothing; Quality authorizes 430 to go on, 50 to rework, 10 to scrap and 10 held — Manufacturing accepts only the 430, records the scrap once, and the held 10 stay restricted", async () => {
    doneOrder = await newOrder(brackets, 500);
    const out = await produce(doneOrder.id, "D1", 500);
    doneEntry = out.entryId;
    const [i] = await inspectionsOf(doneEntry);
    doneInspection = i.id;
    await refused(async () => accept(doneOrder.id, doneEntry, 1), "QUALITY_IPQC_GATE_ACTIVE");
    const d = await inspect(i.id, ["HOLE"]);
    assert(d.status === "COMPLETED" && d.proposed === "FAIL", JSON.stringify([d.status, d.proposed]));
    await refused(async () => accept(doneOrder.id, doneEntry, 1), "QUALITY_IPQC_GATE_ACTIVE");
    await refused(async () => dispose(qm, i.id, { decision: "RETURN_TO_SUPPLIER" }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(async () => dispose(qm, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "430", reworkQuantity: "50" }), "QUALITY_INCOMING_REASON_REQUIRED");
    const key = `ipq-${tag}`;
    const decided = await dispose(scrapper, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "430", reworkQuantity: "50", rejectQuantity: "10", rejectRoute: "SCRAP",
      reworkInstruction: "Re-drill oversize holes to 10.00", reason: "Segregated after the bore check", idempotencyKey: key });
    const replay = await dispose(scrapper, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "430", reworkQuantity: "50", rejectQuantity: "10", rejectRoute: "SCRAP",
      reworkInstruction: "Re-drill oversize holes to 10.00", reason: "Segregated after the bore check", idempotencyKey: key });
    assert(replay.replayed && decided.effects.manufacturingDecisionId && decided.reinspectionId, JSON.stringify([decided, replay]));
    const entry = await entryRow(doneEntry);
    assert(Number(entry.pending_remaining) === 490, `scrap recorded once: ${entry.pending_remaining}`);
    const scraps = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_quality_decisions WHERE production_entry_id = $1 AND disposition = 'SCRAP'`, [doneEntry])).rows[0].n;
    assert(scraps === 1, `one scrap decision: ${scraps}`);
    const after = await detail(i.id);
    assert(after.totals.accept === 430 && after.totals.rework === 10 * 5 && after.totals.reject === 10 && after.totals.undecided === 10 && after.productionStatus.gate.cleared === 430,
      JSON.stringify([after.totals, after.productionStatus.gate]));
    await refused(async () => accept(doneOrder.id, doneEntry, 431), "QUALITY_IPQC_GATE_ACTIVE");
    await accept(doneOrder.id, doneEntry, 430);
    await refused(async () => accept(doneOrder.id, doneEntry, 1), "QUALITY_IPQC_GATE_ACTIVE");
    await dispose(qm, i.id, { decision: "HOLD_FOR_REVIEW", reason: "Ten with burrs await the engineer" });
    const held = await detail(i.id);
    assert(held.totals.undecided === 10 && held.dispositions.length === 2, JSON.stringify(held.totals));
  });

  await check("IP4. Rework: the 50 stay restricted; their reinspection waits until production confirms the rework (not Quality), then clears them; the original failed readings stay on the original inspection", async () => {
    const original = await detail(doneInspection);
    const failedBefore = original.observations.filter((o) => o.outcome === "FAIL").map((o) => o.id).sort().join();
    const reworkId = original.reinspections[0].id;
    const r = await detail(reworkId);
    assert(r.production.checkpoint === "REWORK" && r.production.reworkPending && r.quantity === 50 && r.reinspectionOf.id === doneInspection, JSON.stringify(r.production));
    await refused(async () => qin.startIncomingInspection(client, ins, reworkId, {}), "QUALITY_IPQC_REWORK_PENDING");
    await refused(async () => ipq.confirmInProcessRework(client, ins, reworkId, { reference: "RW-1" }), "QUALITY_IPQC_PERMISSION_DENIED");
    await refused(async () => ipq.confirmInProcessRework(client, operator, reworkId, {}), "QUALITY_INCOMING_REASON_REQUIRED");
    await ipq.confirmInProcessRework(client, operator, reworkId, { reference: "Rework order RW-001: holes re-drilled" });
    await inspect(reworkId, []);
    await dispose(qm, reworkId, { decision: "ACCEPT", reason: "Re-drilled holes within limits" });
    const after = await detail(doneInspection);
    assert(after.productionStatus.gate.cleared === 480 && after.observations.filter((o) => o.outcome === "FAIL").map((o) => o.id).sort().join() === failedBefore, JSON.stringify(after.productionStatus.gate));
    await accept(doneOrder.id, doneEntry, 50);
    await refused(async () => accept(doneOrder.id, doneEntry, 1), "QUALITY_IPQC_GATE_ACTIVE");
    const o = await orderRow(doneOrder.id);
    assert(Number(o.accepted_quantity) === 480 && Number(o.rejected_quantity) === 10 && Number(o.reported_quantity) === 500, JSON.stringify([o.accepted_quantity, o.rejected_quantity]));
  });

  await check("IP5. First piece: the first output of each run is checked; the run takes no more output until Quality clears it; another run has its own first piece", async () => {
    const item = await newProduct("First-piece bracket");
    const spec = await specFor(item);
    await pointFor(item, spec.specificationId, { checkpointType: "FIRST_PIECE", operationLabel: "Setup" });
    const order = await newOrder(item, 100);
    const first = await produce(order.id, "S1", 2);
    const [fp] = await inspectionsOf(first.entryId);
    assert(fp && (await detail(fp.id)).production.checkpoint === "FIRST_PIECE", "first piece inspection");
    await refused(async () => produce(order.id, "S1", 10), "QUALITY_IPQC_GATE_ACTIVE");
    const other = await produce(order.id, "S2", 2);
    assert((await inspectionsOf(other.entryId)).length === 1, "the second run's first piece");
    await inspect(fp.id, []);
    await dispose(qm, fp.id, { decision: "ACCEPT", reason: "First piece within drawing" });
    const more = await produce(order.id, "S1", 10);
    assert((await inspectionsOf(more.entryId)).length === 0, "later output of a cleared run needs no first piece");
  });

  await check("IP6. Periodic checkpoints: every 100 units of the order's output triggers once at its threshold (60 → 120 crosses 100, 210 crosses 200), never twice; an advisory point never blocks", async () => {
    const item = await newProduct("Periodic bracket");
    const spec = await specFor(item);
    await pointFor(item, spec.specificationId, { checkpointType: "PERIODIC", checkpointInterval: "100", requirementType: "ADVISORY", gateType: "NONE" });
    const order = await newOrder(item, 300);
    const a = await produce(order.id, "P1", 60);
    const b = await produce(order.id, "P1", 60);
    const cc = await produce(order.id, "P1", 90);
    const counts = [(await inspectionsOf(a.entryId)).length, (await inspectionsOf(b.entryId)).length, (await inspectionsOf(cc.entryId)).length];
    assert(counts.join() === "0,1,1", counts.join());
    const points = (await client.query(`SELECT checkpoint_sequence, threshold_quantity FROM tenant.quality_inprocess_checkpoints WHERE manufacturing_order_id = $1 ORDER BY checkpoint_sequence`, [order.id])).rows;
    assert(points.map((p) => `${p.checkpoint_sequence}@${Number(p.threshold_quantity)}`).join() === "1@100,2@200", JSON.stringify(points));
    await accept(order.id, b.entryId, 60);
  });

  await check("IP7. Two required checks on the same output both have to clear; a missing specification is a visible exception that clears nothing", async () => {
    const item = await newProduct("Double-checked bracket");
    const spec = await specFor(item);
    await pointFor(item, spec.specificationId);
    const extraSpec = await specFor(item, { name: "Surface check" });
    await pointFor(item, extraSpec.specificationId, { name: "Surface", matchMode: "ADDITIONAL_REQUIRED_CHECK", purposeCode: "SURFACE" });
    const order = await newOrder(item, 100);
    const out = await produce(order.id, "T1", 40);
    const found = await inspectionsOf(out.entryId);
    assert(found.length === 2, `two inspections: ${found.length}`);
    await inspect(found[0].id, []);
    await dispose(qm, found[0].id, { decision: "ACCEPT", reason: "Drilling fine" });
    await refused(async () => accept(order.id, out.entryId, 1), "QUALITY_IPQC_GATE_ACTIVE");
    await inspect(found[1].id, []);
    await dispose(qm, found[1].id, { decision: "ACCEPT", reason: "Surface fine" });
    await accept(order.id, out.entryId, 40);
    const bare = await newProduct("Unspecified bracket");
    const lone = await specFor(bare);
    await pointFor(bare, lone.specificationId);
    await qs.retireInspectionSpecification(client, qm, lone.specificationId, { reason: "Withdrawn" });
    const bareOrder = await newOrder(bare, 50);
    const missing = await produce(bareOrder.id, "M1", 20);
    assert((await inspectionsOf(missing.entryId)).length === 0, "no inspection without a specification");
    await refused(async () => accept(bareOrder.id, missing.entryId, 1), "QUALITY_IPQC_GATE_ACTIVE");
    const exceptions = await ipq.listInProcessExceptions(client, qm);
    assert(exceptions.some((x) => x.kind === "SPEC_MISSING"), JSON.stringify(exceptions));
  });

  await check("IP8. Production corrections: output corrected away shrinks its requirement; a correction below what Quality already decided is refused", async () => {
    const order = await newOrder(brackets, 200);
    const out = await produce(order.id, "C1", 100);
    const [i] = await inspectionsOf(out.entryId);
    await pp.correctProductionEntry(client, mfgManager, out.entryId, { kind: "PENDING", quantity: "20", reason: "Twenty were double counted", idempotencyKey: `cor-${tag}-1` });
    const ob = (await client.query(`SELECT controlled_quantity FROM tenant.quality_inspection_obligations WHERE id = $1`, [i.obligation_id])).rows[0];
    assert(Number(ob.controlled_quantity) === 80 && Number((await detail(i.id)).quantity) === 80, JSON.stringify(ob));
    await inspect(i.id, ["POS"]);
    await dispose(qm, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "70", rejectQuantity: "5" });
    await refused(async () => pp.correctProductionEntry(client, mfgManager, out.entryId, { kind: "PENDING", quantity: "10", reason: "Another miscount", idempotencyKey: `cor-${tag}-2` }), "QUALITY_IPQC_QUANTITY_MISMATCH");
  });

  await check("IP9. A critical failure is not accepted without the waive permission; an approved deviation is shown as accepted under deviation, never as passed", async () => {
    const order = await newOrder(brackets, 100);
    const out = await produce(order.id, "K1", 30);
    const [i] = await inspectionsOf(out.entryId);
    const d = await inspect(i.id, ["CRACK"]);
    assert(d.criticalFailure && d.proposed === "FAIL", JSON.stringify(d.evaluation));
    await refused(async () => dispose(without(qm, "quality.disposition.waive"), i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "29", rejectQuantity: "1" }), "QUALITY_INCOMING_CRITICAL_FAILURE");
    await dispose(qm, i.id, { decision: "CONDITIONAL_ACCEPT", conditionalQuantity: "29", conditions: "Internal fixtures only, not shipped", reason: "Hairline mark on one sample, load tested" });
    const root = (await client.query(`SELECT status FROM tenant.quality_inspections WHERE id = $1`, [i.id])).rows[0];
    assert(root.status === "conditionally_accepted", root.status);
    await accept(order.id, out.entryId, 29);
  });

  await check("IP10. A manual request: by production or Quality with a reason, for exact reported output, once per request, under the specification in force — it does not restrict production by itself", async () => {
    const order = await newOrder(brackets, 100);
    const plain = await newProduct("Unchecked bracket");
    const plainSpec = await specFor(plain);
    void plainSpec;
    const plainOrder = await newOrder(plain, 50);
    const out = await produce(plainOrder.id, "N1", 20);
    assert((await inspectionsOf(out.entryId)).length === 0, "no control point, no automatic inspection");
    await refused(async () => ipq.requestInProcessInspection(client, buyerOnly, { productionEntryId: out.entryId, reason: "x" }), "QUALITY_INCOMING_ACCESS_DENIED");
    await refused(async () => ipq.requestInProcessInspection(client, operator, { productionEntryId: out.entryId, quantity: "25", reason: "Suspected tool wear" }), "QUALITY_IPQC_WIP_INVALID");
    const made = await ipq.requestInProcessInspection(client, operator, { productionEntryId: out.entryId, quantity: "10", reason: "Suspected tool wear", operationLabel: "Drilling", idempotencyKey: `man-${tag}` });
    const again = await ipq.requestInProcessInspection(client, operator, { productionEntryId: out.entryId, quantity: "10", reason: "Suspected tool wear", idempotencyKey: `man-${tag}` });
    assert(again.replayed && again.id === made.id, JSON.stringify(again));
    const d = await detail(made.id);
    assert(d.production.checkpoint === "MANUAL" && d.quantity === 10 && d.history.some((h) => h.label === "Requested by hand"), JSON.stringify(d.production));
    await accept(plainOrder.id, out.entryId, 20);
    void order;
  });

  await check("IP11. Permissions and isolation: in-process work needs the in-process keys; production sees the queue but doesn't inspect; incoming and in-process queues don't mix; another Company sees nothing", async () => {
    const [i] = await inspectionsOf(doneEntry);
    await refused(async () => qin.getIncomingInspection(client, buyerOnly, i.id), "QUALITY_INCOMING_ACCESS_DENIED");
    const seen = await qin.getIncomingInspection(client, prodSup, i.id);
    assert(seen.actions.start === false && seen.actions.decide === false, JSON.stringify(seen.actions));
    const ipList = await qin.listIncomingInspections(client, qm, { type: "in_process" });
    const inList = await qin.listIncomingInspections(client, qm, {});
    assert(ipList.some((r) => r.id === i.id) && !inList.some((r) => r.id === i.id), "queues do not mix");
    await refused(async () => qin.listIncomingInspections(client, buyerOnly, { type: "in_process" }), "QUALITY_INCOMING_ACCESS_DENIED");
    await switchTo(other.organizationId);
    const outsider = await contextFor(other.userId, other.organizationId);
    await refused(async () => qin.getIncomingInspection(client, outsider, i.id), "QUALITY_INCOMING_NOT_FOUND");
    await switchTo(organizationId);
  });

  await check("IP12. Dashboard, exceptions, the fifteen reports and the export count from the records: blocked production, WIP on hold, rework and scrap", async () => {
    const board = await ipq.getInProcessDashboard(client, qm);
    assert(board.blockedOperations >= 1 && board.wipOnHold >= 10 && typeof board.reworkRequired === "number" && board.pendingByOrder.length >= 1, JSON.stringify({ ...board, blocked: board.blocked.length }));
    for (const kind of Object.keys(ipq.INPROCESS_REPORTS)) {
      const r = await ipq.getInProcessReport(client, qm, kind);
      assert(Array.isArray(r.rows) && r.title, kind);
    }
    assert(Object.keys(ipq.INPROCESS_REPORTS).length === 15, "fifteen reports");
    const scrap = await ipq.getInProcessReport(client, qm, "scrap");
    assert(scrap.rows.some((r) => Number(r.scrap_quantity) === 10 && r.manufacturing === "Recorded by Manufacturing"), JSON.stringify(scrap.rows));
    const rework = await ipq.getInProcessReport(client, qm, "rework");
    assert(rework.rows.some((r) => Number(r.rework_quantity) === 50 && /RW-001/.test(r.rework_reference ?? "")), JSON.stringify(rework.rows));
    const csv = await ipq.exportInProcessReport(client, qm, "register");
    assert(csv.body.startsWith("inspection,production_order"), csv.body.slice(0, 120));
    await refused(async () => ipq.exportInProcessReport(client, ins, "register"), "QUALITY_INCOMING_ACCESS_DENIED");
    const counts = await qin.getIncomingCounts(client, qm, { type: "in_process" });
    assert(typeof counts.awaiting === "number" && counts.exceptions >= 1, JSON.stringify(counts));
    const options = await ipq.listInProcessOptions(client, qm);
    assert(options.entries.length >= 1 && options.reports.length === 15, "options");
  });
} catch (error) {
  failures.push("setup");
  console.log("SETUP FAILED", error);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ": " + failures.join(" | ") : ""} (transaction rolled back: the database is unchanged)`);
process.exit(failures.length ? 1 : 0);
