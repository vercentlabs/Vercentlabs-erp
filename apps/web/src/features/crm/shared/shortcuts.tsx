"use client";

// Desktop keyboard shortcuts for the CRM. They only press what is already on the page: N opens the list's New record, / focuses the list
// search, J / K move through the list's rows and Enter opens the marked one, E edits the open record, L logs an activity on it. "?" (or the
// keyboard button in the top bar) lists them. Keys are ignored while typing, with a modifier held, or when a dialog is open.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Keyboard } from "lucide-react";
import { Dialog, IconButton } from "@vercentlabs/design-system";

type RecordKey = "e" | "l";
const recordHandlers = new Map<RecordKey, () => void>();

// A record page offers E (edit) or L (log activity) while it can do them; pass undefined when it cannot.
export function useCrmShortcut(key: RecordKey, handler: (() => void) | undefined) {
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  const enabled = Boolean(handler);
  useEffect(() => {
    if (!enabled) return;
    const run = () => latest.current?.();
    recordHandlers.set(key, run);
    return () => { if (recordHandlers.get(key) === run) recordHandlers.delete(key); };
  }, [key, enabled]);
}

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl K / ⌘ K", "Search everything"],
  ["N", "New record of the list you are on"],
  ["/", "Search the list"],
  ["J / K", "Move down / up the list's rows"],
  ["Enter", "Open the marked row"],
  ["E", "Edit the open record"],
  ["L", "Log activity on the open record"],
  ["Esc", "Close a dialog"],
  ["?", "Show these shortcuts"],
];

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="combobox"], [role="listbox"], [role="menu"]') !== null);
const isControl = (target: EventTarget | null) => target instanceof HTMLElement && target.closest("button, a, [role='button'], [role='tab']") !== null;
const listRows = () => Array.from(document.querySelectorAll<HTMLTableRowElement>("main tbody tr.cursor-pointer"));

function mark(rows: HTMLTableRowElement[], index: number) {
  rows.forEach((row, at) => {
    if (at === index) {
      row.dataset.keyboardActive = "true";
      row.style.outline = "2px solid var(--color-brand)";
      row.style.outlineOffset = "-2px";
      row.scrollIntoView({ block: "nearest" });
    } else if (row.dataset.keyboardActive) {
      delete row.dataset.keyboardActive;
      row.style.outline = "";
      row.style.outlineOffset = "";
    }
  });
}

export function CrmShortcuts() {
  const pathname = usePathname();
  const [isOpen, setOpen] = useState(false);
  const active = useRef(-1);
  // A new page starts with no row marked.
  useEffect(() => { active.current = -1; }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === "?") { event.preventDefault(); setOpen(true); return; }
      if (event.key === "/") {
        const search = document.querySelector<HTMLInputElement>('main input[type="search"]');
        if (search) { event.preventDefault(); search.focus(); }
        return;
      }
      if (event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        const create = document.querySelector<HTMLElement>('main a[href$="/new"]');
        if (create) { event.preventDefault(); create.click(); }
      } else if (key === "j" || key === "k") {
        const rows = listRows();
        if (!rows.length) return;
        event.preventDefault();
        active.current = Math.max(0, Math.min(rows.length - 1, active.current + (key === "j" ? 1 : -1)));
        mark(rows, active.current);
      } else if (event.key === "Enter") {
        const row = listRows()[active.current];
        if (row && !isControl(event.target)) { event.preventDefault(); row.click(); }
      } else if (key === "e" || key === "l") {
        const run = recordHandlers.get(key);
        if (run) { event.preventDefault(); run(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <IconButton aria-label="Keyboard shortcuts" size="compact" variant="ghost" onPress={() => setOpen(true)}><Keyboard className="size-4" aria-hidden="true" /></IconButton>
      <Dialog isOpen={isOpen} onOpenChange={setOpen} title="Keyboard shortcuts" description="They press the buttons already on the page, so they do only what you could do with the mouse.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, does]) => (
            <div key={keys} className="contents">
              <dt><kbd className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></dt>
              <dd className="text-text-secondary">{does}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  );
}
