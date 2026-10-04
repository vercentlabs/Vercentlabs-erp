import { redirect } from "next/navigation";

// Duplicate review lives under Data Quality; the old address keeps working.
export default function Page() {
  redirect("/crm/data-quality");
}
