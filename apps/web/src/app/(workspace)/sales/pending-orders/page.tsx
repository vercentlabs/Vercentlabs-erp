import { redirect } from "next/navigation";

// Pending Orders is now the order list's To deliver view (Sales report, N6); its old links keep working.
export default function Page() {
  redirect("/sales/orders?view=to_dispatch");
}
