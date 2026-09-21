import Link from "next/link";
import { hasSessionPermission } from "@vercentlabs/api";
import { Lock } from "lucide-react";

import { requireWorkspace } from "@/core/session";
import { SETTINGS_NAVIGATION } from "@/shell/navigation/settings-navigation-registry";

// Phase 6 (platform checkpoint D): a real, permission-aware settings
// index, replacing the generic PlatformFoundationPage placeholder for
// /settings specifically (that component is still used as-is for Work,
// Search, and other still-unbuilt global surfaces — this page earns a
// dedicated one now that two real sections exist to make discoverable).
// Every item is classified AVAILABLE or PLANNED against
// settings-navigation-registry.ts; a built-but-permission-gated item
// renders its own third state (UNAVAILABLE) inline. Only AVAILABLE items
// are ever a clickable Link — the same "never render a live link to
// something unbuilt" rule SecondarySidebar.tsx already enforces.
export async function SettingsIndexScreen() {
  const session = await requireWorkspace();

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        <p className="max-w-[640px] text-sm text-text-secondary">
          Organization, people, billing, and governance settings are being built out section by section. Account,
          Organization and People sections are live; Billing/integrations and Governance are planned and not yet
          reachable.
        </p>
      </div>

      {SETTINGS_NAVIGATION.map((section) => (
        <div key={section.id} className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{section.label}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => {
              const permitted = !item.requiredPermission || hasSessionPermission(session, item.requiredPermission);
              if (item.status === "AVAILABLE" && permitted) {
                return (
                  <Link
                    key={item.id}
                    href={item.route}
                    className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted"
                  >
                    <span className="text-sm font-medium text-text">{item.label}</span>
                    <span className="text-xs text-text-muted">{item.description}</span>
                  </Link>
                );
              }
              const lockedReason =
                item.status === "PLANNED" ? "Planned, not available yet" : "Needs additional permission";
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface-muted p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-secondary">{item.label}</span>
                    <Lock aria-hidden="true" className="size-3.5 shrink-0 text-text-secondary" />
                  </div>
                  <span className="text-xs text-text-secondary">{item.description}</span>
                  <span className="text-xs font-medium text-text-secondary">{lockedReason}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
