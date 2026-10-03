import {
  getAccountingDashboard,
  getAccountingOptions,
  getAccountingReport,
  getAccountingSettings,
  getBankStatement,
  getCustomerInvoice,
  getJournalEntry,
  getPeriodCloseBlockers,
  getVendorBill,
  listBankAccounts,
  listBankStatements,
  listCustomerInvoices,
  listFiscalPeriods,
  listJournalEntries,
  listVendorBills,
  suggestBankMatches,
  listCloseRuns,
  getCloseRun,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Rec = Record<string, unknown>;
const named = (rows: Rec[], name: (row: Rec) => string) =>
  rows.map((row) => ({
    id: String(row.id),
    code: String(row.code ?? ""),
    name: name(row),
  }));
const ofType = (rows: Rec[], ...types: string[]) =>
  rows.filter((row) => types.includes(String(row.party_type)));

// One read endpoint per Accounting screen, gated by accounting.view (module-wide); every domain function
// re-checks its OWN permission (the reports need accounting.reports.view, for instance).
export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return accountingRead(
    request,
    async (client, context) => {
      switch (kind) {
        case "options": {
          const o = (await getAccountingOptions(
            client,
            context,
          )) as unknown as Record<string, Rec[]>;
          return {
            options: {
              accounts: named(o.accounts, (r) => String(r.name)),
              postingAccounts: named(
                o.accounts.filter(
                  (r) => !r.is_group && r.allow_manual_posting !== false,
                ),
                (r) => String(r.name),
              ),
              journals: named(o.journals, (r) => String(r.name)),
              customers: named(ofType(o.parties, "customer", "both"), (r) =>
                String(r.display_name),
              ),
              suppliers: named(ofType(o.parties, "supplier", "both"), (r) =>
                String(r.display_name),
              ),
              bankAccounts: named(
                o.bankAccounts,
                (r) => `${r.bank_name} - ${r.account_name}`,
              ),
              periods: named(o.periods, (r) => `${r.name} (${r.status})`),
            },
          };
        }
        case "settings":
          return {
            settings: await getAccountingSettings(
              client,
              context,
            ),
          };
        case "dashboard":
          return { dashboard: await getAccountingDashboard(client, context) };
        case "accounts":
          return {
            rows: (
              (await getAccountingOptions(
                client,
                context,
              )) as unknown as { accounts: unknown[] }
            ).accounts,
          };
        case "journals":
          return {
            rows: await listJournalEntries(client, context, {
              status: get("status"),
              search: get("search"),
            }),
          };
        case "journal":
          return {
            journal: await getJournalEntry(client, context, get("id") ?? ""),
          };
        case "customer-invoices":
          return {
            rows: await listCustomerInvoices(client, context, {
              status: get("status"),
            }),
          };
        case "customer-invoice":
          return {
            invoice: await getCustomerInvoice(client, context, get("id") ?? ""),
          };
        case "vendor-bills":
          return {
            rows: await listVendorBills(client, context, {
              status: get("status"),
            }),
          };
        case "vendor-bill":
          return {
            bill: await getVendorBill(client, context, get("id") ?? ""),
          };
        case "bank-accounts":
          return { rows: await listBankAccounts(client, context) };
        case "bank-statements":
          return {
            rows: await listBankStatements(client, context, {
              status: get("status"),
              bankAccountId: get("bankAccountId"),
            }),
          };
        case "bank-statement":
          return {
            statement: await getBankStatement(client, context, get("id") ?? ""),
          };
        case "bank-suggestions":
          return {
            rows: await suggestBankMatches(
              client,
              context,
              get("lineId") ?? "",
            ),
          };
        case "fiscal-periods":
          return { rows: await listFiscalPeriods(client, context) };
        case "period-blockers":
          return {
            blockers: await getPeriodCloseBlockers(
              client,
              context,
              get("periodId") ?? "",
            ),
          };
        case "close-runs":
          return { rows: await listCloseRuns(client, context) };
        case "close-run":
          return { run: await getCloseRun(client, context, get("id") ?? "") };
        case "report":
          return {
            report: await getAccountingReport(
              client,
              context,
              get("key") ?? "",
              {
                from: get("from"),
                to: get("to"),
                asOf: get("asOf"),
                accountId: get("accountId"),
                partyId: get("partyId"),
              },
            ),
          };
        default:
          throw new HttpError(404, "Unknown Accounting view.");
      }
    },
    "accounting.view",
  );
}
