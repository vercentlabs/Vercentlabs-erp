import { redirect } from "next/navigation";

import { requireWorkspace } from "@/core/session";

// The global "Create > Follow-up": the follow-up list with the schedule form open.
export default async function Page() {
  await requireWorkspace();
  redirect("/crm/follow-ups?new=1");
}
