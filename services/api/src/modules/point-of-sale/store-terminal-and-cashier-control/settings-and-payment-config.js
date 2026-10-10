// POS-CAP-001 configuration surface: tenant.pos_settings, the organization-level policy every checkout, return and offline-sync path
// consults (discount limits and the supervisor-approval threshold, return-approval rules, negative stock, price override, cart expiry,
// shift reconciliation). cart.js, sale-completion.js, offline-sync.js and return-lifecycle.js each SELECT these columns. It is
// configuration, not a transaction, so the guarantees are validation + authorization + an audit event per change. An outlet's own payment
// methods and the provider behind each are part of the outlet (outlets/index.js).
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

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
  // Cart (0086): how long a held bill is kept, and how long an idle checkout lock lasts when no payment is pending.
  held_cart_retention_hours: 24,
  checkout_lock_minutes: 15,
  // Walk-In Customer (0087): from this bill total a walk-in invoice needs the buyer's name and address (tax policy; empty = never).
  walk_in_buyer_details_required_above: "50000",
});

const SETTINGS_COLUMNS = Object.keys(POS_SETTINGS_DEFAULTS);
const BOOLEAN_SETTINGS = ["require_shift_reconciliation", "allow_negative_stock", "allow_price_override", "require_return_approval", "prohibit_self_return_approval"];
const PERCENT_SETTINGS = ["max_line_discount_percent", "max_cart_discount_percent", "discount_approval_threshold_percent"];


// --- settings ----------------------------------------------------------------

export async function getPosSettings(client, context) {
  requirePermission(context, "pos.settings.manage");
  const result = await client.query(`SELECT ${SETTINGS_COLUMNS.join(",")},updated_at FROM tenant.pos_settings WHERE organization_id=$1`, [
    context.organizationId,
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
  for (const [column, low, high, label] of [["held_cart_retention_hours", 1, 2160, "hours"], ["checkout_lock_minutes", 2, 240, "minutes"]]) {
    if (input[column] === undefined) continue;
    const value = Number(input[column]);
    if (!Number.isInteger(value) || value < low || value > high) throw posError(400, `${column} must be a whole number of ${label} between ${low} and ${high}.`, "POS_SETTINGS_INVALID");
    changes[column] = value;
  }
  if (input.walk_in_buyer_details_required_above !== undefined) {
    const raw = input.walk_in_buyer_details_required_above;
    if (raw === null || raw === "") changes.walk_in_buyer_details_required_above = null;
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw posError(400, "walk_in_buyer_details_required_above must be zero or more (or empty for never).", "POS_SETTINGS_INVALID");
      changes.walk_in_buyer_details_required_above = value;
    }
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
  const insertColumns = ["organization_id", ...columns];
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
  const values = [context.organizationId, ...columns.map((column) => changes[column])];
  const result = await client.query(
    `INSERT INTO tenant.pos_settings (${insertColumns.join(",")}) VALUES (${placeholders.join(",")})
     ON CONFLICT (organization_id) DO UPDATE SET ${columns.map((column) => `${column}=EXCLUDED.${column}`).join(",")},updated_at=now()
     RETURNING ${SETTINGS_COLUMNS.join(",")},updated_at`,
    values,
  );

  const before = Object.fromEntries(columns.map((column) => [column, current.settings[column]]));
  const after = Object.fromEntries(columns.map((column) => [column, result.rows[0][column]]));
  await event(client, context, "pos_settings", context.organizationId, "pos.settings.updated", { before, after });

  return {
    configured: true,
    updatedAt: result.rows[0].updated_at,
    settings: Object.fromEntries(SETTINGS_COLUMNS.map((column) => [column, result.rows[0][column]])),
  };
}
