// SKUs: the company's code for an item of the shared Item Master — not an entity of its own. An item has one SKU (tenant.items.code),
// unique per organization after normalization (trimmed, Unicode-normalized, upper-case). A SKU is typed or generated, by the
// organization's numbering setting:
//   manual      every SKU is typed;
//   automatic   every SKU is generated;
//   either      generated when left empty (a typed SKU may not look like a generated one: that format is the counter's).
// A generated SKU is <prefix><sep><number> (or <year><sep><prefix><sep><number>), the prefix being the nearest category's SKU prefix or the
// default one, the number from an atomic per-prefix counter: two people creating items at once never get the same SKU, and a number lost
// to a failed save is simply skipped. A SKU change keeps the item — its id, stock, batches, serials and documents — and the old SKU stays
// in the item's history, searchable and reserved: a SKU that has identified one item is never given to another (also held by the database).
import { audit } from "../../core/security/request-security.js";
import { requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS as P, ProductError } from "./constants.js";
import { recordProductHistory } from "./history.js";
import { has, isUuid, requireUuid, text } from "./validation.js";

export const SKU_MAX_LENGTH = 40;
export const SKU_MODES = Object.freeze([
  { code: "either", label: "Generated or typed", description: "A SKU left empty is generated; a typed one is checked." },
  { code: "automatic", label: "Always generated", description: "Every new item gets the next generated SKU." },
  { code: "manual", label: "Always typed", description: "Every item needs a typed SKU." },
]);
export const SKU_SEPARATORS = Object.freeze(["-", "_", ".", "/", ""]);
const MODES = new Set(SKU_MODES.map((entry) => entry.code));
const FORMAT = /^[A-Z0-9][A-Z0-9._/-]*$/;
const PREFIX = /^[A-Z0-9]{1,12}$/;
// Control characters and the invisible ones (zero-width spaces and joiners, direction marks, the byte-order mark).
const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202f], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const isInvisible = (value) => [...value].some((character) => INVISIBLE_RANGES.some(([low, high]) => character.codePointAt(0) >= low && character.codePointAt(0) <= high));
const DEFAULTS = Object.freeze({
  sku_mode: "either", default_prefix: "ITEM", separator: "-", padding: 6, include_year: false, use_category_prefix: true, allow_sku_changes: true, version: 0,
  updated_at: null,
});

const issue = (field, message, code = "PRODUCT_VALIDATION", status = 400) => new ProductError(status, message, code, { issues: [{ field, message }] });

// ------------------------------------------------------------------ normalization and format

// The form a SKU is stored and compared in.
export function normalizeSku(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKC").trim().toUpperCase();
}

// What is wrong with a SKU as typed, or null.
export function skuProblem(value) {
  const raw = String(value ?? "");
  if (isInvisible(raw.trim())) return "The SKU contains an invisible or control character. Type it again.";
  const sku = normalizeSku(raw);
  if (!sku) return "Enter the SKU.";
  if (sku.length > SKU_MAX_LENGTH) return `Use ${SKU_MAX_LENGTH} characters or fewer.`;
  if (/\s/.test(sku)) return "A SKU has no spaces. Use a dash instead.";
  if (!FORMAT.test(sku)) return "Use letters, numbers, dots, dashes, underscores or slashes, starting with a letter or number.";
  return null;
}

export function validateSku(value, field = "code") {
  const problem = skuProblem(value);
  if (problem) throw issue(field, problem);
  return normalizeSku(value);
}

// ------------------------------------------------------------------ settings

