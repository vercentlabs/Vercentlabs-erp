import { redirect } from "next/navigation";

// Supplier quotations moved to Buy › RFQs & Quotations (Procurement plan Phase 2); this address keeps working.
export default function Page() {
  redirect("/procurement/rfqs?view=quotations");
}
