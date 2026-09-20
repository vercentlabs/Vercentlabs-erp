// POS-CAP-001 (F268-F271) + POS-CAP-003 (F282-F286) configuration surface.
//
// Two things the POS module has always READ but never let anyone WRITE
// without SQL:
//
//  1. tenant.pos_settings -- the company-level policy every checkout, return
//     and offline-sync path consults (discount limits and the supervisor-
//     approval threshold, return-approval rules, negative stock, price
//     override, cart expiry, shift reconciliation). cart.js, sale-completion.js,
//     offline-sync.js and return-lifecycle.js each SELECT these columns; none
//     could ever change them, so the documented "limits" were fixed at their
//     migration defaults for every tenant.
//
//  2. Per-store payment methods and provider selection. A store can only take
//     card/UPI/wallet/bank-transfer once BOTH pos_stores.allowed_payment_methods
//     lists the method AND an active pos_payment_provider_configs row names a
//     provider for it (payments.js checks both). With no way to create either,
//     every store was cash-only regardless of the tender UI.
//
// Both are configuration, not transactions, so the guarantees here are
// validation + authorization + an audit event per change -- never a silent
// overwrite. A provider row records only the PROVIDER KEY (and optionally the
// NAME of an environment variable a real credential would live in); this code
// never accepts, stores or returns a credential value.
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { registeredPaymentProviderKeys } from "../tender-and-payment-execution/adapter.js";

export const POS_SETTINGS_DEFAULTS = Object.freeze({
  require_shift_reconciliation: true,
  allow_negative_stock: false,
  allow_price_override: false,
  require_return_approval: true,
  prohibit_self_return_approval: true,
  default_currency_code: "INR",
  max_line_discount_percent: "100",
  max_cart_discount_percent: "100",
  discount_approval_threshold_percent: "10",
  cart_expiry_minutes: 240,
});

const SETTINGS_COLUMNS = Object.keys(POS_SETTINGS_DEFAULTS);
const BOOLEAN_SETTINGS = ["require_shift_reconciliation", "allow_negative_stock", "allow_price_override", "require_return_approval", "prohibit_self_return_approval"];
const PERCENT_SETTINGS = ["max_line_discount_percent", "max_cart_discount_percent", "discount_approval_threshold_percent"];

export const NON_CASH_PAYMENT_METHODS = Object.freeze(["card", "upi", "wallet", "bank_transfer"]);
const ALL_PAYMENT_METHODS = Object.freeze(["cash", ...NON_CASH_PAYMENT_METHODS]);

// --- settings ----------------------------------------------------------------

export async function getPosSettings(client, context) {
  requirePermission(context, "pos.settings.manage");
  const result = await client.query(`SELECT ${SETTINGS_COLUMNS.join(",")},updated_at FROM tenant.pos_settings WHERE organization_id=$1 AND company_id=$2`, [
    context.organizationId,
    context.companyId,
  ]);
  const row = result.rows[0];
  return {
    // `configured` lets the screen say "using defaults" honestly rather than
    // presenting the fallback values as if someone had chosen them.
    configured: Boolean(row),
    updatedAt: row?.updated_at ?? null,
    settings: row ? Object.fromEntries(SETTINGS_COLUMNS.map((column) => [column, row[column]])) : { ...POS_SETTINGS_DEFAULTS },
  };
}

function normalizeSettingsInput(input) {
  const changes = {};
  for (const column of BOOLEAN_SETTINGS) {
    if (input[column] === undefined) continue;
    if (typeof input[column] !== "boolean") throw posError(400, `${column} must be true or false.`, "POS_SETTINGS_INVALID");
    changes[column] = input[column];
  }
  for (const column of PERCENT_SETTINGS) {
    if (input[column] === undefined) continue;
    const value = Number(input[column]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw posError(400, `${column} must be a percentage between 0 and 100.`, "POS_SETTINGS_INVALID");
    }
    changes[column] = value;
  }
  if (input.cart_expiry_minutes !== undefined) {
    const minutes = Number(input.cart_expiry_minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) {
      throw posError(400, "cart_expiry_minutes must be a whole number between 5 and 10080 (one week).", "POS_SETTINGS_INVALID");
    }
    changes.cart_expiry_minutes = minutes;
  }
  if (input.default_currency_code !== undefined) {
    const code = String(input.default_currency_code).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw posError(400, "default_currency_code must be a 3-letter currency code.", "POS_SETTINGS_INVALID");
    changes.default_currency_code = code;
  }
  return changes;
}

