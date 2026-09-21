"use client";

import { REGISTERS } from "@/features/accounting/configs-all";
import { AccountingDashboardScreen } from "@/features/accounting/screens/DashboardScreen";
import { DocumentBuilder } from "@/features/accounting/screens/DocumentBuilder";
import { REPORTS, ReportScreen } from "@/features/accounting/screens/ReportScreen";
import { SettlementScreen } from "@/features/accounting/screens/SettlementScreen";
import { Register } from "@/features/accounting/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function AccountingPage({ name }: { name: string }) {
  if (name === "journal-new") return <DocumentBuilder kind="journal" />;
  if (name === "invoice-new") return <DocumentBuilder kind="invoice" />;
  if (name === "bill-new") return <DocumentBuilder kind="bill" />;
  if (name === "receipts") return <SettlementScreen side="receipt" />;
  if (name === "payments") return <SettlementScreen side="payment" />;
  if (name in REPORTS) return <ReportScreen name={name} />;
  const config = REGISTERS[name];
  if (!config) return null;
  return <Register config={config} />;
}

export { AccountingDashboardScreen };
