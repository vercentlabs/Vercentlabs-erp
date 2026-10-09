import { redirect } from "next/navigation";

// Goods issue reasons are one of Inventory Configuration's reason codes.
export default function Page() {
  redirect("/inventory/settings?section=reasons&reason=goods-issue");
}
