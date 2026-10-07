import { redirect } from "next/navigation";

// The receiving issue queue lives under Goods Receipts.
export default function Page() {
  redirect("/procurement/goods-receipts?view=receiving-issues");
}
