"use client";

// The top bar's bell: opens the notifications in a panel under it (modal — focus stays inside, Escape or a click outside closes it)
// instead of leaving the page. Following a notification closes the panel; the full page stays at /notifications.
import { useState } from "react";
import Link from "next/link";
import { Button as AriaButton } from "react-aria-components";
import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverTrigger } from "@vercentlabs/design-system";

import { NotificationItems, useNotifications } from "./NotificationsScreen";

export function NotificationsPanel({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton
        aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : "Notifications"}
        className={[
          "relative flex size-9 items-center justify-center rounded-[var(--radius-control)] outline-none transition-colors data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-offset-2",
          open ? "bg-brand-soft text-brand" : "text-text-secondary hover:bg-surface-muted hover:text-text",
        ].join(" ")}
      >
        <Bell aria-hidden="true" className="size-5" />
        {unreadCount ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-text-inverse"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </AriaButton>
      <Popover placement="bottom end">
        {/* Mounted only while open, so the list loads fresh each time the bell is clicked. */}
        <PanelBody onClose={() => setOpen(false)} />
      </Popover>
    </PopoverTrigger>
  );
}

const TABS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
] as const;

function PanelBody({ onClose }: { onClose: () => void }) {
  const { tab, setTab, query, notifications, unreadCount, markRead, markAllRead, failure } = useNotifications();
  // -m-4 cancels the popover frame's padding so the header and footer rules run edge to edge.
  return (
    <div className="-m-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Notifications</h2>
          {query.data && <p className="text-xs text-text-muted">{unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}</p>}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
            className="flex items-center gap-1.5 text-xs font-medium text-brand hover:underline disabled:opacity-50"
          >
            <CheckCheck aria-hidden="true" className="size-3.5" />
            Mark all read
          </button>
        )}
      </div>
      <div role="radiogroup" aria-label="Show" className="flex gap-1 px-4 pt-3">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition-colors ${tab === entry.key ? "bg-brand-soft text-brand" : "text-text-secondary hover:bg-surface-muted"}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {failure && <p role="alert" className="px-4 pt-2 text-xs text-danger">{failure}</p>}
      <div className="max-h-[min(26rem,60vh)] overflow-y-auto px-2 py-2">
        <NotificationItems tab={tab} query={query} notifications={notifications} markRead={markRead} onOpen={onClose} compact />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
        <Link href="/settings/notification-preferences" onClick={onClose} className="font-medium text-text-secondary hover:text-text hover:underline">
          Preferences
        </Link>
        <Link href="/notifications" onClick={onClose} className="font-medium text-brand hover:underline">
          View all
        </Link>
      </div>
    </div>
  );
}