export async function updatePosSettings(client, context, input = {}) {
  requirePermission(context, "pos.settings.manage");
  const changes = normalizeSettingsInput(input);
  if (!Object.keys(changes).length) throw posError(400, "No settings were provided to change.", "POS_SETTINGS_EMPTY");

  // Cross-field rule: a supervisor-approval threshold ABOVE the hard cap can
  // never be reached (the cap rejects first), which is almost certainly a
  // typo rather than intent -- fail loudly instead of saving a dead setting.
  const current = await getPosSettings(client, context);
  const merged = { ...current.settings, ...changes };
  if (Number(merged.discount_approval_threshold_percent) > Number(merged.max_line_discount_percent)) {
    throw posError(
      409,
      "The supervisor-approval threshold cannot be higher than the maximum line discount — no discount could ever reach it.",
      "POS_SETTINGS_CONFLICT",
    );
  }

  const columns = Object.keys(changes);
  const insertColumns = ["organization_id", "company_id", ...columns];
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
  const values = [context.organizationId, context.companyId, ...columns.map((column) => changes[column])];
  const result = await client.query(
    `INSERT INTO tenant.pos_settings (${insertColumns.join(",")}) VALUES (${placeholders.join(",")})
     ON CONFLICT (organization_id,company_id) DO UPDATE SET ${columns.map((column) => `${column}=EXCLUDED.${column}`).join(",")},updated_at=now()
     RETURNING ${SETTINGS_COLUMNS.join(",")},updated_at`,
    values,
  );

  const before = Object.fromEntries(columns.map((column) => [column, current.settings[column]]));
  const after = Object.fromEntries(columns.map((column) => [column, result.rows[0][column]]));
  await event(client, context, "pos_settings", context.companyId, "pos.settings.updated", { before, after });

  return {
    configured: true,
    updatedAt: result.rows[0].updated_at,
    settings: Object.fromEntries(SETTINGS_COLUMNS.map((column) => [column, result.rows[0][column]])),
  };
}

// --- per-store payment methods and providers ----------------------------------

