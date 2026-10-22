import { redirect } from "next/navigation";

// Salesperson Performance is now Masters › Salespeople & Targets (Sales plan).
export default function Page() {
  redirect("/sales/team");
}
