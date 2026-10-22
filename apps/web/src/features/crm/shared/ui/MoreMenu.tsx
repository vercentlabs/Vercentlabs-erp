"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog,
  Button,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
} from "@vercentlabs/design-system";

export type MoreMenuItem = {
  id: string;
  label: string;
  onAction: () => void;
  danger?: boolean;
  isDisabled?: boolean;
  /** Consequential actions (archive, delete, merge, cancel) ask first, stating what will happen. */
  confirm?: { title: string; description: string; confirmLabel: string };
  /** A titled group the item belongs to ("Ownership", "Status"); items without one come first. */
  group?: string;
};

// Secondary and destructive actions live here so they never compete with the record's primary action.
export function MoreMenu({
  items,
  label = "More actions",
  isBusy,
}: {
  items: MoreMenuItem[];
  label?: string;
  isBusy?: boolean;
}) {
  const [pending, setPending] = useState<MoreMenuItem | null>(null);
  const safe = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  if (items.length === 0) return null;
  // Grouped menus: the ungrouped items, then each group under its title, then the destructive ones (red, at the bottom).
  const groups = [...new Set(safe.map((i) => i.group).filter((g): g is string => Boolean(g)))];
  const loose = safe.filter((i) => !i.group);
  const run = (item: MoreMenuItem) =>
    item.confirm ? setPending(item) : item.onAction();
  return (
    <>
      <MenuTrigger>
        {/* Named, not a bare "⋯": the word says there is more here. */}
        <Button aria-label={label} variant="outline">
          <MoreHorizontal className="size-4" aria-hidden="true" /><span>More</span>
        </Button>
        <Menu
          onAction={(key) => {
            const item = items.find((i) => i.id === String(key));
            if (item) run(item);
          }}
        >
          {(groups.length ? loose : safe).map((item) => (
            <MenuItem key={item.id} id={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </MenuItem>
          ))}
          {groups.map((group) => (
            <MenuSection key={group} title={group}>
              {safe.filter((i) => i.group === group).map((item) => (
                <MenuItem key={item.id} id={item.id} isDisabled={item.isDisabled}>
                  {item.label}
                </MenuItem>
              ))}
            </MenuSection>
          ))}
          {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
          {danger.map((item) => (
            <MenuItem
              key={item.id}
              id={item.id}
              isDanger
              isDisabled={item.isDisabled}
            >
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
      {pending?.confirm && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          title={pending.confirm.title}
          description={pending.confirm.description}
          confirmLabel={pending.confirm.confirmLabel}
          tone={pending.danger ? "danger" : "primary"}
          isConfirming={isBusy}
          onConfirm={() => {
            const item = pending;
            setPending(null);
            item.onAction();
          }}
        />
      )}
    </>
  );
}
