import { AlertTriangle, Construction } from "lucide-react";

import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";

const REASON_COPY: Record<string, string> = {
  not_released: "This module is not yet available.",
  disabled:
    "This module is not enabled for your organisation. Ask an administrator to enable it in Settings.",
  not_entitled:
    "This module is not included in your current plan. Ask a billing owner to upgrade.",
  not_permitted:
    "You don't have permission to open this module. Ask an administrator to grant it.",
};

// Every module route (and Work/Approvals/Notifications/Jobs/Search's own
// pages) renders through this one honest foundation surface until its own
// prompt builds the real screen — Phase 6/8's "no dead links, status must
// be explicit" requirement. It never fabricates data: no fake record
// counts, no placeholder tables.
export async function ModuleFoundationPage({
  moduleKey,
  moduleLabel,
  nextPromptNote,
}: {
  moduleKey: string;
  moduleLabel: string;
  nextPromptNote?: string;
}) {
  const { accessibleModules } = await resolveWorkspaceContext();
  const access = accessibleModules.find(
    (entry) => entry.moduleId === moduleKey,
  );

  if (!access?.accessible) {
    const reason = access?.reason
      ? REASON_COPY[access.reason]
      : "This module is unavailable.";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <AlertTriangle aria-hidden="true" className="size-8 text-text-muted" />
        <h1 className="text-lg font-semibold text-text">
          {moduleLabel} isn&apos;t available
        </h1>
        <p className="max-w-[420px] text-sm text-text-secondary">{reason}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Construction aria-hidden="true" className="size-8 text-text-muted" />
      <h1 className="text-lg font-semibold text-text">{moduleLabel}</h1>
      <p className="max-w-[420px] text-sm text-text-secondary">
        You have access to {moduleLabel}. Its screens are being built module by
        module.
        {nextPromptNote ? ` ${nextPromptNote}` : ""}
      </p>
    </div>
  );
}
