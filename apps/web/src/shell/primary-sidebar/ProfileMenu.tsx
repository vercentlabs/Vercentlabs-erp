"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
      <span className="group relative flex">
        <IconButton
          aria-label={`Account menu for ${fullName}`}
          variant="ghost"
          className="h-9 w-9 rounded-full bg-white/10 text-xs font-semibold text-navigation-text hover:bg-white/20 hover:text-navigation-text"
        >
          {initials}
        </IconButton>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text opacity-0 shadow-panel transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {fullName}
        </span>
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
