import { Suspense } from "react";

import { StatementImportScreen } from "@/features/accounting/banking/screens/StatementImportScreen";

export const metadata = { title: "Import bank statement" };

// Suspense: the import reads the account to prefill from the URL ("Import statement" on an account).
export default function ImportStatementPage() {
  return <Suspense><StatementImportScreen /></Suspense>;
}
