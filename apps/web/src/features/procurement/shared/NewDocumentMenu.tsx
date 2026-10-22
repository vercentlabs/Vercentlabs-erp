"use client";

// One "+ New" button per list with the usual sources in its menu (Procurement plan Phase 1), so nobody hunts for where a document starts:
// New PO → blank / from a quotation; New GRN → against a PO / without a PO; New Bill → from a GRN / from a PO / direct expense.
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger } from "@vercentlabs/design-system";

export type NewDocumentSource = { id: string; label: string; href: string };

export function NewDocumentMenu({ label, sources }: { label: string; sources: NewDocumentSource[] }) {
  const router = useRouter();
  if (!sources.length) return null;
  return (
    <MenuTrigger>
      <Button variant="primary"><Plus className="size-4" aria-hidden="true" />{label}</Button>
      <Menu onAction={(key) => { const source = sources.find((entry) => entry.id === String(key)); if (source) router.push(source.href); }}>
        {sources.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  );
}
