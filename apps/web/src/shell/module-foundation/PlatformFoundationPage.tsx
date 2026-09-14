import { hasSessionPermission } from "@vercentlabs/api";
import { AlertTriangle, Construction } from "lucide-react";

import { requireWorkspace } from "@/core/session";

// Same honest-foundation pattern as ModuleFoundationPage, for the global
// (non-module) shell surfaces — Work, Approvals, Notifications, Background
// Jobs, Search, Settings. Gated by permission rather than module
// entitlement where a permission is required.
export async function PlatformFoundationPage({
  label,
  requiredPermission,
  description,
}: {
  label: string;
  requiredPermission?: string;
  description?: string;
}) {
  const session = await requireWorkspace();

  if (
    requiredPermission &&
    !hasSessionPermission(session, requiredPermission)
  ) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <AlertTriangle aria-hidden="true" className="size-8 text-text-muted" />
        <h1 className="text-lg font-semibold text-text">
          {label} isn&apos;t available
        </h1>
        <p className="max-w-[420px] text-sm text-text-secondary">
          You don&apos;t have permission to open {label}. Ask an administrator
          to grant it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Construction aria-hidden="true" className="size-8 text-text-muted" />
      <h1 className="text-lg font-semibold text-text">{label}</h1>
      <p className="max-w-[420px] text-sm text-text-secondary">
        {description || `${label} is being connected to its backing API.`}
      </p>
    </div>
  );
}
