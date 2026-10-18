"use client";

// Money totals across deals are in the organization's base currency. A deal in a currency with no exchange rate is not added
// at face value: it is left out of the totals, and this notice says so (and where rates are kept).
import Link from "next/link";

import { Notice } from "@/shared/ui/Panel";

export type CurrencyDisclosure = { reportingCurrency: string | null; unconvertedCount: number; unconvertedCurrencies: string[] };

export function UnconvertedNotice({ currency, className }: { currency: CurrencyDisclosure | null | undefined; className?: string }) {
  if (!currency || currency.unconvertedCount === 0) return null;
  const deals = currency.unconvertedCount === 1 ? "1 deal is" : `${currency.unconvertedCount} deals are`;
  const codes = currency.unconvertedCurrencies.length ? ` in ${currency.unconvertedCurrencies.join(", ")}` : "";
  return (
    <Notice tone="warning" className={className}>
      {deals} left out of these totals: there is no exchange rate{codes} to {currency.reportingCurrency ?? "the base currency"}.{" "}
      <Link className="font-medium underline" href="/settings/finance-commercial/exchange-rates">Add an exchange rate</Link>
    </Notice>
  );
}
