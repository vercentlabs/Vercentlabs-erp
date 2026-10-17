import { redirect } from "next/navigation";

// The navigation's route for this workspace view: it opens the existing workspace on that view.
export default function Page() {
  redirect("/assets/depreciation?view=runs");
}
