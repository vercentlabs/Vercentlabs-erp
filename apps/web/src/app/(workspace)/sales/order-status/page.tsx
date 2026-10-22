import { redirect } from "next/navigation";

// Order Status is now Reports › Orders › Order status (Sales plan: one Reports page).
export default function Page() {
  redirect("/sales/reports?tab=orders&report=order-status");
}
