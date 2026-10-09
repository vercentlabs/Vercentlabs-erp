import { redirect } from "next/navigation";

// Stock adjustment reasons are one of Inventory Configuration's reason codes.
export default function Page() {
  redirect("/inventory/settings?section=reasons&reason=adjustment");
}
