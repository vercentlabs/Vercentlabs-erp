import Link from "next/link";
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
  quickLinks,
}: {
  label: string;
  requiredPermission?: string;
  description?: string;
  // For a foundation surface with at least one real sub-page already
  // built (e.g. Settings > Profile) — surfaces it instead of leaving the
  // one working destination reachable only by typing its URL directly.
  quickLinks?: { href: string; label: string }[];
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
      {quickLinks && quickLinks.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm font-medium text-brand hover:bg-surface-muted"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
