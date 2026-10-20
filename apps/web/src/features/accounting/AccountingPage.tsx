"use client";

import { Suspense } from "react";

import { ExpensesScreen } from "@/features/accounting/expenses/screens/ExpensesScreen";
import { BankAccountsScreen } from "@/features/accounting/banking/screens/BankAccountsScreen";
import { BankStatementsScreen } from "@/features/accounting/banking/screens/BankStatementsScreen";
import { FundTransfersScreen } from "@/features/accounting/banking/screens/FundTransfersScreen";
import { InputTaxCreditScreen } from "@/features/accounting/automatic/screens/InputTaxCreditScreen";
import { GeneralLedgerScreen } from "@/features/accounting/journals/screens/GeneralLedgerScreen";
import { AgingScreen } from "@/features/accounting/ledgers/screens/AgingScreen";
import { PayableBillsScreen } from "@/features/accounting/payables/screens/PayableBillsScreen";
import { PaymentsScreen } from "@/features/accounting/payables/screens/PaymentsScreen";
import { ReceivableInvoicesScreen } from "@/features/accounting/receivables/screens/ReceivableInvoicesScreen";
import { ReceiptsScreen } from "@/features/accounting/receivables/screens/ReceiptsScreen";
import { JournalFormScreen } from "@/features/accounting/journals/screens/JournalFormScreen";
import { JournalsScreen } from "@/features/accounting/journals/screens/JournalsScreen";
import { OpeningBalancesScreen } from "@/features/accounting/automatic/screens/OpeningBalancesScreen";
import { PostingAccountsScreen } from "@/features/accounting/automatic/screens/PostingAccountsScreen";
import { PostingsScreen } from "@/features/accounting/automatic/screens/PostingsScreen";
import { ChartOfAccountsScreen } from "@/features/accounting/foundation/screens/ChartOfAccountsScreen";
import { FiscalYearsScreen } from "@/features/accounting/foundation/screens/FiscalYearsScreen";
import { BalanceSheetScreen } from "@/features/accounting/statements/screens/BalanceSheetScreen";
import { CashFlowScreen } from "@/features/accounting/statements/screens/CashFlowScreen";
import { ProfitLossScreen } from "@/features/accounting/statements/screens/ProfitLossScreen";
import { TrialBalanceScreen } from "@/features/accounting/statements/screens/TrialBalanceScreen";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function AccountingPage({ name }: { name: string }) {
  // Finance foundation: the chart and the financial years.
  if (name === "chart-of-accounts") return <ChartOfAccountsScreen />;
  if (name === "fiscal-periods") return <FiscalYearsScreen />;
  // Journals and the General Ledger.
  if (name === "journals") return <JournalsScreen />;
  if (name === "journal-new") return <JournalFormScreen />;
  if (name === "general-ledger") return <GeneralLedgerScreen />;
  // Receivables.
  if (name === "customer-invoices") return <Suspense><ReceivableInvoicesScreen /></Suspense>;
  if (name === "receipts") return <ReceiptsScreen />;
  if (name === "receivables-aging") return <AgingScreen side="receivable" />;
  // Payables.
  if (name === "supplier-invoices") return <Suspense><PayableBillsScreen /></Suspense>;
  if (name === "payments") return <PaymentsScreen />;
  if (name === "payables-aging") return <AgingScreen side="payable" />;
  // Expenses.
  if (name === "expenses") return <ExpensesScreen />;
  // Banking.
  if (name === "bank-accounts") return <BankAccountsScreen />;
  if (name === "reconciliation") return <BankStatementsScreen />;
  if (name === "fund-transfers") return <FundTransfersScreen />;
  // Automatic Accounting Posting.
  if (name === "postings") return <PostingsScreen />;
  if (name === "opening-balances") return <OpeningBalancesScreen />;
  if (name === "input-tax-credit") return <InputTaxCreditScreen />;
  if (name === "settings") return <PostingAccountsScreen />;
  // Financial statements.
  if (name === "trial-balance") return <TrialBalanceScreen />;
  if (name === "profit-loss") return <ProfitLossScreen />;
  if (name === "balance-sheet") return <BalanceSheetScreen />;
  if (name === "cash-flow") return <CashFlowScreen />;
  return null;
}

