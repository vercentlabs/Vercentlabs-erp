"use client";

import type { ReactNode } from "react";

import { Dialog } from "@/shared/design";

/**
 * Lead-specific compatibility wrapper around the canonical ERP Dialog.
 * The shared primitive owns focus trapping, Escape, background inert state,
 * scroll locking and focus restoration for every CRM drawer.
 */
export default function LeadWorkspaceDrawer({
  title,
  description,
  children,
  onClose,
  width = "wide",
  canDismiss = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  width?: "form" | "wide";
  canDismiss?: boolean;
}) {
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      variant="drawer-end"
      canDismiss={canDismiss}
      busy={!canDismiss}
      className={`crm-lead-drawer crm-lead-drawer--${width}`}
    >
      <div className="crm-lead-drawer-body">{children}</div>
    </Dialog>
  );
}
