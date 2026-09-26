"use client";

import { Button, Checkbox, Dialog } from "@vercentlabs/design-system";
import { useState } from "react";

// Shows a newly issued secret (API key, webhook signing secret, inbound
// address) exactly once. The value lives only in the caller's component
// state - never in the React Query cache - and the dialog cannot be closed
// until the user confirms they have copied it.
export type RevealedSecret = { title: string; description: string; items: Array<{ label: string; value: string }> };

export function SecretRevealDialog({ secret, onDone }: { secret: RevealedSecret; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };
  return (
    <Dialog isOpen isDismissable={false} isKeyboardDismissDisabled hideCloseButton onOpenChange={() => undefined} title={secret.title} description={secret.description} size="lg">
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-[var(--radius-card)] border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-text">
          This is the only time it will be shown. Store it somewhere safe now; you can create a new one later but not see this one again.
        </p>
        {secret.items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">{item.label}</span>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-text" data-testid="revealed-secret">
                {item.value}
              </code>
              <Button variant="secondary" size="compact" onPress={() => void copy(item.label, item.value)} aria-label={`Copy ${item.label}`}>
                {copied === item.label ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ))}
        <Checkbox isSelected={confirmed} onChange={setConfirmed}>
          I have copied and stored this safely
        </Checkbox>
        <div className="flex justify-end">
          <Button variant="primary" isDisabled={!confirmed} onPress={onDone}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
