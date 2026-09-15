import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { ApprovalsClient } from "./approvals-client";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const session = await requireWorkspace();
  if (!hasSessionPermission(session, "approvals.manage")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-text">
          Approvals isn&apos;t available
        </h1>
        <p className="max-w-[420px] text-sm text-text-secondary">
          You don&apos;t have permission to open Approvals. Ask an administrator
          to grant it.
        </p>
      </div>
    );
  }
  return <ApprovalsClient />;
}
