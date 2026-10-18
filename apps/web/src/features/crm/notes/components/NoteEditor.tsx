"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AtSign, Bold, Italic, Link2, List, ListOrdered } from "lucide-react";
import { Select } from "@vercentlabs/design-system";

import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// A small rich-text editor: paragraphs, bullets, numbered lists, bold, italic
// and links. It produces HTML, which the server sanitizes before saving, so
// pasted markup outside that set never survives. "Mention" puts @[Name](member) in the text: that person is told about the note
// (CRM plan 4.6), and it shows as @Name.
export function NoteEditor({ value, onChange, label = "Note", placeholder, autoFocus }: {
  value: string; onChange: (html: string) => void; label?: string; placeholder?: string; autoFocus?: boolean;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const caret = useRef<Range | null>(null);
  const [mentioning, setMentioning] = useState(false);
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions, enabled: mentioning });
  const members = (options.data?.options.users ?? []).map((user) => ({ value: String(user.id), label: String(user.name ?? "") }));

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

  function startMention() {
    const selection = window.getSelection();
    caret.current = selection?.rangeCount && editor.current?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    setMentioning(true);
  }
  function mention(userId: string) {
    const member = members.find((entry) => entry.value === userId);
    setMentioning(false);
    if (!member) return;
    editor.current?.focus();
    const selection = window.getSelection();
    if (caret.current && selection) {
      selection.removeAllRanges();
      selection.addRange(caret.current);
    }
    document.execCommand("insertText", false, `@[${member.label.replace(/[[\]]/g, "")}](${member.value}) `);
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
          <button type="button" title="Mention someone" aria-label="Mention someone"
            onMouseDown={(event) => { event.preventDefault(); startMention(); }}
            className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text">
            <AtSign className="size-4" aria-hidden="true" />
          </button>
        </div>
        {mentioning && (
          <div className="flex items-end gap-2 border-b border-border px-2 py-2">
            <div className="min-w-0 flex-1">
              <Select label="Mention" size="compact" options={members} selectedKey={null} isDisabled={options.isLoading}
                onSelectionChange={(key) => mention(String(key))} />
            </div>
            <button type="button" className="px-2 py-1 text-sm text-text-secondary hover:text-text" onClick={() => setMentioning(false)}>Cancel</button>
          </div>
        )}
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

// A note body the server has already sanitized; mentions show as @Name.
export function NoteBody({ html }: { html: string }) {
  return <div className={NOTE_BODY_CLASS} dangerouslySetInnerHTML={{ __html: showMentions(html) }} />;
}

const MENTION = /@\[([^\]<>]{1,120})\]\([0-9a-f-]{36}\)/gi;
export function showMentions(html: string) {
  return html.replace(MENTION, (_, name: string) => `<span class="font-medium text-brand">@${name}</span>`);
}
