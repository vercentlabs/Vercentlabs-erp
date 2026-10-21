import { redirect } from "next/navigation";

// Order Status is now Pending Orders › All open orders (Sales audit: one place for "where is my order").
export default function Page() {
  redirect("/sales/pending-orders?report=order-status");
}