async function settingsRow(client, context) {
  const row = (await client.query(`SELECT * FROM tenant.item_sku_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  return row ?? { ...DEFAULTS };
}

function toSettings(row) {
  return {
    mode: row.sku_mode, modeLabel: SKU_MODES.find((entry) => entry.code === row.sku_mode)?.label ?? row.sku_mode, defaultPrefix: row.default_prefix, separator: row.separator,
    padding: Number(row.padding), includeYear: row.include_year, useCategoryPrefix: row.use_category_prefix, allowSkuChanges: row.allow_sku_changes,
    previousSkuSearch: true, skuReuse: false, version: Number(row.version ?? 0), updatedAt: row.updated_at ?? null,
  };
}

export async function getSkuSettings(client, context) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const settings = toSettings(await settingsRow(client, context));
  const preview = await previewNextSku(client, context, {});
  return { ...settings, example: preview.sku, modes: SKU_MODES, separators: SKU_SEPARATORS };
}

// input: mode, defaultPrefix, separator, padding, includeYear, useCategoryPrefix, allowSkuChanges, expectedVersion. Counters are never set
// by hand: they only move forward, so a SKU is never issued twice.
export async function updateSkuSettings(client, context, input = {}) {
  requireProductPermission(context, P.configureSkuNumbering, "You do not have permission to configure SKU numbering.");
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('item_sku_settings:' || $1::text))`, [context.organizationId]);
  const current = await settingsRow(client, context);
  if (has(input, "expectedVersion") && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(current.version))
    throw new ProductError(409, "Someone else changed the SKU numbering after you opened it. Reload it.", "SKU_SETTINGS_VERSION_CONFLICT");
  const next = { ...current };
  if (has(input, "mode")) next.sku_mode = text(input.mode).toLowerCase();
  if (has(input, "defaultPrefix")) next.default_prefix = normalizeSku(input.defaultPrefix);
  if (has(input, "separator")) next.separator = String(input.separator ?? "");
  if (has(input, "padding")) next.padding = Number(input.padding);
  for (const [field, column] of [["includeYear", "include_year"], ["useCategoryPrefix", "use_category_prefix"], ["allowSkuChanges", "allow_sku_changes"]])
    if (has(input, field)) next[column] = input[field] === true || input[field] === "true";
  if (!MODES.has(next.sku_mode)) throw issue("mode", "Choose how SKUs are given.");
  if (!PREFIX.test(next.default_prefix)) throw issue("defaultPrefix", "Use 1 to 12 letters or digits, such as ITEM.");
  if (!SKU_SEPARATORS.includes(next.separator)) throw issue("separator", "Choose a dash, underscore, dot, slash or nothing.");
  if (!Number.isInteger(next.padding) || next.padding < 3 || next.padding > 10) throw issue("padding", "Use 3 to 10 digits.");
  const row = (await client.query(
    `INSERT INTO tenant.item_sku_settings (organization_id, sku_mode, default_prefix, separator, padding, include_year, use_category_prefix, allow_sku_changes, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (organization_id) DO UPDATE SET sku_mode = EXCLUDED.sku_mode, default_prefix = EXCLUDED.default_prefix, separator = EXCLUDED.separator, padding = EXCLUDED.padding,
       include_year = EXCLUDED.include_year, use_category_prefix = EXCLUDED.use_category_prefix, allow_sku_changes = EXCLUDED.allow_sku_changes, updated_by = EXCLUDED.updated_by,
       updated_at = now(), version = tenant.item_sku_settings.version + 1
     RETURNING *`,
    [context.organizationId, next.sku_mode, next.default_prefix, next.separator, next.padding, next.include_year, next.use_category_prefix, next.allow_sku_changes, context.userId ?? null])).rows[0];
  await audit(client, {
    organizationId: context.organizationId, actorUserId: context.userId ?? null, eventType: "products.sku_numbering_changed", entityType: "item_sku_settings",
    beforeData: toSettings(current), afterData: toSettings(row),
  });
  return getSkuSettings(client, context);
}

// ------------------------------------------------------------------ generation

// The prefix a new item's SKU gets: its category's, or the nearest ancestor's that has one, else the default.
async function prefixFor(client, context, settings, categoryId) {
  if (settings.use_category_prefix && isUuid(categoryId)) {
    const row = (await client.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id, name, sku_prefix, 0 AS depth FROM tenant.item_groups WHERE organization_id = $1 AND id = $2
         UNION ALL
         SELECT up.id, up.parent_id, up.name, up.sku_prefix, chain.depth + 1 FROM tenant.item_groups up JOIN chain ON up.id = chain.parent_id
          WHERE up.organization_id = $1 AND chain.depth < 60)
       SELECT name, sku_prefix FROM chain WHERE sku_prefix IS NOT NULL ORDER BY depth LIMIT 1`, [context.organizationId, categoryId])).rows[0];
    if (row) return { prefix: row.sku_prefix, source: "category", fromName: row.name };
  }
  return { prefix: settings.default_prefix, source: "default", fromName: null };
}

const yearOf = async (client) => (await client.query(`SELECT extract(year FROM current_date)::int AS year`)).rows[0].year;
const sequenceKey = (settings, prefix, year) => (settings.include_year ? `${prefix}:${year}` : prefix);
function compose(settings, prefix, value, year) {
  const number = String(value).padStart(Number(settings.padding), "0");
  return settings.include_year ? `${year}${settings.separator}${prefix}${settings.separator}${number}` : `${prefix}${settings.separator}${number}`;
}

async function taken(client, context, sku, exceptItemId = null) {
  return Boolean((await client.query(
    `SELECT 1 FROM tenant.item_sku_reservations WHERE organization_id = $1 AND normalized_sku = $2 AND ($3::uuid IS NULL OR item_id <> $3)
     UNION ALL SELECT 1 FROM tenant.items WHERE organization_id = $1 AND normalized_sku = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1`,
    [context.organizationId, sku, exceptItemId])).rows[0]);
}

// The SKU the next item in `categoryId` would most likely get. Nothing is reserved: the number is taken only when the item is saved.
export async function previewNextSku(client, context, { categoryId = null } = {}) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const settings = await settingsRow(client, context);
  const { prefix, source, fromName } = await prefixFor(client, context, settings, categoryId);
  const year = await yearOf(client);
  let value = Number((await client.query(`SELECT next_value FROM tenant.item_sku_sequences WHERE organization_id = $1 AND sequence_key = $2`,
    [context.organizationId, sequenceKey(settings, prefix, year)])).rows[0]?.next_value ?? 1);
  while (value < Number.MAX_SAFE_INTEGER && await taken(client, context, compose(settings, prefix, value, year))) value += 1;
  return { mode: settings.sku_mode, sku: compose(settings, prefix, value, year), prefix, prefixSource: source, prefixFrom: fromName, generated: settings.sku_mode !== "manual" };
}

// Takes the next number for the item's prefix and returns the SKU, skipping any number whose SKU is already taken or reserved. The counter
// row is locked until the transaction ends, so concurrent generations queue and each gets its own number.
export async function generateItemSku(client, context, { categoryId = null } = {}) {
  requireProductPermission(context, P.generateSku, "You do not have permission to generate SKUs.");
  const settings = await settingsRow(client, context);
  if (settings.sku_mode === "manual") throw issue("code", "This organization types its SKUs. Enter the SKU.", "SKU_REQUIRED");
  const { prefix } = await prefixFor(client, context, settings, categoryId);
  const year = await yearOf(client);
  const key = sequenceKey(settings, prefix, year);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const value = (await client.query(
      `INSERT INTO tenant.item_sku_sequences (organization_id, sequence_key, next_value) VALUES ($1, $2, 2)
       ON CONFLICT (organization_id, sequence_key) DO UPDATE SET next_value = tenant.item_sku_sequences.next_value + 1, updated_at = now()
       RETURNING next_value - 1 AS value`, [context.organizationId, key])).rows[0].value;
    const sku = compose(settings, prefix, value, year);
    if (sku.length > SKU_MAX_LENGTH) throw new ProductError(409, "The generated SKU would be longer than 40 characters. Shorten the prefix.", "SKU_SEQUENCE_TOO_LONG");
    if (!(await taken(client, context, sku))) return { sku, reference: `${key}#${value}` };
  }
  throw new ProductError(409, "No free SKU was found for this prefix. Check the SKU numbering settings.", "SKU_SEQUENCE_EXHAUSTED");
}

// A typed SKU in "either" mode may not take the generated format of a prefix: those SKUs belong to the counter.
async function looksGenerated(client, context, settings, sku) {
  if (settings.sku_mode !== "either") return null;
  const prefixes = [settings.default_prefix, ...(settings.use_category_prefix
    ? (await client.query(`SELECT DISTINCT sku_prefix FROM tenant.item_groups WHERE organization_id = $1 AND sku_prefix IS NOT NULL`, [context.organizationId])).rows.map((row) => row.sku_prefix)
    : [])];
  const sep = settings.separator.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const year = settings.include_year ? `[0-9]{4}${sep}` : "";
  const match = prefixes.find((prefix) => new RegExp(`^${year}${prefix}${sep}[0-9]{${settings.padding}}$`).test(sku));
  return match ?? null;
}

// ------------------------------------------------------------------ availability

// Whether `value` can be an item's SKU: valid, not another item's, never another item's before. { sku, valid, problem, available,
// reason: "in_use" | "previous" | null, holder: { id, code, name } }.
export async function checkSkuAvailability(client, context, value, { exceptItemId = null } = {}) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const problem = skuProblem(value);
  const sku = normalizeSku(value);
  if (problem) return { sku, valid: false, problem, available: false, reason: null, holder: null };
  const except = isUuid(exceptItemId) ? exceptItemId : null;
  const current = (await client.query(`SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND normalized_sku = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [context.organizationId, sku, except])).rows[0];
  if (current) return { sku, valid: true, problem: null, available: false, reason: "in_use", holder: current };
  const previous = (await client.query(
    `SELECT item.id, item.code, item.name FROM tenant.item_sku_reservations reservation JOIN tenant.items item ON item.organization_id = reservation.organization_id AND item.id = reservation.item_id
      WHERE reservation.organization_id = $1 AND reservation.normalized_sku = $2 AND ($3::uuid IS NULL OR reservation.item_id <> $3)`, [context.organizationId, sku, except])).rows[0];
  if (previous) return { sku, valid: true, problem: null, available: false, reason: "previous", holder: previous };
  return { sku, valid: true, problem: null, available: true, reason: null, holder: null };
}

function unavailable(check, field = "code") {
  if (check.reason === "in_use") {
    const message = `SKU ${check.sku} already belongs to ${check.holder.name} (${check.holder.code}).`;
    return new ProductError(409, message, "PRODUCT_DUPLICATE", { issues: [{ field, message }] });
  }
  const message = `SKU ${check.sku} was used by ${check.holder.name} (now ${check.holder.code}) and is never reused for another item.`;
  return new ProductError(409, message, "SKU_RESERVED", { issues: [{ field, message }] });
}

// Several SKUs at once (an import file): each value's check, and those repeated in the list.
export async function bulkValidateSkus(client, context, values = []) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const seen = new Map();
  const results = [];
  for (const [index, value] of values.entries()) {
    const check = await checkSkuAvailability(client, context, value);
    const repeated = check.sku && seen.has(check.sku) ? seen.get(check.sku) : null;
    if (check.sku && !seen.has(check.sku)) seen.set(check.sku, index);
    results.push({ index, value, ...check, repeatedFrom: repeated });
  }
  return results;
}

// ------------------------------------------------------------------ the SKU of a new item

// Decides a new item's SKU by the numbering setting: { code, mode: "manual" } for a typed SKU (checked), or { generate: true }.
export async function resolveNewItemSku(client, context, code) {
  const settings = await settingsRow(client, context);
  if (code) {
    if (settings.sku_mode === "automatic") throw issue("code", "SKUs are generated automatically in this organization. Leave the SKU empty.", "SKU_MANUAL_NOT_ALLOWED");
    requireProductPermission(context, P.enterSku, "You do not have permission to enter SKUs by hand.");
    const sku = validateSku(code);
    const check = await checkSkuAvailability(client, context, sku);
    if (!check.available) throw unavailable(check);
    const prefix = await looksGenerated(client, context, settings, sku);
    if (prefix) throw issue("code", `${sku} has the format of generated ${prefix} SKUs, which is kept for automatic numbering. Leave the SKU empty to generate one, or use another code.`, "SKU_FORMAT_RESERVED");
    return { code: sku, mode: "manual" };
  }
  if (settings.sku_mode === "manual") throw issue("code", "Enter the SKU: this organization types its SKUs.", "SKU_REQUIRED");
  requireProductPermission(context, P.generateSku, "You do not have permission to generate SKUs.");
  return { generate: true };
}

// ------------------------------------------------------------------ changing a SKU

// Gives an item a new SKU: a correction of its code only — the item, its stock, batches, serials, prices and documents are unchanged,
// documents keep the SKU they were made with. The old SKU stays reserved for the item and findable. input: { sku, reason, expectedVersion }.
export async function changeItemSku(client, context, itemId, input = {}) {
  requireProductPermission(context, P.changeSku, "You do not have permission to change SKUs.");
  const settings = await settingsRow(client, context);
  if (!settings.allow_sku_changes) throw new ProductError(409, "SKU changes are switched off in the SKU numbering settings.", "SKU_CHANGES_DISABLED");
  const row = (await client.query(`SELECT id, code, name, version FROM tenant.items WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(itemId, "Item")])).rows[0];
  if (!row) throw new ProductError(404, "Item not found.", "PRODUCT_NOT_FOUND");
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this item after you opened it. Reload it and make your change again.", "PRODUCT_VERSION_CONFLICT");
  const sku = validateSku(input.sku ?? input.code);
  if (sku === normalizeSku(row.code)) throw issue("code", "That is already the item's SKU.", "SKU_UNCHANGED", 409);
  const check = await checkSkuAvailability(client, context, sku, { exceptItemId: row.id });
  if (!check.available) throw unavailable(check);
  const reason = text(input.reason).slice(0, 300) || null;
  await client.query("SAVEPOINT item_sku_change");
  try {
    await client.query(
      `UPDATE tenant.items SET code = $3, sku_generation_mode = 'manual', sku_sequence_reference = NULL, sku_changed_at = now(), sku_changed_by = $4, updated_by = $4,
              updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, sku, context.userId ?? null]);
    await client.query("RELEASE SAVEPOINT item_sku_change");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT item_sku_change");
    if (error?.code === "23505") throw issue("code", `SKU ${sku} was just given to another item.`, "PRODUCT_DUPLICATE", 409);
    throw error;
  }
  await client.query(
    `INSERT INTO tenant.item_sku_history (organization_id, item_id, old_sku, normalized_old_sku, new_sku, reason, changed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, row.id, row.code, normalizeSku(row.code), sku, reason, context.userId ?? null]);
  await recordProductHistory(client, context, row.id, "updated", `SKU changed from ${row.code} to ${sku}${reason ? `: ${reason}` : ""}`,
    { code: { label: "SKU", from: row.code, to: sku }, reason, kind: "sku_changed" });
  const { getProduct } = await import("./records.js");
  return getProduct(client, context, row.id);
}

