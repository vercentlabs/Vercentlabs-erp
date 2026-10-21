"use client";

// "Create project" on a confirmed sales order: the project starts as a draft for the order's customer, linked to the order (and its quotation
// and opportunity). A repeated click opens the same project; a second project for the same order is created only when asked for.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Dialog } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useApp } from "@/shell/workspace-context/useApp";

import { PROJECTS_BASE, createFromSalesOrder, errorMessage, newKey } from "../api/projects-api";

export function CreateProjectFromOrder({ salesOrderId, orderNumber }: { salesOrderId: string; orderNumber: string }) {
  const workspace = useWorkspaceContext();
  const projectsOn = useApp("projects");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [additional, setAdditional] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const may = projectsOn
    && (workspace.roleSlugs.some((slug) => ["organization_owner", "system_administrator"].includes(slug)) || workspace.permissions.includes("projects.create"));
  if (!may) return null;
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}>Create Project</Button>
      {open && (
        <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) setOpen(false); }} title={`Create a project for ${orderNumber}`} size="md">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">A draft project for this order&apos;s customer, linked to the order. Its prices, taxes and payment status stay on the order. If a project already exists for it, that one opens.</p>
            <Checkbox isSelected={additional} onChange={setAdditional}>Create another project for this order (when the order is delivered by more than one project)</Checkbox>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onPress={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" isLoading={busy} isDisabled={busy} onPress={async () => {
                setBusy(true); setError(null);
                try {
                  const created = await createFromSalesOrder(salesOrderId, additional ? { additional: true, idempotencyKey: key } : {});
                  router.push(`${PROJECTS_BASE}/${created.projectId}`);
                } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
              }}>Create project</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
