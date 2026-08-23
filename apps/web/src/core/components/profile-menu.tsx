"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import AppIcon from "@/shared/components/app-icon";
import LogoutButton from "@/core/components/logout-button";
import { useOutsideDismiss } from "@/shared/use-outside-dismiss";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

// Part 18 — completes the topbar profile control into a real menu
// (Profile + Sign out) instead of a plain link. Sign-out still goes
// through the existing LogoutButton, which calls the existing
// /api/auth/logout session-invalidation endpoint (Part 18: "Do not
// implement logout as client-only local state clearing") — this component
// adds no new session logic of its own.
export default function ProfileMenu({
  fullName,
  role,
}: {
  fullName: string;
  role: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(containerRef, open, () => setOpen(false));

  return (
    <div className="topbar-menu" ref={containerRef}>
      <button
        type="button"
        className="topbar-profile"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="topbar-avatar" aria-hidden="true">
          {initials(fullName)}
        </span>
        <span className="topbar-profile-copy">
          <strong>{fullName}</strong>
          {role ? <small>{role}</small> : null}
        </span>
      </button>
      {open ? (
        <div className="topbar-popover" role="menu" aria-label="Profile menu">
          <Link className="topbar-popover-item" href="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <AppIcon name="profile" size={16} />
            Profile
          </Link>
          <Link className="topbar-popover-item" href="/security" role="menuitem" onClick={() => setOpen(false)}>
            <AppIcon name="security" size={16} />
            Security
          </Link>
          <div className="topbar-popover-divider" role="separator" />
          <LogoutButton className="topbar-popover-item topbar-popover-logout" />
        </div>
      ) : null}
    </div>
  );
}
