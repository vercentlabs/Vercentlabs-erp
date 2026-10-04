import { redirect } from "next/navigation";

import { requireWorkspace } from "@/core/session";

// The global "Create > Task": the task list with the new-task form open.
export default async function Page() {
  await requireWorkspace();
  redirect("/crm/tasks?new=1");
}
