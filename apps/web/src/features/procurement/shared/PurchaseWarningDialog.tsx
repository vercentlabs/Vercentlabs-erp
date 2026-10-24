"use client";

// Setting a purchase warning (report Phase 3): on a supplier, a message buyers see when they choose it; on an item, a message (Warn) or a
// stop on new purchases (Block).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { post } from "@/features/procurement/shared/http";

export function PurchaseWarningDialog({ kind, id, name, level: initialLevel = "warn", message: initialMessage, onClose, onDone }: {
  kind: "supplier" | "item"; id: string; name: string; level?: string; message: string | null; onClose: () => void; onDone: () => void;
}) {
  const [level, setLevel] = useState(initialLevel === "none" ? "warn" : initialLevel);
  const [message, setMessage] = useState(initialMessage ?? "");
  const save = useMutation({
    mutationFn: (clear: boolean) => post(kind === "supplier" ? `/suppliers/${id}/purchase-warning` : `/items/${id}/purchase-warning`,
      kind === "supplier" ? { message: clear ? null : message.trim() } : clear ? { level: "none" } : { level, message: message.trim() }),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Purchase warning · ${name}`}
      description={kind === "supplier" ? "Buyers see it when they choose this supplier." : "Shown when the item is chosen, or stopping new purchases."} size="md">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{save.error instanceof Error ? save.error.message : "Could not save."}</Notice>}
        {kind === "item" && (
          <Select label="What it does" selectedKey={level} onSelectionChange={(key) => setLevel(String(key))}
            options={[{ value: "warn", label: "Warn: show the message" }, { value: "block", label: "Block: not bought now" }]} />
        )}
        <TextArea label="Message" isRequired value={message} onChange={setMessage} rows={2} placeholder={kind === "supplier" ? "Pay only against delivery" : "Being phased out: check with stores"} />
        <div className="flex flex-wrap justify-end gap-2">
          {initialMessage && <Button variant="ghost" isLoading={save.isPending && save.variables === true} onPress={() => save.mutate(true)}>Remove warning</Button>}
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!message.trim()} isLoading={save.isPending && save.variables === false} onPress={() => save.mutate(false)}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

// The warning under a chosen item or supplier.
export function PurchaseWarningNote({ row }: { row?: { purchase_warning?: string | null; purchase_warning_level?: string | null } | null }) {
  if (!row?.purchase_warning || row.purchase_warning_level === "none") return null;
  return <p className={`text-xs ${row.purchase_warning_level === "block" ? "text-danger" : "text-warning"}`}>{row.purchase_warning_level === "block" ? "Not bought now: " : ""}{row.purchase_warning}</p>;
}
