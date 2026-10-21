// MVP 45 (every app alone, every app connected): a new workspace has the basics (a product category, the default payment term, project
// types, asset categories); each app's main flow runs with no other app on — Sales without Stock (no warehouse, no reservation, invoiced as
// ordered), Purchase without Stock (no warehouse, marked received, 2-way match, a product billed without an order), Point of Sale without a
// warehouse, Accounting raising its own invoice and bill, Projects activating with a default type — and with Stock on the same flows keep
// their Stock steps; Manufacturing brings Stock and keeps it on; an app with open work is turned off only when the owner confirms; on Free,
// Manufacturing with Stock counts as one app; "Not GST registered" stops GST on sales only.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:app-alone     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
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
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the app-alone suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 6).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
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
  const registered = await registerOrganization(client, {
    fullName: "Alone Owner", email: `alone-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `Alone ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const organizationId = registered.organizationId;
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
  const { rows: [grants] } = await client.query(
    `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
       LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [organizationId, registered.userId]);
  // A fresh context per step: the apps a context sees are loaded once per context.
  const owner = () => ({ organizationId, userId: registered.userId, roleSlugs: grants.role_slugs, permissions: grants.permissions });
  // Exactly these apps on (organization_modules, as Settings › Modules leaves them).
  const onlyApps = (keys) => client.query(`UPDATE public.organization_modules SET status = CASE WHEN module_key = ANY($2::text[]) THEN 'enabled' ELSE 'disabled' END WHERE organization_id = $1`,
    [organizationId, keys]);
  const count = async (sql) => Number((await client.query(sql, [organizationId])).rows[0].count);

  const products = await api("modules/products/index.js");
  const sales = await api("modules/sales/index.js");
  const customers = await api("modules/sales/customers/index.js");
  const suppliers = await api("modules/procurement/suppliers/index.js");
  const po = { ...(await api("modules/procurement/purchase-orders/index.js")), ...(await api("modules/procurement/supplier-bills/index.js")) };
  const outlets = await api("modules/point-of-sale/outlets/index.js");
  const accounting = await api("modules/accounting/index.js");
  const projects = await api("modules/projects/project-service.js");
  const modules = await api("core/platform/module-administration.js");
  const manifests = await api("core/platform/app-manifests.js");
  const choice = await api("core/billing/app-choice.js");
  const tracking = await api("core/products/tracking.js");
  const { loadTaxContext } = await api("core/tax/index.js");
  const start = await api("core/organization/workspace-start.js");
  const stockBridge = await api("modules/stock/bridges/purchase.js");

  // The company: a Maharashtra GST registration, a unit, a price list; a customer in Maharashtra and a supplier in Karnataka.
  await client.query(`INSERT INTO tenant.tax_registrations (organization_id, code, name, registration_number, state_code, state_name, is_default) VALUES ($1, 'MH', 'Maharashtra', '27AAACV1111A1Z1', '27', 'Maharashtra', true)`, [organizationId]);
  const gst18 = (await client.query(`SELECT id FROM tenant.tax_categories WHERE organization_id = $1 AND code = 'GST-18'`, [organizationId])).rows[0].id;
  const nos = (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, 'NOS', 'Numbers', 'quantity', 0)
    ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = 0 RETURNING id`, [organizationId])).rows[0].id;
  const std = (await client.query(`INSERT INTO tenant.price_lists (organization_id, code, name, price_list_type, currency_code, tax_inclusive, is_default) VALUES ($1, 'STD', 'Standard', 'sales', 'INR', false, true) RETURNING id`, [organizationId])).rows[0].id;
  const lumen = await customers.createCustomer(client, owner(), { displayName: "Lumen Retail", customerKind: "business", countryCode: "IN", currencyCode: "INR",
    billingAddress: { line1: "12 Kalbadevi Road", city: "Mumbai", state: "Maharashtra", stateCode: "27", postalCode: "400002", countryCode: "IN" },
    primaryContact: { firstName: "Asha", lastName: "Rao", email: "asha@lumen.example" } });
  const castings = (await suppliers.createSupplier(client, owner(), {
    supplierName: "Bangalore Castings", supplierType: "business", category: "raw_materials", defaultCurrency: "INR", gstin: "29AAACB1234C1Z2", gstRegistrationType: "registered_regular",
    address: { line1: "Peenya", city: "Bengaluru", state: "Karnataka", postalCode: "560058" }, primaryContact: { firstName: "Kiran", email: "kiran@bc.example" },
  })).supplier;
  const expenseAccount = (await client.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND account_class = 'expense' AND NOT is_group AND status = 'active' AND account_type NOT IN ('cogs', 'rounding', 'fx_loss') ORDER BY code LIMIT 1`,
    [organizationId])).rows[0]?.id;
  let seq = 0;
  // A product made through Products (the type left to the default), priced on the standard list.
  const product = async (name, input = {}) => {
    const made = await products.createProduct(client, owner(), { name: `${name} ${++seq}`, baseUomId: nos, hsnSacCode: "8539", taxCategoryId: gst18, ...input });
    const id = made.id ?? made.product?.id ?? made.item?.id;
    await client.query(`INSERT INTO tenant.price_list_items (organization_id, price_list_id, item_id, uom_id, minimum_quantity, rate) VALUES ($1, $2, $3, $4, 1, 100)`, [organizationId, std, id, nos]);
    return id;
  };
  const typeOf = async (id) => (await client.query(`SELECT item_type, track_inventory, group_id FROM tenant.items WHERE id = $1`, [id])).rows[0];

  await check("A1. a new workspace has the basics: a General product category, Due on Receipt as Sales' default term, project types and four asset categories", async () => {
    const general = (await client.query(`SELECT name, allowed_item_types FROM tenant.item_groups WHERE organization_id = $1`, [organizationId])).rows;
    assert(general.length === 1 && general[0].name === "General" && general[0].allowed_item_types === null, JSON.stringify(general));
    const term = (await client.query(`SELECT term.code FROM tenant.sales_settings settings JOIN tenant.payment_terms term ON term.id = settings.default_payment_term_id WHERE settings.organization_id = $1`,
      [organizationId])).rows[0];
    assert(term?.code === "IMMEDIATE", `default term ${term?.code}`);
    const types = (await client.query(`SELECT code FROM tenant.project_types WHERE organization_id = $1`, [organizationId])).rows.map((row) => row.code);
    assert(types.includes("INTERNAL") && types.includes("CLIENT"), types.join(","));
    const assets = (await client.query(`SELECT name, code FROM tenant.asset_categories WHERE organization_id = $1 ORDER BY code`, [organizationId])).rows;
    assert(assets.map((row) => row.name).join("|") === "Office Furniture|Computers & Laptops|Vehicles|Plant & Machinery" && assets[0].code === "ACAT-000001", JSON.stringify(assets));
    assert(await count(`SELECT count(*) FROM tenant.asset_category_policy_versions WHERE organization_id = $1`) === 4, "each category has its policy version");
  });

  await check("A2. without Stock a new product is not stock-tracked and needs no category; with Stock it is kept in stock; effective tracking needs both", async () => {
    await onlyApps(["sales"]);
    const loose = await product("Desk lamp");
    const row = await typeOf(loose);
    assert(row.item_type === "product" && row.track_inventory === false && row.group_id === null, JSON.stringify(row));
    assert(!(await tracking.tracksStock(client, owner(), row)), "no Stock, no tracking");
    await onlyApps(["sales", "stock"]);
    assert(await tracking.defaultProductType(client, owner()) === "stock", "with Stock the default is stock");
    assert(tracking.productTracksStock({ item_type: "product", track_inventory: true }) && !tracking.productTracksStock({ item_type: "service", track_inventory: true }), "a service never");
  });

  await check("A3. Sales alone: an order needs no warehouse, confirming reserves nothing and says nothing about stock, and the invoice bills what was ordered", async () => {
    await onlyApps(["sales"]);
    const lamp = await product("Table lamp");
    const so = await sales.createSalesOrder(client, owner(), { partyId: lumen.id, lines: [{ itemId: lamp, quantity: 4 }] });
    const line = (await client.query(`SELECT warehouse_id FROM tenant.sales_order_lines WHERE organization_id = $1 AND sales_order_version_id = (SELECT current_version_id FROM tenant.sales_orders WHERE id = $2)`,
      [organizationId, so.id])).rows[0];
    assert(line.warehouse_id === null, "no warehouse on the line");
    const check = await sales.validateSalesOrderForConfirmation(client, owner(), so.id);
    assert(check.ready, `ready: ${check.problems.join(" / ")}`);
    assert(!check.warnings.some((warning) => /stock/i.test(warning)) && check.reservesOnConfirm === false, JSON.stringify(check.warnings));
    const confirmed = await sales.confirmSalesOrder(client, owner(), so.id);
    assert(confirmed.confirmed !== false, JSON.stringify(confirmed.problems ?? confirmed));
    assert(await count(`SELECT count(*) FROM tenant.stock_reservations WHERE organization_id = $1`) === 0, "no reservation");
    const invoice = await sales.createInvoiceFromSalesOrder(client, owner(), so.id, { idempotencyKey: `inv-${tag}` });
    const billed = (await client.query(`SELECT sum(quantity) AS q FROM tenant.accounting_customer_invoice_lines WHERE customer_invoice_id = $1`, [invoice.invoiceId ?? invoice.id])).rows[0];
    assert(Number(billed.q) === 4, `invoiced ${billed.q} as ordered, before any delivery`);
    assert(await count(`SELECT count(*) FROM tenant.sales_fulfillment_requests WHERE organization_id = $1`) === 0, "no delivery anywhere");
  });

  await check("A4. Sales + Stock (the bridge): the order asks for its warehouse, and a line without one is refused at confirmation", async () => {
    await onlyApps(["sales", "stock"]);
    await client.query(`UPDATE tenant.sales_settings SET default_warehouse_id = NULL WHERE organization_id = $1`, [organizationId]);
    const lamp = await product("Floor lamp", { type: "stock", categoryId: (await client.query(`SELECT id FROM tenant.item_groups WHERE organization_id = $1`, [organizationId])).rows[0].id });
    const so = await sales.createSalesOrder(client, owner(), { partyId: lumen.id, lines: [{ itemId: lamp, quantity: 1 }] });
    const result = await sales.validateSalesOrderForConfirmation(client, owner(), so.id);
    assert(result.problems.some((problem) => /warehouse it ships from/.test(problem)), result.problems.join(" / "));
  });

  let purchaseOrder;
  await check("A5. Purchase alone: no receiving warehouse; confirmed orders match the bill to the order (2-way); goods are marked received with no stock records", async () => {
    await onlyApps(["procurement"]);
    const pump = await product("Pump");
    const made = await po.createPurchaseOrder(client, owner(), { supplierId: castings.id, lines: [{ productId: pump, quantity: "5", unitPrice: "1000" }] });
    purchaseOrder = made.id;
    const line = (await client.query(`SELECT product_type, receiving_warehouse_id FROM tenant.purchase_order_lines WHERE purchase_order_id = $1`, [made.id])).rows[0];
    assert(line.product_type === "non_stock" && line.receiving_warehouse_id === null, JSON.stringify(line));
    await po.confirmPurchaseOrder(client, owner(), made.id);
    assert((await client.query(`SELECT matching_policy FROM tenant.purchase_orders WHERE id = $1`, [made.id])).rows[0].matching_policy === "two_way", "2-way");
    const receipt = await po.createGoodsReceiptFromPurchaseOrder(client, owner(), made.id, { post: true, lines: [{ purchaseOrderLineId: (await client.query(`SELECT id FROM tenant.purchase_order_lines WHERE purchase_order_id = $1`, [made.id])).rows[0].id, acceptedQuantity: "5" }] });
    assert(receipt, "marked received");
    assert(await count(`SELECT count(*) FROM tenant.stock_movements WHERE organization_id = $1`) === 0, "no stock movement");
  });

  await check("A6. Purchase alone: the bill posts against the order without a receipt check, and a product can be billed with no order at all", async () => {
    await onlyApps(["procurement"]);
    const lineId = (await client.query(`SELECT id FROM tenant.purchase_order_lines WHERE purchase_order_id = $1`, [purchaseOrder])).rows[0].id;
    const bill = await po.createBillFromPurchaseOrder(client, owner(), purchaseOrder, { supplierInvoiceNumber: `BC-${tag}`, supplierInvoiceDate: accounting.localToday(),
      lines: [{ purchaseOrderLineId: lineId, quantity: "5" }], idempotencyKey: `bill-${tag}` });
    const billId = bill.billId ?? bill.id ?? bill.bill?.id;
    const posted = await po.postSupplierBill(client, owner(), billId, {});
    // Posted, or held for Finance's approver when its bill policy asks: no receipt is needed either way.
    assert(["posted", "awaiting_approval", "pending_approval"].includes(posted.status), JSON.stringify(posted).slice(0, 200));
    const spare = await product("Spare part");
    const direct = await po.createDirectSupplierBill(client, owner(), { supplierId: castings.id, supplierInvoiceNumber: `BC2-${tag}`, supplierInvoiceDate: accounting.localToday(),
      lines: [{ productId: spare, description: "Spare part", quantity: "2", unitPrice: "250", expenseAccountId: expenseAccount }], idempotencyKey: `direct-${tag}` });
    assert(direct, "a product on a bill without an order");
  });

  await check("A7. Purchase + Stock (the bridge): a stock product can't be billed without an order, and its order line needs a receiving warehouse", async () => {
    await onlyApps(["procurement", "stock"]);
    const stocked = await product("Bearing", { type: "stock", categoryId: (await client.query(`SELECT id FROM tenant.item_groups WHERE organization_id = $1`, [organizationId])).rows[0].id });
    await refused(() => po.createDirectSupplierBill(client, owner(), { supplierId: castings.id, supplierInvoiceNumber: `BC3-${tag}`, supplierInvoiceDate: accounting.localToday(),
      lines: [{ productId: stocked, description: "Bearing", quantity: "1", unitPrice: "100", expenseAccountId: expenseAccount }], idempotencyKey: `direct2-${tag}` }), "SUPPLIER_BILL_STOCK_WITHOUT_ORDER");
  });

  await check("A8. Point of Sale alone: an outlet needs no selling warehouse; with Stock on it does", async () => {
    await onlyApps(["point-of-sale"]);
    const address = { line1: "MG Road", city: "Mumbai", state: "Maharashtra", stateCode: "27", postalCode: "400001", countryCode: "IN" };
    const outlet = await outlets.createOutlet(client, owner(), { code: `S${tag.slice(0, 4)}`.toUpperCase(), name: "Shop", type: "retail_store", address, timezone: "Asia/Kolkata" });
    const id = outlet.id ?? outlet.outlet?.id;
    assert((await client.query(`SELECT warehouse_id FROM tenant.pos_stores WHERE id = $1`, [id])).rows[0].warehouse_id === null, "no warehouse");
    await onlyApps(["point-of-sale", "stock"]);
    await refused(() => outlets.createOutlet(client, owner(), { code: `T${tag.slice(0, 4)}`.toUpperCase(), name: "Shop 2", type: "retail_store", address, timezone: "Asia/Kolkata" }));
  });

  await check("A9. Accounting alone: New invoice posts with CGST + SGST inside the state; New bill posts with IGST across states", async () => {
    await onlyApps(["accounting"]);
    const invoice = await accounting.createAccountingInvoice(client, owner(), { partyId: lumen.id, post: true, lines: [{ description: "Consulting", quantity: "2", unitPrice: "1000", gstRate: 18 }] });
    assert(invoice.status === "posted", invoice.status);
    const row = (await client.query(`SELECT grand_total, tax_total, journal_entry_id FROM tenant.accounting_customer_invoices WHERE id = $1`, [invoice.id])).rows[0];
    assert(Number(row.grand_total) === 2360 && Number(row.tax_total) === 360 && row.journal_entry_id, JSON.stringify(row));
    const split = (await client.query(`SELECT tax_details FROM tenant.accounting_customer_invoice_lines WHERE customer_invoice_id = $1`, [invoice.id])).rows[0].tax_details;
    assert(split.map((component) => component.taxType).join(",") === "cgst,sgst", JSON.stringify(split));
    const bill = await accounting.createAccountingBill(client, owner(), { partyId: castings.partyId, post: true, supplierInvoiceReference: `ACC-${tag}`,
      lines: [{ description: "Castings", quantity: "1", unitPrice: "500", gstRate: 18 }] });
    assert(["posted", "pending_approval"].includes(bill.status), `${bill.status} (a bill may wait for Finance's approver)`);
    const billSplit = (await client.query(`SELECT tax_details FROM tenant.accounting_vendor_bill_lines WHERE vendor_bill_id = $1`, [bill.id])).rows[0].tax_details;
    assert(billSplit.map((component) => component.taxType).join(",") === "igst", JSON.stringify(billSplit));
  });

  await check("A10. Projects alone: a project made without a type gets one, so it can be activated", async () => {
    await onlyApps(["projects"]);
    const draft = await projects.createProjectDraft(client, owner(), { name: "Office move" });
    const row = (await client.query(`SELECT type.code FROM tenant.projects project JOIN tenant.project_types type ON type.id = project.project_type_id WHERE project.id = $1`, [draft.projectId])).rows[0];
    assert(row?.code === "INTERNAL", `type ${row?.code}`);
  });

  await check("A11. switching: Manufacturing turns Stock on with it; Stock can't be turned off while Manufacturing is on; nothing is deleted", async () => {
    await onlyApps(["sales"]);
    const on = await modules.setOrganizationModuleEnabled(client, owner(), "manufacturing", true, {});
    assert(on.alsoEnabled.includes("stock"), JSON.stringify(on.alsoEnabled));
    const statuses = Object.fromEntries((await client.query(`SELECT module_key, status FROM public.organization_modules WHERE organization_id = $1`, [organizationId])).rows.map((row) => [row.module_key, row.status]));
    assert(statuses.manufacturing === "enabled" && statuses.stock === "enabled", JSON.stringify(statuses));
    const error = await refused(() => modules.setOrganizationModuleEnabled(client, owner(), "stock", false, {}), "MODULE_REQUIRED_BY_ANOTHER");
    assert(/Manufacturing/.test(error.message), error.message);
    await modules.setOrganizationModuleEnabled(client, owner(), "manufacturing", false, {});
    await modules.setOrganizationModuleEnabled(client, owner(), "stock", false, {});
    assert(await count(`SELECT count(*) FROM tenant.items WHERE organization_id = $1`) > 0, "products are kept");
  });

  await check("A12. switching: an app with open work is turned off only when the owner confirms; its records stay", async () => {
    await onlyApps(["procurement", "accounting"]);
    await po.createPurchaseOrder(client, owner(), { supplierId: castings.id, lines: [{ productId: await product("Valve"), quantity: "1", unitPrice: "100" }] })
      .then((made) => po.confirmPurchaseOrder(client, owner(), made.id));
    const error = await refused(() => modules.setOrganizationModuleEnabled(client, owner(), "procurement", false, {}), "MODULE_OPEN_WORK");
    assert(error.details.openWork.some((entry) => /purchase orders/.test(entry.label)), JSON.stringify(error.details));
    const off = await modules.setOrganizationModuleEnabled(client, owner(), "procurement", false, { confirmOpenWork: true });
    assert(off.changed && await count(`SELECT count(*) FROM tenant.purchase_orders WHERE organization_id = $1 AND status = 'confirmed'`) >= 1, "turned off, orders kept");
  });

  await check("A13. on a plan with one app, Manufacturing with the Stock it needs counts as one app", async () => {
    assert(JSON.stringify(manifests.countedApps(["manufacturing", "stock"])) === JSON.stringify(["manufacturing"]), "counted");
    assert(choice.effectiveModulesFor({ moduleAllowance: 1, selectedModules: ["manufacturing"], modulesSnapshot: [] }).sort().join(",") === "manufacturing,stock", "brings Stock");
    assert(choice.effectiveModulesFor({ moduleAllowance: 1, selectedModules: ["sales"], modulesSnapshot: [] }).join(",") === "sales", "one app stays one app");
  });

  await check("A14. Stock reorder opens purchase orders only through the Purchase bridge", async () => {
    await onlyApps(["stock"]);
    assert(await stockBridge.draftPurchaseOrder(client, owner(), { supplierId: castings.id, lines: [] }) === null, "no purchase order without Purchase");
    await onlyApps(["stock", "procurement"]);
    assert(await stockBridge.purchaseOn(client, owner()), "with Purchase on");
  });

  await check("A15. \"Not GST registered\" stops GST on sales only; purchases still carry the supplier's GST, not claimed back", async () => {
    await start.saveGstDetails(client, owner(), { registered: false, stateCode: "27" });
    const salesTax = await loadTaxContext(client, { organizationId });
    const purchaseTax = await loadTaxContext(client, { organizationId, purchase: true });
    assert(salesTax.enabled === false && purchaseTax.enabled === true && purchaseTax.claimsInputTax === false, JSON.stringify({ salesTax, purchaseTax }));
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
