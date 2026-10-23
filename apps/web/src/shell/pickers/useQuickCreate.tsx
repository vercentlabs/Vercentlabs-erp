"use client";

// Opens a kind's quick-create form in a side drawer over the form the user is filling (Create-Where-You-Are plan): the form underneath
// keeps everything typed; Save hands the new record back and closes the drawer, Cancel just closes it. Any picker can use it:
//   const quickCreate = useQuickCreate("contact", { onCreated: (record) => setContactId(record.id) });
//   <ComboBox onCreate={quickCreate.canCreate ? quickCreate.open : undefined} … />{quickCreate.drawer}
import { useState } from "react";
import { Drawer } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PICKERS } from "./registry";
import type { PickedRecord, PickerKind } from "./types";

export function useQuickCreate(kind: PickerKind, { onCreated, prefill }: { onCreated: (record: PickedRecord) => void; prefill?: Record<string, unknown> }) {
  const workspace = useWorkspaceContext();
  const [openWith, setOpenWith] = useState<string | null>(null);
  const definition = PICKERS[kind];
  const isOwner = workspace.roleSlugs.includes("organization_owner");
  // The app must be on, and the person allowed to create one.
  const appOn = definition.app === "settings" || definition.app === "products" || workspace.accessibleModuleKeys.includes(definition.app);
  const canCreate = appOn && (isOwner || definition.createPermissions.some((permission) => workspace.permissions.includes(permission)));
  const { Create } = definition;
  const close = () => setOpenWith(null);
  const drawer = openWith === null ? null : (
    <Drawer isOpen isDismissable onOpenChange={(open) => !open && close()} title={`New ${definition.noun}`} size="md">
      <Create initialText={openWith} prefill={prefill} onCancel={close} onCreated={(record) => { close(); onCreated(record); }} />
    </Drawer>
  );
  return { canCreate, noun: definition.noun, open: (text: string) => setOpenWith(text), drawer };
}