// The SKUs the item had before, newest first.
export async function getSkuHistory(client, context, itemId) {
  requireProductPermission(context, P.viewSkuHistory, "You do not have permission to view SKU history.");
  const { rows } = await client.query(
    `SELECT history.id, history.old_sku, history.new_sku, history.reason, history.changed_at, actor.full_name AS changed_by_name
       FROM tenant.item_sku_history history LEFT JOIN public.users actor ON actor.id = history.changed_by
      WHERE history.organization_id = $1 AND history.item_id = $2 ORDER BY history.changed_at DESC, history.id DESC`, [context.organizationId, requireUuid(itemId, "Item")]);
  return rows.map((row) => ({ id: row.id, oldSku: row.old_sku, newSku: row.new_sku, reason: row.reason, changedAt: row.changed_at, changedByName: row.changed_by_name }));
}

// ------------------------------------------------------------------ finding an item by SKU

// The item whose SKU is `value`; failing that, the item that had it before ({ matchedBy: "previous_sku" }).
export async function findItemBySku(client, context, value) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const sku = normalizeSku(value);
  if (!sku) return null;
  const current = (await client.query(`SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND normalized_sku = $2`, [context.organizationId, sku])).rows[0];
  if (current) return { itemId: current.id, code: current.code, name: current.name, matchedBy: "sku" };
  return findItemByPreviousSku(client, context, sku);
}

export async function findItemByPreviousSku(client, context, value) {
  requireProductPermission(context, P.view, "You do not have permission to view items.");
  const sku = normalizeSku(value);
  if (!sku) return null;
  const row = (await client.query(
    `SELECT item.id, item.code, item.name, history.old_sku FROM tenant.item_sku_history history
       JOIN tenant.items item ON item.organization_id = history.organization_id AND item.id = history.item_id
      WHERE history.organization_id = $1 AND history.normalized_old_sku = $2 ORDER BY history.changed_at DESC LIMIT 1`, [context.organizationId, sku])).rows[0];
  return row ? { itemId: row.id, code: row.code, name: row.name, matchedBy: "previous_sku", previousSku: row.old_sku } : null;
}
