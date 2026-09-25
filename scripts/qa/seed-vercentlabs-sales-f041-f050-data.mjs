#!/usr/bin/env node
// Sales F041–F050 demo data, continuing the Sunrise Dairy story: a cold-store
// warehouse with stock, direct orders through approval (discount gate,
// delegation, a rejection with its reason), confirmation, reservation, a
// partial delivery with shipment and proof of delivery, a promised backorder,
// an invoice request, a pending amendment and a line that stock cannot cover.
// Everything goes through governed Sales/Stock functions. Local-only, safe to
// run more than once (each order is found by its customer note first).
// Run seed-vercentlabs-sales-f031-f040-data.mjs first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  amendSalesOrder, approveSalesOrder, completeFulfillmentRequestWithStockMovement, confirmSalesOrder, createBusinessDataRecord,
  createFulfillmentRequest, createInvoiceRequest, createSalesApprovalDelegation, createSalesOrder, getSalesOrder, postStockMovement,
  recordFulfillmentDelivery, recordFulfillmentShipment, rejectSalesOrderApproval, reserveSalesOrderLineFromStock, setSalesOrderLinePromise,
  submitSalesOrder, updateBusinessDataRecord,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const db = new Client({ connectionString });
await db.connect();
const organizationId = (await db.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [process.env.SEED_ORG_NAME || "Vercentlabs"])).rows[0].id;
const companyId = (await db.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0].id;
const branchId = (await db.query(`SELECT id FROM branches WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0].id;
const userId = async (email) => (await db.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id;
const ownerId = await userId("atharva.chavan@vercentlabs.com");
const priyaId = await userId("priya.nair@vercentlabs.demo");
const karanId = await userId("karan.mehta@vercentlabs.demo");
const ctx = (id) => ({ organizationId, userId: id, activeCompanyId: companyId, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: ["organization_owner"] });
const owner = ctx(ownerId), priya = ctx(priyaId);
const stock = { organizationId, companyId, userId: ownerId, permissions: ["stock.view", "stock.reserve", "stock.issue", "stock.receive"], roleSlugs: [] };

async function tx(fn) {
  await db.query("BEGIN");
  try {
    await setTenantContext(db, organizationId);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
const one = async (sql, values) => (await db.query(sql, [organizationId, ...values])).rows[0];
const idOf = async (code) => (await one(`SELECT id FROM tenant.items WHERE organization_id=$1 AND code=$2`, [code])).id;

// ---------- Warehouse and stock ----------
let warehouse = await one(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND code=$2`, ["PUNE-COLD"]);
if (!warehouse) {
  warehouse = await tx((c) => createBusinessDataRecord(c, owner, "warehouses", { companyId, branchId, code: "PUNE-COLD", name: "Pune cold store", warehouseType: "finished_goods", allowNegativeStock: false, status: "active" }));
  console.log("created  warehouse Pune cold store");
}
const milk = await idOf("MILK-TON-1L"), paneer = await idOf("PANEER-200"), ghee = await idOf("GHEE-COW");
const ctn = (await one(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code=$2`, ["CTN"])).id;
const ghee1l = (await one(`SELECT id FROM tenant.item_variants WHERE organization_id=$1 AND sku=$2`, ["GHEE-COW-1L"])).id;
for (const [id, qty] of [[milk, 600], [paneer, 400], [ghee, 30]]) {
  const item = await one(`SELECT track_inventory,updated_at FROM tenant.items WHERE organization_id=$1 AND id=$2`, [id]);
  if (!item.track_inventory) await tx((c) => updateBusinessDataRecord(c, owner, "items", id, { trackInventory: true }));
  await tx((c) => postStockMovement(c, stock, { movementType: "receipt", itemId: id, warehouseId: warehouse.id, quantity: qty, unitCost: 1, referenceType: "opening_stock", idempotencyKey: `f041-f050-opening:${id}` }));
}
console.log("stock received into Pune cold store (idempotent)");

// ---------- Orders ----------
const sunrise = (await one(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, ["Sunrise Dairy Products"])).id;
const addr = async (type) => (await one(`SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type=$3 AND is_primary`, [sunrise, type])).id;
const meera = (await one(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND first_name='Meera'`, [sunrise])).id;
const header = { companyId, partyId: sunrise, ownerUserId: ownerId, contactId: meera, billingAddressId: await addr("billing"), shippingAddressId: await addr("shipping"), currencyCode: "INR", supplyType: "domestic", shippingMethod: "Refrigerated road freight" };
const line = (itemId, quantity, extra = {}) => ({ itemId, uomId: ctn, quantity, warehouseId: warehouse.id, ...extra });
async function order(note, lines, extra = {}) {
  const found = await one(`SELECT o.id FROM tenant.sales_orders o JOIN tenant.sales_order_versions v ON v.sales_order_id=o.id AND v.version_number=1 WHERE o.organization_id=$1 AND v.customer_notes=$2 LIMIT 1`, [note]);
  if (found) { console.log(`present  order "${note}"`); return { id: found.id, created: false }; }
  const created = await tx((c) => createSalesOrder(c, owner, { ...header, customerNotes: note, requestedDeliveryDate: iso(3), lines, ...extra }));
  console.log(`created  order "${note}"`);
  return { id: created.id ?? created.orderId, created: true };
}
const linesOf = async (id) => (await tx((c) => getSalesOrder(c, owner, id))).lines;

// 1. Weekly replenishment: confirmed, reserved, partly delivered, shipped, delivered, backorder promised, invoiced.
const weekly = await order("Weekly replenishment for the Pune plant", [line(milk, 20), line(paneer, 5)], { customerPoNumber: "SDP/PO/2026/0412" });
if (weekly.created) {
  await tx(async (c) => {
    await submitSalesOrder(c, owner, weekly.id);
    await confirmSalesOrder(c, owner, weekly.id);
    for (const l of (await getSalesOrder(c, owner, weekly.id)).lines)
      await reserveSalesOrderLineFromStock(c, owner, stock, { salesOrderId: weekly.id, salesOrderLineId: l.id, idempotencyKey: `f041-reserve:${l.id}` });
    const request = await createFulfillmentRequest(c, owner, weekly.id, `f041-fulfil:${weekly.id}`);
    const [milkLine, paneerLine] = (await getSalesOrder(c, owner, weekly.id)).lines;
    await completeFulfillmentRequestWithStockMovement(c, owner, stock, request.id, { lines: [{ salesOrderLineId: milkLine.id, fulfilledQuantity: 12 }, { salesOrderLineId: paneerLine.id, fulfilledQuantity: 5 }] });
    await recordFulfillmentShipment(c, owner, request.id, { carrier: "Gati Kausar cold chain", trackingNumber: "GKC-7781402" });
    await recordFulfillmentDelivery(c, owner, request.id, { receivedBy: "Meera Kulkarni", note: "12 cartons of milk and 5 of paneer received at 7:40 am, seals intact." });
    await setSalesOrderLinePromise(c, owner, { salesOrderLineId: milkLine.id, promisedDate: iso(4), note: "Remaining 8 cartons go on Monday's cold-chain run from the Pune cold store." });
    await createInvoiceRequest(c, owner, weekly.id, { idempotencyKey: `f041-invoice:${weekly.id}`, quantityBasis: "fulfilled" });
  });
  console.log("  confirmed, reserved, delivered 12 of 20 cartons, promised the rest, invoice requested");
}

// 2. A 12% discount keyed straight into an order — waits for approval.
const festive = await order("Festive hamper order — 12% discount agreed on the call", [line(paneer, 10, { discountPercent: 12 })]);
if (festive.created) await tx((c) => submitSalesOrder(c, owner, festive.id, priyaId));

// 3. Priya is on leave: her approvals go to Karan.
const delegationFound = await one(`SELECT id FROM tenant.sales_approval_delegations WHERE organization_id=$1 AND delegator_user_id=$2 AND status='active'`, [priyaId]);
if (!delegationFound) {
  await tx((c) => createSalesApprovalDelegation(c, owner, { delegatorUserId: priyaId, delegateUserId: karanId, startsOn: iso(0), endsOn: iso(10), reason: "Priya is on leave for Diwali; Karan covers Sales approvals." }));
  console.log("created  delegation Priya → Karan");
}
const gift = await order("Ghee for Diwali gift boxes — 15% festive discount", [{ itemId: ghee, variantId: ghee1l, quantity: 20, warehouseId: warehouse.id, discountPercent: 15 }]);
if (gift.created) await tx((c) => submitSalesOrder(c, owner, gift.id, priyaId));

// 4. Rejected with a reason.
const trial = await order("Paneer trial for the Nashik outlet — 25% introductory discount", [line(paneer, 4, { discountPercent: 25 })]);
if (trial.created)
  await tx(async (c) => {
    await submitSalesOrder(c, owner, trial.id, karanId);
    await rejectSalesOrderApproval(c, ctx(karanId), trial.id, "25% is above our 10% limit; offer 8% with free delivery instead.");
  });

// 5. Confirmed, then an amendment waiting for approval.
const nashik = await order("Monthly milk for the Nashik outlet", [line(milk, 10)]);
if (nashik.created)
  await tx(async (c) => {
    await submitSalesOrder(c, owner, nashik.id);
    await confirmSalesOrder(c, owner, nashik.id);
    const [l] = (await getSalesOrder(c, owner, nashik.id)).lines;
    const detail = await getSalesOrder(c, owner, nashik.id);
    await amendSalesOrder(c, owner, nashik.id, {
      ...header, customerNotes: "Monthly milk for the Nashik outlet", requestedDeliveryDate: iso(5), amendmentReason: "Outlet opens a second counter; Meera asked for 15 cartons instead of 10.",
      lines: [{ itemId: l.item_id, uomId: l.uom_id, quantity: 15, warehouseId: l.warehouse_id }],
      expectedVersionId: detail.order.current_version_id,
    });
  });

// 6. Stock cannot cover this one (30 tins on hand, 60 ordered).
const corporate = await order("Ghee 1 L tins for corporate gifting", [{ itemId: ghee, variantId: ghee1l, quantity: 60, warehouseId: warehouse.id }]);
if (corporate.created)
  await tx(async (c) => {
    await submitSalesOrder(c, owner, corporate.id);
    const state = (await c.query(`SELECT lifecycle_status,current_version_id FROM tenant.sales_orders WHERE id=$1`, [corporate.id])).rows[0];
    if (state.lifecycle_status === "pending_approval") await approveSalesOrder(c, priya, corporate.id, state.current_version_id);
    await confirmSalesOrder(c, owner, corporate.id);
  });

await linesOf(weekly.id);
await db.end();
console.log("done");
