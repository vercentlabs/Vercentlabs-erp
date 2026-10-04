"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, Link2, List, ListOrdered } from "lucide-react";

// A small rich-text editor: paragraphs, bullets, numbered lists, bold, italic
// and links. It produces HTML, which the server sanitizes before saving, so
// pasted markup outside that set never survives.
export function NoteEditor({ value, onChange, label = "Note", placeholder, autoFocus }: {
  value: string; onChange: (html: string) => void; label?: string; placeholder?: string; autoFocus?: boolean;
}) {
  const editor = useRef<HTMLDivElement>(null);

  // Only push a value in when it differs (initial load, reset after save), so typing keeps the caret.
  useEffect(() => {
    const element = editor.current;
    if (element && element.innerHTML !== value) element.innerHTML = value;
  }, [value]);
  useEffect(() => {
    if (autoFocus) editor.current?.focus();
  }, [autoFocus]);

  function apply(command: string) {
    let argument: string | undefined;
    if (command === "createLink") {
      const url = window.prompt("Link address (https://…)")?.trim();
      if (!url) return;
      argument = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    }
    editor.current?.focus();
    document.execCommand(command, false, argument);
    onChange(editor.current?.innerHTML ?? "");
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <div className="rounded-[var(--radius-control)] border border-border bg-surface focus-within:border-brand">
        <div role="toolbar" aria-label="Formatting" className="flex gap-1 border-b border-border px-1 py-1">
          {TOOLS.map((tool) => (
            <button key={tool.label} type="button" title={tool.label} aria-label={tool.label}
              onMouseDown={(event) => { event.preventDefault(); apply(tool.command); }}
              className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text">
              <tool.icon className="size-4" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div ref={editor} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={(event) => onChange(event.currentTarget.innerHTML)}
          className={`${NOTE_BODY_CLASS} min-h-24 px-3 py-2 outline-none empty:before:text-text-muted empty:before:content-[attr(data-placeholder)]`} />
      </div>
    </div>
  );
}

const TOOLS = [
  { label: "Bold", icon: Bold, command: "bold" },
  { label: "Italic", icon: Italic, command: "italic" },
  { label: "Bulleted list", icon: List, command: "insertUnorderedList" },
  { label: "Numbered list", icon: ListOrdered, command: "insertOrderedList" },
  { label: "Link", icon: Link2, command: "createLink" },
];

// Lists and links inside a note's HTML (the reset styles remove them).
export const NOTE_BODY_CLASS =
  "text-sm text-text break-words [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-brand [&_a]:underline";

// True when the editor holds no visible text.
export function isBlankNote(html: string) {
  return !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

// A note body the server has already sanitized.
export function NoteBody({ html }: { html: string }) {
  return <div className={NOTE_BODY_CLASS} dangerouslySetInnerHTML={{ __html: html }} />;
}