async function loadStore(client, context, storeId) {
  const result = await client.query(`SELECT id,name,code,allowed_payment_methods FROM tenant.pos_stores WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [
    context.organizationId,
    context.companyId,
    storeId,
  ]);
  if (!result.rows[0]) throw posError(404, "POS store was not found.", "POS_STORE_NOT_FOUND");
  return result.rows[0];
}

async function readStorePaymentConfig(client, context, store) {
  const providers = await client.query(
    `SELECT payment_method,provider_key,credential_env_var,active FROM tenant.pos_payment_provider_configs
      WHERE organization_id=$1 AND store_id=$2 ORDER BY payment_method`,
    [context.organizationId, store.id],
  );
  return {
    storeId: store.id,
    storeName: store.name,
    allowedMethods: store.allowed_payment_methods || [],
    providers: providers.rows,
    // What the UI may offer -- only adapters this codebase genuinely
    // implements. Anything else would resolve to "external activation blocked"
    // at checkout, so it is not offered as a choice.
    availableProviders: registeredPaymentProviderKeys(),
  };
}

export async function getPosStorePaymentConfig(client, context, storeId) {
  requirePermission(context, "pos.store.manage");
  const store = await loadStore(client, context, storeId);
  await assertPosStoreAccess(client, context, store.id);
  return readStorePaymentConfig(client, context, store);
}

export async function setPosStorePaymentConfig(client, context, storeId, input = {}) {
  requirePermission(context, "pos.store.manage");
  const store = await loadStore(client, context, storeId);
  await assertPosStoreAccess(client, context, store.id);

  const requested = [...new Set((input.allowedMethods || []).map((method) => String(method).trim().toLowerCase()))];
  for (const method of requested) {
    if (!ALL_PAYMENT_METHODS.includes(method)) throw posError(400, `"${method}" is not a supported payment method.`, "POS_PAYMENT_CONFIG_INVALID");
  }
  // Cash is the always-available floor: a store that cannot take cash cannot
  // open a shift float or make change, so it is never removable.
  const allowedMethods = ["cash", ...requested.filter((method) => method !== "cash")];

  const providerInput = input.providers || {};
  const registered = registeredPaymentProviderKeys();
  const desired = [];
  for (const method of NON_CASH_PAYMENT_METHODS) {
    if (!allowedMethods.includes(method)) continue;
    const entry = providerInput[method] || {};
    const providerKey = String(entry.providerKey || "sandbox").trim().toLowerCase();
    if (!registered.includes(providerKey)) {
      throw posError(400, `Payment provider "${providerKey}" is not available. Available: ${registered.join(", ")}.`, "POS_PAYMENT_PROVIDER_UNKNOWN");
    }
    const credentialEnvVar = entry.credentialEnvVar ? String(entry.credentialEnvVar).trim() : null;
    // A value that merely LOOKS like a secret (spaces, a colon-prefixed key,
    // a long token) is refused: this field names an environment variable, it
    // is never a place to paste a credential.
    if (credentialEnvVar && !/^[A-Z][A-Z0-9_]{1,63}$/.test(credentialEnvVar)) {
      throw posError(400, "credentialEnvVar must be the NAME of an environment variable (e.g. PAYMENT_GATEWAY_KEY), never the credential itself.", "POS_PAYMENT_CONFIG_INVALID");
    }
    desired.push({ method, providerKey, credentialEnvVar });
  }

  const before = await readStorePaymentConfig(client, context, store);

  await client.query(`UPDATE tenant.pos_stores SET allowed_payment_methods=$3::text[],updated_at=now() WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    store.id,
    allowedMethods,
  ]);
  for (const entry of desired) {
    await client.query(
      `INSERT INTO tenant.pos_payment_provider_configs (organization_id,company_id,store_id,payment_method,provider_key,credential_env_var,active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7)
       ON CONFLICT (organization_id,store_id,payment_method) DO UPDATE SET provider_key=EXCLUDED.provider_key,credential_env_var=EXCLUDED.credential_env_var,active=true,updated_at=now()`,
      [context.organizationId, context.companyId, store.id, entry.method, entry.providerKey, entry.credentialEnvVar, context.userId],
    );
  }
  // A method that was switched off keeps its row (history/intent) but is
  // deactivated, so re-enabling it later is a clean toggle, not a re-create.
  const stillWanted = desired.map((entry) => entry.method);
  await client.query(
    `UPDATE tenant.pos_payment_provider_configs SET active=false,updated_at=now()
      WHERE organization_id=$1 AND store_id=$2 AND active=true AND NOT (payment_method = ANY($3::text[]))`,
    [context.organizationId, store.id, stillWanted],
  );

  const after = await readStorePaymentConfig(client, context, { ...store, allowed_payment_methods: allowedMethods });
  await event(client, context, "pos_store", store.id, "pos.store.payment_config_updated", {
    before: { allowedMethods: before.allowedMethods, providers: before.providers.filter((p) => p.active).map((p) => `${p.payment_method}:${p.provider_key}`) },
    after: { allowedMethods: after.allowedMethods, providers: after.providers.filter((p) => p.active).map((p) => `${p.payment_method}:${p.provider_key}`) },
  });
  return after;
}
