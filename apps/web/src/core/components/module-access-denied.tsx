import Link from "next/link";

import AppIcon from "@/shared/components/app-icon";
import type { ModuleAccessReason } from "@/core/module-access";

const COPY: Record<ModuleAccessReason, { title: string; body: string }> = {
  not_released: {
    title: "not yet available",
    body: "This module is on the product roadmap and isn't available yet.",
  },
  disabled: {
    title: "disabled for this workspace",
    body: "An administrator has disabled this module for your organisation. Ask an administrator to re-enable it if you believe this is unexpected.",
  },
  not_entitled: {
    title: "not included in your plan",
    body: "Your organisation's current subscription plan doesn't include this module. An administrator can upgrade the plan from Billing.",
  },
  not_permitted: {
    title: "restricted",
    body: "You don't have permission to access this module. Ask an administrator to grant you a role with access.",
  },
};

// The page-level counterpart to the API layer's HttpError/MODULE_* codes
// (Prompt 5) — same four reasons, rendered instead of thrown, since a
// route-group layout returns JSX, not an HTTP response. Deliberately
// minimal per Part 10 ("do not design elaborate upgrade screens yet") —
// reuses the existing .empty-state pattern (globals.css) rather than
// introducing a parallel set of denial-specific styles.
export default function ModuleAccessDenied({
  moduleName,
  reason,
}: {
  moduleName: string;
  reason: ModuleAccessReason;
}) {
  const copy = COPY[reason];
  return (
    <div className="empty-state module-access-denied">
      <span className="empty-state-icon module-access-denied-icon" aria-hidden="true">
        <AppIcon name="security" size={20} />
      </span>
      <h1>
        {moduleName} is {copy.title}
      </h1>
      <p>{copy.body}</p>
      <Link className="module-access-denied-action" href="/dashboard">
        Back to Home
      </Link>
    </div>
  );
}
