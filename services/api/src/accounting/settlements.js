import {
  AccountingError,
  asDatabaseDecimal,
  decimal,
  getAccountMapping,
  getCurrencyPrecision,
  loadCompany,
  toBaseAmount,
} from "./core.js";
import { createJournalEntry, postJournalEntry } from "./journals.js";

async function generalJournal(client, context, companyId, ledgerId) {
  const result = await client.query(
    `SELECT id FROM tenant.accounting_journals
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3
        AND journal_type='general' AND status='active'
      ORDER BY created_at LIMIT 1`,
    [context.organizationId, companyId, ledgerId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "A General accounting journal is required for settlement adjustments.");
  return result.rows[0].id;
}

async function postAdjustment(client, context, source, lines) {
  if (!lines.length) return null;
  const company = await loadCompany(client, context, source.companyId);
  const journalId = await generalJournal(client, context, company.id, source.ledgerId);
  const entry = await createJournalEntry(client, context, {
    companyId: company.id,
    branchId: source.branchId,
    ledgerId: source.ledgerId,
    journalId,
    entryDate: source.accountingDate,
    accountingDate: source.accountingDate,
    entryType: "allocation",
    reference: source.reference,
    description: source.description,
    currencyCode: company.base_currency,
    exchangeRate: 1,
    lines,
  }, {
    internal: true,
    sourceModule: "accounting",
    sourceType: source.sourceType,
    sourceId: source.allocationId,
    sourceNumber: source.reference,
  });
  await postJournalEntry(client, context, entry.entry.id, { internal: true, allowDraft: true });
  return entry.entry.id;
}

export async function calculateSettlementBaseAmounts(client, context, input) {
  const company = await loadCompany(client, context, input.companyId);
  const precision = await getCurrencyPrecision(client, context, company.base_currency);
  return {
    baseSourceAmount: toBaseAmount(input.sourceAmount, input.sourceExchangeRate, precision),
    baseDocumentAmount: toBaseAmount(input.documentAmount, input.documentExchangeRate, precision),
    baseAdjustmentAmount: toBaseAmount(input.adjustmentAmount || 0, input.documentExchangeRate, precision),
    functionalCurrencyCode: company.base_currency,
  };
}

export async function createCustomerSettlementAdjustment(client, context, input) {
  const base = await calculateSettlementBaseAmounts(client, context, input);
  const receivable = await getAccountMapping(client, context, input.companyId, input.ledgerId, "receivable", {
    partyId: input.partyId,
    date: input.accountingDate,
    branchId: input.branchId,
  });
  const lines = [];
  const adjustment = decimal(base.baseAdjustmentAmount);
  if (adjustment > 0n) {
    const writeoff = await getAccountMapping(client, context, input.companyId, input.ledgerId, "writeoff", {
      partyId: input.partyId,
      date: input.accountingDate,
      branchId: input.branchId,
    });
    lines.push({ accountId: writeoff.account_id, description: `Settlement adjustment ${input.reference}`, debit: asDatabaseDecimal(adjustment), credit: 0 });
    lines.push({ accountId: receivable.account_id, partyId: input.partyId, description: `Receivable settlement ${input.reference}`, debit: 0, credit: asDatabaseDecimal(adjustment) });
  }
  const fxDifference = decimal(base.baseDocumentAmount) - decimal(base.baseSourceAmount);
  if (fxDifference > 0n) {
    const loss = await getAccountMapping(client, context, input.companyId, input.ledgerId, "realized_fx_loss", { date: input.accountingDate });
    lines.push({ accountId: loss.account_id, description: `Realized FX loss ${input.reference}`, debit: asDatabaseDecimal(fxDifference), credit: 0 });
    lines.push({ accountId: receivable.account_id, partyId: input.partyId, description: `Receivable FX settlement ${input.reference}`, debit: 0, credit: asDatabaseDecimal(fxDifference) });
  } else if (fxDifference < 0n) {
    const gain = await getAccountMapping(client, context, input.companyId, input.ledgerId, "realized_fx_gain", { date: input.accountingDate });
    const amount = -fxDifference;
    lines.push({ accountId: receivable.account_id, partyId: input.partyId, description: `Receivable FX settlement ${input.reference}`, debit: asDatabaseDecimal(amount), credit: 0 });
    lines.push({ accountId: gain.account_id, description: `Realized FX gain ${input.reference}`, debit: 0, credit: asDatabaseDecimal(amount) });
  }
  return {
    ...base,
    realizedGainLoss: asDatabaseDecimal(fxDifference),
    journalEntryId: await postAdjustment(client, context, {
      ...input,
      description: `Customer settlement adjustment for ${input.reference}`,
      sourceType: "customer_receipt_allocation",
    }, lines),
  };
}

export async function createVendorSettlementAdjustment(client, context, input) {
  const base = await calculateSettlementBaseAmounts(client, context, input);
  const payable = await getAccountMapping(client, context, input.companyId, input.ledgerId, "payable", {
    partyId: input.partyId,
    date: input.accountingDate,
    branchId: input.branchId,
  });
  const lines = [];
  const adjustment = decimal(base.baseAdjustmentAmount);
  if (adjustment > 0n) {
    const discount = await getAccountMapping(client, context, input.companyId, input.ledgerId, "purchase_discount", {
      partyId: input.partyId,
      date: input.accountingDate,
      branchId: input.branchId,
    });
    lines.push({ accountId: payable.account_id, partyId: input.partyId, description: `Payable settlement ${input.reference}`, debit: asDatabaseDecimal(adjustment), credit: 0 });
    lines.push({ accountId: discount.account_id, description: `Supplier settlement gain ${input.reference}`, debit: 0, credit: asDatabaseDecimal(adjustment) });
  }
  const fxDifference = decimal(base.baseSourceAmount) - decimal(base.baseDocumentAmount);
  if (fxDifference > 0n) {
    const loss = await getAccountMapping(client, context, input.companyId, input.ledgerId, "realized_fx_loss", { date: input.accountingDate });
    lines.push({ accountId: loss.account_id, description: `Realized FX loss ${input.reference}`, debit: asDatabaseDecimal(fxDifference), credit: 0 });
    lines.push({ accountId: payable.account_id, partyId: input.partyId, description: `Payable FX settlement ${input.reference}`, debit: 0, credit: asDatabaseDecimal(fxDifference) });
  } else if (fxDifference < 0n) {
    const gain = await getAccountMapping(client, context, input.companyId, input.ledgerId, "realized_fx_gain", { date: input.accountingDate });
    const amount = -fxDifference;
    lines.push({ accountId: payable.account_id, partyId: input.partyId, description: `Payable FX settlement ${input.reference}`, debit: asDatabaseDecimal(amount), credit: 0 });
    lines.push({ accountId: gain.account_id, description: `Realized FX gain ${input.reference}`, debit: 0, credit: asDatabaseDecimal(amount) });
  }
  return {
    ...base,
    realizedGainLoss: asDatabaseDecimal(fxDifference),
    journalEntryId: await postAdjustment(client, context, {
      ...input,
      description: `Vendor settlement adjustment for ${input.reference}`,
      sourceType: "vendor_payment_allocation",
    }, lines),
  };
}
