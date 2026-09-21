"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { AlertDialog, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger } from "@vercentlabs/design-system";

export type MoreMenuItem = {
  id: string;
  label: string;
  onAction: () => void;
  danger?: boolean;
  isDisabled?: boolean;
  /** Consequential actions (archive, delete, merge, cancel) ask first, stating what will happen. */
  confirm?: { title: string; description: string; confirmLabel: string };
};

// Secondary and destructive actions live here so they never compete with the record's primary action.
export function MoreMenu({ items, label = "More actions", isBusy }: { items: MoreMenuItem[]; label?: string; isBusy?: boolean }) {
  const [pending, setPending] = useState<MoreMenuItem | null>(null);
  const safe = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  if (items.length === 0) return null;
  const run = (item: MoreMenuItem) => (item.confirm ? setPending(item) : item.onAction());
  return (
    <>
      <MenuTrigger>
        <IconButton aria-label={label} variant="outline">
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </IconButton>
        <Menu onAction={(key) => { const item = items.find((i) => i.id === String(key)); if (item) run(item); }}>
          {safe.map((item) => <MenuItem key={item.id} id={item.id} isDisabled={item.isDisabled}>{item.label}</MenuItem>)}
          {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
          {danger.map((item) => <MenuItem key={item.id} id={item.id} isDanger isDisabled={item.isDisabled}>{item.label}</MenuItem>)}
        </Menu>
      </MenuTrigger>
      {pending?.confirm && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setPending(null); }}
          title={pending.confirm.title}
          description={pending.confirm.description}
          confirmLabel={pending.confirm.confirmLabel}
          isConfirming={isBusy}
          onConfirm={() => { const item = pending; setPending(null); item.onAction(); }}
        />
      )}
    </>
  );
}
