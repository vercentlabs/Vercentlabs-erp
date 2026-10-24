"use client";

// Headings and notes between a document's lines (Sales report Phase 2): "Installation", "Note: prices valid for Mumbai". They sit before
// an item line, are printed on the document and never priced. The forms keep them beside their lines: `position` counts the form's
// lines before the block, and is turned into filled lines only when saving.
import { useState } from "react";
import { ArrowDown, ArrowUp, Heading, StickyNote, Trash2 } from "lucide-react";
import { Button, TextField } from "@vercentlabs/design-system";

export type SectionKind = "section" | "note";
export type SavedSectionLine = { kind: SectionKind; text: string; position: number };
export type SectionDraft = SavedSectionLine & { key: number };

let nextKey = 1;

export function useSectionLines(saved: SavedSectionLine[] | null | undefined) {
  const [sections, setSections] = useState<SectionDraft[]>(() => (saved ?? []).map((block) => ({ ...block, key: nextKey++ })));
  return {
    sections,
    replace: (next: SavedSectionLine[]) => setSections(next.map((block) => ({ ...block, key: nextKey++ }))),
    add: (kind: SectionKind, position: number) => setSections((current) => [...current, { key: nextKey++, kind, text: "", position }]),
    update: (key: number, text: string) => setSections((current) => current.map((block) => (block.key === key ? { ...block, text } : block))),
    remove: (key: number) => setSections((current) => current.filter((block) => block.key !== key)),
    move: (key: number, by: number, lineCount: number) =>
      setSections((current) => current.map((block) => (block.key === key ? { ...block, position: Math.min(lineCount, Math.max(0, block.position + by)) } : block))),
    // A line removed at `index`: the blocks after it move up with the lines.
    lineRemoved: (index: number) => setSections((current) => current.map((block) => (block.position > index ? { ...block, position: block.position - 1 } : block))),
    // What is saved: positions counted in filled lines only (`filled[i]`: line i of the form is saved), empty blocks left out.
    toSaved: (filled: boolean[]): SavedSectionLine[] => sections.filter((block) => block.text.trim())
      .map((block) => ({ kind: block.kind, text: block.text.trim(), position: filled.slice(0, block.position).filter(Boolean).length })),
  };
}

// The blocks that sit before form line `index` (or after the last line, with index = the number of lines).
export function sectionsAt(sections: SectionDraft[], index: number) {
  return sections.filter((block) => block.position === index);
}

export function AddSectionButtons({ onAdd }: { onAdd: (kind: SectionKind) => void }) {
  return (
    <>
      <Button variant="ghost" size="compact" onPress={() => onAdd("section")}><Heading className="size-3.5" aria-hidden="true" />Add heading</Button>
      <Button variant="ghost" size="compact" onPress={() => onAdd("note")}><StickyNote className="size-3.5" aria-hidden="true" />Add note</Button>
    </>
  );
}

// One heading or note in the list of lines. Phone: the text, then its buttons in a row; wider: one row.
export function SectionLineRow({ block, lineCount, onChange, onMove, onRemove }: {
  block: SectionDraft; lineCount: number; onChange: (text: string) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const heading = block.kind === "section";
  return (
    <div className={`grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-dashed p-3 sm:grid-cols-[minmax(0,1fr)_auto] ${heading ? "border-brand/40 bg-brand-soft/40" : "border-border bg-surface-muted"}`}>
      <TextField label={heading ? "Heading" : "Note"} value={block.text} onChange={onChange}
        placeholder={heading ? "For example: Installation" : "For example: Prices valid for Mumbai"} />
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="compact" aria-label={`Move this ${heading ? "heading" : "note"} up`} isDisabled={block.position === 0} onPress={() => onMove(-1)}>
          <ArrowUp className="size-4" aria-hidden="true" />Up
        </Button>
        <Button variant="ghost" size="compact" aria-label={`Move this ${heading ? "heading" : "note"} down`} isDisabled={block.position >= lineCount} onPress={() => onMove(1)}>
          <ArrowDown className="size-4" aria-hidden="true" />Down
        </Button>
        <Button variant="ghost" size="compact" aria-label={`Remove this ${heading ? "heading" : "note"}`} onPress={onRemove}>
          <Trash2 className="size-4" aria-hidden="true" />Remove
        </Button>
      </div>
    </div>
  );
}
