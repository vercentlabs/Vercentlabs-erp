import { redirect } from "next/navigation";

// Item numbering is a section of Inventory Settings.
export default function Page() {
  redirect("/inventory/settings?section=item-numbering");
}
