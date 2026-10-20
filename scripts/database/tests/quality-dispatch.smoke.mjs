// Quality MVP 34 (Inspection Linked to Delivery): a pre-dispatch control point checks each delivery line before it leaves; 100 units picked
// -> 80 cleared and dispatched, 15 rejected onto an Inventory quality hold (no other delivery takes them), 5 reinspected; the line follows the
// delivery while undecided and can't outgrow what was inspected; cancelling ends the undecided checks; a missing standard fails closed;
// deviations, refused routes, manual requests, permissions, separate queues, company isolation, dashboard, the ten reports and the export.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:quality-dispatch     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
// A refusal inside the single transaction: rolled back to a savepoint so the transaction goes on.
async function refused(work, code) {
  await client.query("SAVEPOINT refused");
  try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  await client.query("RELEASE SAVEPOINT refused");
  throw new Error(`expected rejection ${code ?? ""}`);
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const tag = Math.random().toString(16).slice(2, 10);
  const register = (name) => registerOrganization(client, {
    fullName: "Smoke Owner", email: `${name}-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `${name} ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const other = await register("otherdispatch");
  const registered = await register("dispatch");
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
  const qm = await addMember("quality_manager", "Rita Manager");
  const qm2 = await addMember("quality_manager", "Ivy Reviewer");
  const sup = await addMember("quality_supervisor", "Zoya Supervisor");
  const ins = await addMember("quality_inspector", "Yusuf Inspector");
  const meera = await addMember("sales_manager", "Meera Sales");
  const store = await addMember("inventory_manager", "Sunil Storekeeper");
  const wh = await addMember("warehouse_operator", "Wasim Warehouse");

  const sales = await api("modules/sales/index.js");
  const customers = await api("modules/sales/customers/index.js");
  const stock = await api("modules/stock/index.js");
  const qs = await api("modules/quality/specifications/index.js");
  const qcp = await api("modules/quality/control-points/index.js");
  const qin = await api("modules/quality/incoming/index.js");
  const pd = await api("modules/quality/dispatch/index.js");
  const holds = await api("modules/stock/quality-holds.js");

  // The company: a Maharashtra registration, a warehouse, a price list, net-30 terms, a customer with an address.
  await client.query(`INSERT INTO tenant.tax_registrations (organization_id, code, name, registration_number, state_code, state_name, is_default) VALUES ($1, 'MH', 'Maharashtra', '27AAACV1111A1Z1', '27', 'Maharashtra', true)`, [organizationId]);
  const gst18 = (await client.query(`SELECT id FROM tenant.tax_categories WHERE organization_id = $1 AND code = 'GST-18'`, [organizationId])).rows[0].id;
  const net30 = (await client.query(`INSERT INTO tenant.payment_terms (organization_id, code, name, default_due_days) VALUES ($1, 'NET30', 'Net 30', 30) RETURNING id`, [organizationId])).rows[0].id;
  await client.query(`INSERT INTO tenant.sales_settings (organization_id, default_payment_term_id) VALUES ($1, $2) ON CONFLICT (organization_id) DO UPDATE SET default_payment_term_id = $2`, [organizationId, net30]);
  const mum = (await client.query(`INSERT INTO tenant.warehouses (organization_id, code, name) VALUES ($1, 'MUM', 'Mumbai') RETURNING id`, [organizationId])).rows[0].id;
  const nos = (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, 'NOS', 'Numbers', 'quantity', 0)
    ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = 0 RETURNING id`, [organizationId])).rows[0].id;
  const std = (await client.query(`INSERT INTO tenant.price_lists (organization_id, code, name, price_list_type, currency_code, tax_inclusive, is_default) VALUES ($1, 'STD', 'Standard', 'sales', 'INR', false, true) RETURNING id`, [organizationId])).rows[0].id;
  let seq = 0;
  const product = async (name, onHand) => {
    const id = (await client.query(`INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, sales_price, standard_cost, tax_category_id, track_inventory, hsn_sac_code)
      VALUES ($1, $2, $3, 'product', $4, 100, 50, $5, true, '8539') RETURNING id`, [organizationId, `LMP${++seq}`, name, nos, gst18])).rows[0].id;
    await client.query(`INSERT INTO tenant.price_list_items (organization_id, price_list_id, item_id, uom_id, minimum_quantity, rate) VALUES ($1, $2, $3, $4, 1, 100)`, [organizationId, std, id, nos]);
    if (onHand) await stock.postStockMovement(client, owner, { movementType: "receipt", itemId: id, warehouseId: mum, quantity: onHand, unitCost: 50, idempotencyKey: `seed:${id}` });
    return id;
  };
  const billing = { line1: "12 Kalbadevi Road", city: "Mumbai", state: "Maharashtra", postalCode: "400002", countryCode: "IN" };
  const lumen = await customers.createCustomer(client, owner, { displayName: "Lumen Retail", customerKind: "business", countryCode: "IN", currencyCode: "INR", billingAddress: billing,
    primaryContact: { firstName: "Asha", lastName: "Rao", email: "asha@lumen.example" } });

  // A confirmed order of `quantity` of one item and its draft delivery.
  let keyNo = 0;
  const orderAndDelivery = async (itemId, quantity) => {
    const so = await sales.createSalesOrder(client, owner, { partyId: lumen.id, defaultWarehouseId: mum, lines: [{ itemId, quantity }] });
    await sales.confirmSalesOrder(client, meera, so.id);
    const made = await sales.createDeliveryFromSalesOrder(client, owner, so.id, { idempotencyKey: `dl-${tag}-${++keyNo}` });
    const lineId = (await client.query(`SELECT sales_order_line_id AS id FROM tenant.sales_delivery_lines WHERE delivery_id = $1 LIMIT 1`, [made.deliveryId])).rows[0].id;
    return { orderId: so.id, deliveryId: made.deliveryId, orderLineId: lineId };
  };
  const dispatch = (deliveryId) => sales.dispatchDelivery(client, wh, deliveryId, {});
  const ready = (deliveryId) => sales.markDeliveryReady(client, wh, deliveryId);
  const toDraft = (deliveryId) => sales.returnDeliveryToDraft(client, wh, deliveryId, { reason: "Change the quantity" });
  const setLine = (deliveryId, orderLineId, quantity) => sales.updateDraftDelivery(client, wh, deliveryId, { lines: [{ salesOrderLineId: orderLineId, quantity }] });
  const deliveryStatus = async (id) => (await client.query(`SELECT delivery_status FROM tenant.sales_fulfillment_requests WHERE id = $1`, [id])).rows[0].delivery_status;
  const inspectionsOf = async (deliveryId) => (await client.query(`SELECT i.* FROM tenant.quality_inspections i JOIN tenant.quality_dispatch_contexts x ON x.inspection_id = i.id
    WHERE x.delivery_id = $1 AND i.reinspection_of_id IS NULL ORDER BY i.created_at`, [deliveryId])).rows;

  // The standard and the control point of one item.
  const CHECKS = [
    { code: "LBL", name: "Label and markings", checkType: "VISUAL", acceptanceText: "Correct model, wattage and customer label", criticality: "MAJOR" },
    { code: "PKG", name: "Packaging intact", checkType: "BOOLEAN", expectedBoolean: true, criticality: "MAJOR", instructions: "Cartons sealed, no crush damage" },
  ];
  const specFor = async (itemId) => {
    const made = await qs.createInspectionSpecification(client, sup, { name: "Pre-dispatch lamp check", description: "Before it leaves", stage: "PRE_DISPATCH", itemId, samplingMethod: "FIXED_COUNT",
      sampleValue: "5", checks: CHECKS });
    await qs.submitSpecificationForReview(client, sup, made.specificationId, made.versionId);
    await qs.approveSpecificationVersion(client, qm, made.specificationId, made.versionId, { publish: true });
    return made;
  };
  const pointFor = async (itemId, specificationId, extra = {}) => {
    const made = await qcp.createQualityControlPoint(client, qm2, { name: "Pre-dispatch check", description: "Check the picked goods before dispatch", triggerEvent: "SALES_DELIVERY_READY_FOR_DISPATCH",
      requirementType: "MANDATORY", gateType: "BLOCK_DISPATCH", specBinding: specificationId ? "FAMILY" : "RESOLVE", specificationId, rules: [{ scope: "ITEM", itemId }], ...extra });
    await qcp.submitQualityControlPoint(client, qm2, made.controlPointId, made.versionId);
    await qcp.approveQualityControlPointVersion(client, qm, made.controlPointId, made.versionId, { publish: true });
    return made;
  };
  const checked = async (name, onHand) => {
    const id = await product(name, onHand);
    const spec = await specFor(id);
    await pointFor(id, spec.specificationId);
    return id;
  };
  const detail = (id, ctx = qm) => qin.getIncomingInspection(client, ctx, id);
  // The inspector records every sample (the first sample's listed checks fail), submits, and a reviewer approves when asked.
  const inspect = async (id, fail = []) => {
    await qin.startIncomingInspection(client, ins, id, {});
    const d = await detail(id);
    const code = (cid) => d.characteristics.find((x) => x.id === cid).code;
    const results = d.samples.flatMap((s) => d.characteristics.map((ch) => {
      const bad = s.id === d.samples[0].id && fail.includes(code(ch.id));
      return { sampleId: s.id, characteristicId: ch.id, ...(code(ch.id) === "LBL" ? { judgement: bad ? "FAIL" : "PASS" } : { value: !bad }) };
    }));
    await qin.recordIncomingResults(client, ins, id, { results });
    const sent = await qin.submitIncomingInspection(client, ins, id, {});
    if (sent.status === "AWAITING_REVIEW") await qin.reviewIncomingInspection(client, qm2, id, { decision: "APPROVE", note: "Checked" });
    return detail(id);
  };
  const dispose = (ctx, id, input) => qin.authorizeQualityDisposition(client, ctx, id, { reason: "Decided on the segregated cartons", ...input });
  const heldAt = async (itemId) => Number((await client.query(`SELECT COALESCE(sum(b.quantity), 0) AS q FROM tenant.stock_balances b JOIN tenant.warehouse_locations l ON l.id = b.warehouse_location_id
    WHERE b.organization_id = $1 AND b.item_id = $2 AND l.disposition = 'quality_hold'`, [organizationId, itemId])).rows[0].q);

  const panel = await checked("LED Panel", 0);
  const bulb = await product("LED Bulb", 50);

  await check("PD1. A pre-dispatch control point checks each delivery line: dispatch is refused until the delivery is ready and Quality clears it; one requirement and one inspection bind the delivery, its order, the line and the frozen versions; marking it ready again creates nothing more; an unchecked item ships freely", async () => {
    await stock.postStockMovement(client, owner, { movementType: "receipt", itemId: panel, warehouseId: mum, quantity: 40, unitCost: 50, idempotencyKey: `seed:pd1:${panel}` });
    const d = await orderAndDelivery(panel, 40);
    const skipped = await refused(() => dispatch(d.deliveryId), "QUALITY_DISPATCH_GATE_ACTIVE");
    assert(/mark the delivery ready/.test(skipped.message), skipped.message);
    const marked = await ready(d.deliveryId);
    assert(marked.qualityInspectionIds.length === 1, JSON.stringify(marked));
    const [i] = await inspectionsOf(d.deliveryId);
    assert(i.inspection_type === "pre_dispatch" && Number(i.lot_quantity) === 40 && i.obligation_id && i.qcp_version_id && i.spec_version_id && i.source_type === "sales_delivery", JSON.stringify(i));
    const view = await detail(i.id);
    assert(view.delivery?.id === d.deliveryId && view.dispatchStatus.gate.blocking && view.dispatchStatus.gate.controlled === 40 && view.dispatchStatus.delivery.lineQuantity === 40, JSON.stringify(view.dispatchStatus));
    await refused(() => dispatch(d.deliveryId), "QUALITY_DISPATCH_GATE_ACTIVE");
    await toDraft(d.deliveryId);
    await ready(d.deliveryId);
    assert((await inspectionsOf(d.deliveryId)).length === 1, "marking ready again re-uses the requirement");
    const free = await orderAndDelivery(bulb, 5);
    await dispatch(free.deliveryId);
    assert(await deliveryStatus(free.deliveryId) === "dispatched", "an unchecked item ships freely");
  });

  let done;
  await check("PD2. The definition of done: 100 picked; completing the inspection releases nothing; Quality clears 80, rejects 15 and reinspects 5 — the 15 go onto an Inventory hold (a draft Inventory places, as the delivery's reservation must give way), the line ships only 80, and the original failure is kept", async () => {
    const lamp = await checked("LED Lamp 9 W", 100);
    done = { lamp, ...(await orderAndDelivery(lamp, 100)) };
    await ready(done.deliveryId);
    const [i] = await inspectionsOf(done.deliveryId);
    done.inspectionId = i.id;
    const after = await inspect(i.id, ["LBL"]);
    assert(after.status === "COMPLETED" && after.proposed === "FAIL", after.status);
    await refused(() => dispatch(done.deliveryId), "QUALITY_DISPATCH_GATE_ACTIVE");
    await refused(() => dispose(ins, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "80", rejectQuantity: "15", reinspectQuantity: "5" }), "QUALITY_INCOMING_ACCESS_DENIED");
    const made = await dispose(qm, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "80", rejectQuantity: "15", reinspectQuantity: "5", reinspection: { standard: "ORIGINAL", reason: "Recount" } });
    assert(made.effects.stockHoldId && made.reinspectionId, JSON.stringify(made));
    const hold = (await client.query(`SELECT * FROM tenant.inventory_stock_holds WHERE id = $1`, [made.effects.stockHoldId])).rows[0];
    assert(hold.status === "draft" && hold.source_document_type === "quality_disposition", hold.status);
    assert((await pd.listDispatchExceptions(client, qm)).some((x) => x.kind === "REJECTED_NOT_HELD"), "the unplaced hold is an exception");
    await holds.placeStockOnHold(client, store, hold.id, {});
    assert(await heldAt(lamp) === 15, String(await heldAt(lamp)));
    assert(!(await pd.listDispatchExceptions(client, qm)).some((x) => x.kind === "REJECTED_NOT_HELD"), "placed: no longer an exception");
    const tooMany = await refused(() => dispatch(done.deliveryId), "QUALITY_DISPATCH_GATE_ACTIVE");
    assert(/cleared 80/.test(tooMany.message), tooMany.message);
    await toDraft(done.deliveryId);
    await setLine(done.deliveryId, done.orderLineId, 80);
    await ready(done.deliveryId);
    await dispatch(done.deliveryId);
    assert(await deliveryStatus(done.deliveryId) === "dispatched", "80 left");
    const shipped = Number((await client.query(`SELECT COALESCE(sum(-quantity), 0) AS q FROM tenant.stock_movements WHERE reference_type = 'sales_delivery' AND reference_id = $1`, [done.deliveryId])).rows[0].q);
    assert(Math.abs(shipped) === 80, String(shipped));
    const re = await detail(made.reinspectionId);
    assert(re.reinspectionOf.id === i.id && re.quantity === 5 && re.delivery?.id === done.deliveryId, JSON.stringify(re.reinspectionOf));
    const original = await detail(i.id);
    assert(original.observations.some((o) => o.outcome === "FAIL") && original.dispatchStatus.holds.length === 1 && original.dispatchStatus.holds[0].status === "active", JSON.stringify(original.dispatchStatus.holds));
  });

  await check("PD3. The line follows the delivery while nothing is decided; once Quality decided, the line can't go above what was inspected", async () => {
    const strip = await checked("LED Strip", 50);
    const d = await orderAndDelivery(strip, 30);
    await ready(d.deliveryId);
    await toDraft(d.deliveryId);
    await setLine(d.deliveryId, d.orderLineId, 20);
    await ready(d.deliveryId);
    const [i] = await inspectionsOf(d.deliveryId);
    assert(Number(i.lot_quantity) === 20 && (await inspectionsOf(d.deliveryId)).length === 1, String(i.lot_quantity));
    await inspect(i.id);
    await dispose(qm, i.id, { decision: "ACCEPT" });
    await toDraft(d.deliveryId);
    await setLine(d.deliveryId, d.orderLineId, 25);
    await refused(() => ready(d.deliveryId), "QUALITY_DISPATCH_QUANTITY_MISMATCH");
    await setLine(d.deliveryId, d.orderLineId, 20);
    await ready(d.deliveryId);
    await dispatch(d.deliveryId);
    assert(await deliveryStatus(d.deliveryId) === "dispatched", "20 left");
  });

  await check("PD4. Cancelling a delivery ends its undecided checks (the inspection is cancelled, its history kept); a decided one stays as evidence", async () => {
    const tube = await checked("LED Tube", 20);
    const d = await orderAndDelivery(tube, 10);
    await ready(d.deliveryId);
    const [i] = await inspectionsOf(d.deliveryId);
    await sales.cancelDelivery(client, wh, d.deliveryId, { reasonCode: "customer_request" });
    const row = (await client.query(`SELECT workflow_status FROM tenant.quality_inspections WHERE id = $1`, [i.id])).rows[0];
    const ob = (await client.query(`SELECT status FROM tenant.quality_inspection_obligations WHERE id = $1`, [i.obligation_id])).rows[0];
    assert(row.workflow_status === "CANCELLED" && ob.status === "CANCELLED", JSON.stringify([row, ob]));
    assert((await detail(i.id)).history.some((h) => h.type === "quality.dispatch.source_cancelled"), "history kept");
  });

  await check("PD5. A missing standard fails closed: the requirement is an exception, the line can't be dispatched, and it shows in the exceptions", async () => {
    const spot = await product("LED Spot", 10);
    await pointFor(spot, null);
    const d = await orderAndDelivery(spot, 4);
    const marked = await ready(d.deliveryId);
    assert(marked.qualityInspectionIds.length === 0, "no inspection without a standard");
    const ob = (await client.query(`SELECT status, exception_code FROM tenant.quality_inspection_obligations WHERE source_document_id = $1`, [d.deliveryId])).rows[0];
    assert(ob.status === "EXCEPTION" && ob.exception_code === "SPEC_MISSING", JSON.stringify(ob));
    await refused(() => dispatch(d.deliveryId), "QUALITY_DISPATCH_GATE_ACTIVE");
    assert((await pd.listDispatchExceptions(client, qm)).some((x) => x.kind === "SPEC_MISSING" && /LED Spot/.test(x.label)), "exception listed");
  });

  await check("PD6. Rejected units before dispatch are never routed to a supplier, scrapped or reworked here; a deviation the customer accepted lets them ship, shown as under deviation", async () => {
    const flood = await checked("LED Flood", 12);
    const d = await orderAndDelivery(flood, 12);
    await ready(d.deliveryId);
    const [i] = await inspectionsOf(d.deliveryId);
    await inspect(i.id, ["PKG"]);
    await refused(() => dispose(qm, i.id, { decision: "RETURN_TO_SUPPLIER" }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(() => dispose(qm, i.id, { decision: "SCRAP" }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(() => dispose(qm, i.id, { decision: "REWORK", reworkInstruction: "Repack" }), "QUALITY_INCOMING_RESULT_INVALID");
    await refused(() => dispose(qm, i.id, { decision: "ACCEPT" }), "QUALITY_INCOMING_CRITICAL_FAILURE");
    await dispose(qm, i.id, { decision: "CONDITIONAL_ACCEPT", conditions: "Customer accepted outer cartons with scuffs (mail of 20 Oct)" });
    await dispatch(d.deliveryId);
    const report = await pd.getDispatchReport(client, qm, "conditional");
    assert(report.rows.some((r) => Number(r.quantity) === 12), JSON.stringify(report.rows));
  });

  await check("PD7. A manual request records evidence and restricts nothing; advisory points never block; the keys are separate: an inspector doesn't decide, Sales can view and request but not inspect; queues don't mix; another Company sees nothing", async () => {
    const d = await orderAndDelivery(bulb, 6);
    const line = (await client.query(`SELECT id FROM tenant.sales_delivery_lines WHERE delivery_id = $1`, [d.deliveryId])).rows[0].id;
    await specFor(bulb);
    const manual = await pd.requestDispatchInspection(client, meera, { deliveryLineId: line, reason: "Key account shipment", idempotencyKey: `m-${tag}` });
    const again = await pd.requestDispatchInspection(client, meera, { deliveryLineId: line, reason: "Key account shipment", idempotencyKey: `m-${tag}` });
    assert(again.replayed && again.id === manual.id, "once per request");
    const view = await detail(manual.id);
    assert(view.delivery.checkpoint === "MANUAL" && !view.dispatchStatus.gate, JSON.stringify(view.dispatchStatus));
    const advisory = await product("LED Torch", 10);
    await pointFor(advisory, (await specFor(advisory)).specificationId, { requirementType: "ADVISORY", gateType: "NONE" });
    const a = await orderAndDelivery(advisory, 3);
    await ready(a.deliveryId);
    assert((await inspectionsOf(a.deliveryId)).length === 1, "advisory inspection opened");
    await dispatch(a.deliveryId);
    await dispatch(d.deliveryId);
    await refused(() => qin.startIncomingInspection(client, meera, manual.id, {}), "QUALITY_INCOMING_ACCESS_DENIED");
    const mine = await qin.listIncomingInspections(client, qm, { type: "pre_dispatch" });
    const finals = await qin.listIncomingInspections(client, qm, { type: "final" });
    assert(mine.length >= 6 && mine.every((r) => r.type === "pre_dispatch") && !finals.some((r) => r.type === "pre_dispatch"), `${mine.length}`);
    await switchTo(other.organizationId);
    const outsider = await contextFor(other.userId, other.organizationId);
    assert((await qin.listIncomingInspections(client, outsider, { type: "pre_dispatch" })).length === 0, "another company");
    await switchTo(organizationId);
  });

  await check("PD8. Someone who may place holds puts rejected units on hold at once; the dashboard, the ten reports and the export reconcile deliveries, inspected lines and holds", async () => {
    const neon = await checked("LED Neon", 300);
    const d = await orderAndDelivery(neon, 50);
    await ready(d.deliveryId);
    const [i] = await inspectionsOf(d.deliveryId);
    await inspect(i.id, ["LBL"]);
    const made = await dispose(owner, i.id, { decision: "PARTIAL_ACCEPT", acceptQuantity: "40", rejectQuantity: "10" });
    const hold = (await client.query(`SELECT status FROM tenant.inventory_stock_holds WHERE id = $1`, [made.effects.stockHoldId])).rows[0];
    assert(hold.status === "active" && await heldAt(neon) === 10, hold.status);
    const dash = await pd.getDispatchDashboard(client, qm);
    assert(dash.deliveriesBlocked >= 1 && dash.rejectedQuantity >= 25 && typeof dash.counts.awaiting === "number", JSON.stringify({ ...dash, blocked: dash.blocked.length }));
    for (const kind of Object.keys(pd.DISPATCH_REPORTS)) {
      const r = await pd.getDispatchReport(client, qm, kind);
      assert(Array.isArray(r.rows) && r.title, kind);
    }
    const rec = await pd.getDispatchReport(client, qm, "reconciliation");
    const row = rec.rows.find((r) => r.delivery && Number(r.cleared_by_quality) === 80);
    assert(row && Number(row.dispatched) === 80 && Number(row.rejected_by_quality) === 15, JSON.stringify(rec.rows.slice(0, 3)));
    const csv = await pd.exportDispatchReport(client, qm, "rejected");
    assert(csv.body.split("\n")[0].includes("hold") && csv.body.includes(String(done.lamp ? "15" : "")), csv.body.split("\n")[0]);
    await refused(() => pd.exportDispatchReport(client, ins, "register"), "QUALITY_INCOMING_ACCESS_DENIED");
  });
} finally {
  await client.query("ROLLBACK").catch(() => null);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed (transaction rolled back: the database is unchanged)`);
if (failures.length) process.exitCode = 1;
