"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MenuTrigger,
  Menu,
  MenuItem,
  MenuSeparator,
  IconButton,
} from "@vercentlabs/design-system";
import { LogOut, User } from "lucide-react";

export function ProfileMenu({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  // Portaled, not inline next to the trigger — see PrimaryNavItem.tsx's
  // comment (same fix, same reason: an absolutely-positioned flyout
  // tooltip inside a container with any non-"visible" overflow on either
  // axis contributes to that container's scrollable area regardless of
  // its opacity, which is what caused the primary sidebar to scroll
  // horizontally).
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);

  function showTooltip() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({ top: rect.top + rect.height / 2, left: rect.right + 8 });
  }
  function hideTooltip() {
    setTooltipPosition(null);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const initials =
    fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  return (
    <MenuTrigger>
      <span ref={triggerRef} className="relative flex" onMouseEnter={showTooltip} onMouseLeave={hideTooltip} onFocus={showTooltip} onBlur={hideTooltip}>
        <IconButton
          aria-label={`Account menu for ${fullName}`}
          variant="ghost"
          className="h-9 w-9 rounded-full bg-white/10 text-xs font-semibold text-navigation-text hover:bg-white/20 hover:text-navigation-text"
        >
          {initials}
        </IconButton>
        {tooltipPosition && typeof document !== "undefined"
          ? createPortal(
              <span
                role="tooltip"
                style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
                className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text shadow-panel"
              >
                {fullName}
              </span>,
              document.body,
            )
          : null}
      </span>
      {/* id (not React's `key`) is what react-aria-components' collection
          system passes back to onAction — `key` is React's own list-
          reconciliation prop and is never readable by the component. */}
      <Menu onAction={(id) => id === "sign-out" && handleSignOut()}>
        <MenuItem id="profile" href="/settings/profile" textValue="Profile">
          <User aria-hidden="true" className="size-4" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{fullName}</span>
            <span className="text-xs text-text-muted">{email}</span>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          id="sign-out"
          isDanger
          isDisabled={signingOut}
          textValue="Sign out"
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
