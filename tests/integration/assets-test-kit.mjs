// Shared setup for the Assets real-PostgreSQL tests. It reuses the Accounting world (organization,
// company, users with explicit permission sets, and a fully initialized ledger) because the Assets desk
// hands every financial event to Accounting; the asset-specific pieces are added on top.
import { buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

export { connectAdmin };

export const MANAGER = ["assets.view", "assets.manage", "assets.create", "assets.assign", "assets.transfer", "assets.maintain", "assets.inspect", "assets.settings.manage"];
export const ACCOUNTANT = ["assets.view", "assets.capitalize", "assets.depreciate", "assets.dispose", "assets.accounting.handoff", "assets.reports.view", "assets.audit.view"];

export async function buildAssetsWorld(admin, roles, tag) {
  const w = await buildAccountingWorld(admin, roles, tag);
  const acc = async (code) => (await w.account(code)).id;
  const accounts = {
    asset: await acc("1500"), accumulated: await acc("1590"), expense: await acc("6300"), gainLoss: await acc("4900"),
    clearing: await acc("2900"), reserve: await acc("3100"), impairment: await acc("6500"), proceeds: await acc("1120"),
  };
  const categoryInput = (over = {}) => ({
    code: `CAT${Math.random().toString(36).slice(2, 7)}`.toUpperCase(), name: "Equipment", usefulLifeMonths: 12, depreciationMethod: "straight_line",
    assetAccountId: accounts.asset, accumulatedDepreciationAccountId: accounts.accumulated, depreciationExpenseAccountId: accounts.expense,
    gainLossAccountId: accounts.gainLoss, clearingAccountId: accounts.clearing, revaluationReserveAccountId: accounts.reserve,
    impairmentLossAccountId: accounts.impairment, proceedsAccountId: accounts.proceeds, ...over,
  });
  return { ...w, accounts, categoryInput };
}
