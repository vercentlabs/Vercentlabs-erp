// F305 gap closure — account-mapping configuration. Reuses Accounting's
// own real getAccountingSettings/getAccountingOptions/upsertAccountMapping
// functions (services/api/src/modules/accounting/setup.js) through its
// public contract; this file is a thin, POS-scoped wrapper around them, not
// a second mapping table or a duplicated business rule. Accounting itself
// has NO frontend anywhere in this app yet (confirmed: `/accounting` still
// renders the generic ModuleFoundationPage placeholder, and no
// `/api/accounting/**` route exists at all) — building Accounting's own
// settings section is a whole separate, out-of-scope undertaking, so this
// screen lives on the POS side (POS is the actual, immediate consumer
// blocked without it) and is explicitly disclosed as such, per the task's
// own "the correct owning module OR an appropriate POS configuration
// interface" allowance.
import { getAccountingSettings, getAccountingOptions, upsertAccountMapping } from "../../accounting/index.js";
import { requirePermission } from "../shared/access-control.js";
import { posAccountingContext } from "../shared/accounting-bridge.js";

// The exact mapping_key vocabulary accounting-posting.js resolves.
// "seeded" keys come pre-provisioned for every company by Accounting's own
// foundation.js (zero POS-specific configuration ever needed); the rest
// are genuinely new, POS-specific concepts requiring one-time setup here.
export const POS_MAPPING_KEYS = Object.freeze([
  { key: "cash", label: "Cash tender", description: "Cash sales/refunds — pre-seeded for every company.", seeded: true },
  { key: "bank", label: "Bank-transfer tender", description: "Bank-transfer sales/refunds — pre-seeded for every company.", seeded: true },
  { key: "revenue", label: "Revenue", description: "Sales revenue recognition — pre-seeded, shared with Sales' own invoices.", seeded: true },
  { key: "output_tax", label: "Output tax", description: "Tax collected on sales — pre-seeded, shared with Sales.", seeded: true },
  { key: "rounding", label: "Rounding", description: "Rounding differences — pre-seeded, shared with Sales.", seeded: true },
  { key: "cogs", label: "Cost of goods sold", description: "COGS on tracked-inventory sales — pre-seeded, shared with Sales.", seeded: true },
  { key: "inventory", label: "Inventory relief", description: "Inventory asset relief on a sale's COGS — POS-specific, needs configuration.", seeded: false },
  { key: "pos_card_clearing", label: "Card tender clearing", description: "Card sales awaiting provider settlement — POS-specific, needs configuration.", seeded: false },
  { key: "pos_upi_clearing", label: "UPI tender clearing", description: "UPI sales awaiting provider settlement — POS-specific, needs configuration.", seeded: false },
  { key: "pos_wallet_clearing", label: "Wallet tender clearing", description: "Wallet sales awaiting provider settlement — POS-specific, needs configuration.", seeded: false },
  { key: "pos_store_credit_liability", label: "Store credit liability", description: "Store-credit tender — POS-specific, needs configuration.", seeded: false },
  { key: "pos_loyalty_liability", label: "Loyalty points liability", description: "Deferred revenue for unredeemed loyalty points — POS-specific, needs configuration if loyalty is in use.", seeded: false },
  { key: "pos_loyalty_program_expense", label: "Loyalty program expense", description: "Loyalty points accrual expense — POS-specific, needs configuration if loyalty is in use.", seeded: false },
]);

export async function getPosAccountingMappingConfig(client, context) {
  requirePermission(context, "pos.settings.manage");
  const accountingContext = posAccountingContext(context);
  const [settings, options] = await Promise.all([
    getAccountingSettings(client, accountingContext),
    getAccountingOptions(client, accountingContext),
  ]);
  const mappingsByKey = new Map();
  for (const mapping of settings.mappings) {
    // Only the ledger-wide default row (no branch/party/item/item_group/
    // tax_category override) is what this screen configures — a more
    // specific override is an advanced case still only reachable through
    // Accounting's own raw API, not hidden, just not this screen's job.
    if (!mapping.branch_id && !mapping.party_id && !mapping.item_id && !mapping.item_group_id && !mapping.tax_category_id && mapping.status === "active") {
      if (!mappingsByKey.has(mapping.mapping_key)) mappingsByKey.set(mapping.mapping_key, mapping);
    }
  }
  const primaryLedger = options.ledgers.find((ledger) => ledger.ledger_type === "primary") || options.ledgers[0] || null;
  return {
    ledger: primaryLedger,
    accounts: options.accounts.filter((account) => !account.is_group),
    mappings: POS_MAPPING_KEYS.map((entry) => ({
      ...entry,
      configured: mappingsByKey.has(entry.key),
      accountId: mappingsByKey.get(entry.key)?.account_id ?? null,
      accountCode: mappingsByKey.get(entry.key)?.account_code ?? null,
      accountName: mappingsByKey.get(entry.key)?.account_name ?? null,
    })),
  };
}

export async function upsertPosAccountingMapping(client, context, input = {}) {
  requirePermission(context, "pos.settings.manage");
  const mappingKey = String(input.mappingKey || "");
  if (!POS_MAPPING_KEYS.some((entry) => entry.key === mappingKey)) {
    const error = new Error(`${mappingKey} is not a recognized POS accounting mapping key.`);
    error.status = 400;
    error.code = "POS_ACCOUNTING_MAPPING_KEY_INVALID";
    throw error;
  }
  const accountingContext = posAccountingContext(context);
  const options = await getAccountingOptions(client, accountingContext);
  const primaryLedger = options.ledgers.find((ledger) => ledger.ledger_type === "primary") || options.ledgers[0];
  if (!primaryLedger) {
    const error = new Error("No active Accounting ledger exists for this company yet.");
    error.status = 409;
    error.code = "POS_ACCOUNTING_LEDGER_MISSING";
    throw error;
  }
  // upsertAccountMapping (Accounting's own setup.js) is a plain INSERT, not
  // a true upsert -- calling it twice for the same ledger-wide default key
  // would leave two active rows for getAccountMapping's own resolver to
  // pick between non-deterministically. Re-pointing an existing mapping to
  // a different account is a real, expected "save/reload" action for this
  // screen, so the previous ledger-wide default (if any) is deactivated in
  // the same statement first -- a minimal, precedent-following use of the
  // table's own existing status column, not a second business rule.
  await client.query(
    `UPDATE tenant.accounting_account_mappings
        SET status='inactive',updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND mapping_key=$4
        AND branch_id IS NULL AND party_id IS NULL AND item_id IS NULL AND item_group_id IS NULL AND tax_category_id IS NULL
        AND status='active'`,
    [context.organizationId, context.companyId, primaryLedger.id, mappingKey, context.userId],
  );
  return upsertAccountMapping(client, accountingContext, {
    ledgerId: primaryLedger.id,
    mappingKey,
    accountId: input.accountId,
  });
}
