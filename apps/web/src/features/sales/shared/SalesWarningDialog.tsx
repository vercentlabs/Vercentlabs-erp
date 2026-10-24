"use client";

// Setting a sales warning (Sales report Phase 3): on a customer, a message shown on their documents; on a product, Warn or Block.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextField } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { post } from "@/features/sales/shared/http";

export function SalesWarningDialog({ kind, id, name, level: initialLevel = "warn", message: initialMessage, onClose, onDone }: {
  kind: "customer" | "product"; id: string; name: string; level?: "none" | "warn" | "block"; message: string | null; onClose: () => void; onDone: () => void;
}) {
  const [level, setLevel] = useState<"none" | "warn" | "block">(initialMessage ? initialLevel : "warn");
  const [message, setMessage] = useState(initialMessage ?? "");
  const save = useMutation({
    mutationFn: (clear: boolean) => (kind === "customer"
      ? post(`/customers/${id}/warning`, { message: clear ? null : message.trim() })
      : post(`/products/${id}/warning`, clear ? { level: "none", message: null } : { level, message: message.trim() })),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Sales warning for ${name}`}
      description={kind === "customer" ? "Shown whenever this customer is chosen on a quotation or order." : "Shown, or stopping the sale, when this product is put on a line."}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (message.trim()) save.mutate(false); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        {kind === "product" && (
          <Select label="What happens" selectedKey={level} onSelectionChange={(key) => setLevel(key === "block" ? "block" : "warn")}
            options={[{ value: "warn", label: "Show the warning" }, { value: "block", label: "Stop it being sold" }]} />
        )}
        <TextField label="Warning" isRequired autoFocus value={message} onChange={setMessage}
          placeholder={kind === "customer" ? "For example: Cash only, no credit" : "For example: Discontinued from March"} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          {initialMessage && <Button variant="ghost" className="w-full sm:w-auto" isDisabled={save.isPending} onPress={() => save.mutate(true)}>Remove warning</Button>}
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!message.trim()}>Save warning</Button>
        </div>
      </form>
    </Dialog>
  );
}

// The warnings a document's customer and products carry, above its lines.
export function DocumentWarnings({ warnings }: { warnings?: Array<{ kind: "customer" | "product"; name: string; message: string }> }) {
  if (!warnings?.length) return null;
  return (
    <Notice tone="warning">
      <span className="flex flex-col gap-0.5">
        {warnings.map((entry) => <span key={`${entry.kind}-${entry.name}`}><span className="font-medium">{entry.name}:</span> {entry.message}</span>)}
      </span>
    </Notice>
  );
}
