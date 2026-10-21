"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearOfflineSecrets } from "@/shared/offline/clear-offline-secrets";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MenuTrigger,
  Menu,
  MenuItem,
  MenuSeparator,
  IconButton,
} from "@vercentlabs/design-system";
import { Check, HelpCircle, Languages, LogOut, User } from "lucide-react";

import { saveOwnProfile } from "@/features/settings/company/company-api";
import { useT, useTextLocale } from "@/shared/i18n/I18nText";

// The languages the screens can be read in (shared/i18n): the person's own choice, saved on their profile.
const LANGUAGES = [{ code: "en-IN", name: "English" }, { code: "hi-IN", name: "हिन्दी" }];

export function ProfileMenu({
  fullName,
  email,
  showHelp = false,
}: {
  fullName: string;
  email: string;
  /** On a phone Help lives here (on a desktop it is in the primary sidebar). */
  showHelp?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useTextLocale();
  const [signingOut, setSigningOut] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  // Portaled, not inline next to the trigger — see PrimaryNavItem.tsx's
  // comment for why a tooltip must not live inside a clipped/scrollable
  // ancestor. Sits below the trigger and is right-aligned to it: the
  // trigger is the last item in WorkspaceTopBar, so a tooltip above it
  // would be cut off by the viewport top and a centered one by its right
  // edge.
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);

  function showTooltip() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }
  function hideTooltip() {
    setTooltipPosition(null);
  }

  const queryClient = useQueryClient();

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      await clearOfflineSecrets();
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
      <span
        ref={triggerRef}
        className="relative flex"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        <IconButton
          aria-label={t("Account menu for {name}", { name: fullName })}
          tooltip={false}
          variant="ghost"
          className="h-9 w-9 rounded-full bg-brand-soft text-xs font-semibold text-brand hover:bg-brand-soft hover:text-brand hover:ring-2 hover:ring-brand/30"
        >
          {initials}
        </IconButton>
        {tooltipPosition && typeof document !== "undefined"
          ? createPortal(
              <span
                role="tooltip"
                style={{
                  top: tooltipPosition.top,
                  right: tooltipPosition.right,
                }}
                className="pointer-events-none fixed z-50 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text shadow-panel"
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
      <Menu onAction={(id) => {
        if (id === "sign-out") void handleSignOut();
        const language = String(id).startsWith("lang:") ? String(id).slice(5) : null;
        if (language && language !== locale) void saveOwnProfile({ locale: language }).then(() => router.refresh());
      }}>
        <MenuItem id="profile" href="/settings/profile" textValue={t("Profile")}>
          <User aria-hidden="true" className="size-4" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{fullName}</span>
            <span className="text-xs text-text-muted">{email}</span>
          </span>
        </MenuItem>
        {showHelp ? (
          <MenuItem id="help" isDisabled textValue={t("Help")}>
            <HelpCircle aria-hidden="true" className="size-4" />
            <span className="flex-1">{t("Help")}</span>
            <span className="text-xs text-text-muted">{t("Coming soon")}</span>
          </MenuItem>
        ) : null}
        <MenuSeparator />
        {LANGUAGES.map((language) => (
          <MenuItem key={language.code} id={`lang:${language.code}`} textValue={`${t("Language")}: ${language.name}`}>
            <Languages aria-hidden="true" className="size-4" />
            <span className="flex-1" lang={language.code}>{language.name}</span>
            {language.code === locale ? <Check aria-hidden="true" className="size-4" /> : null}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          id="sign-out"
          isDanger
          isDisabled={signingOut}
          textValue={t("Sign out")}
        >
          <LogOut aria-hidden="true" className="size-4" />
          {t("Sign out")}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
