import type { ReactNode } from "react";
import { MenuTrigger, Button } from "react-aria-components";

export interface ContextMenuTriggerProps {
  children: ReactNode;
  /** The menu content — a <Menu>/<MenuItem> tree (see Menu.tsx). */
  menu: ReactNode;
}

/**
 * Right-click (and long-press on touch) context menu for arbitrary content
 * — a table row, a card, a canvas node. Every action exposed only through
 * a context menu must also be reachable another way (a visible row action,
 * a toolbar button) — a context menu is a shortcut, never the only path,
 * per ACCESSIBILITY_STANDARD.md's non-drag/non-pointer-only requirement.
 */
export function ContextMenuTrigger({ children, menu }: ContextMenuTriggerProps) {
  return (
    <MenuTrigger trigger="contextMenu">
      <Button className="contents">{children}</Button>
      {menu}
    </MenuTrigger>
  );
}
