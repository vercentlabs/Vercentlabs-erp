"use client";

// "Look up" beside a GSTIN (Shared Platform plan 7): the register's legal and trade name and status, to fill an empty name in.
import { useState } from "react";
import { Button } from "@vercentlabs/design-system";

type Found = { gstin: string; configured: boolean; status: string; statusLabel: string; displayName: string | null; legalName: string | null };

export function GstinLookup({ gstin, onFound }: { gstin: string; onFound: (found: Found) => void }) {
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin.trim().toUpperCase())) return null;
  const run = async () => {
    setState({ busy: true, note: null });
    try {
      const response = await fetch(`/api/gstin/lookup?gstin=${encodeURIComponent(gstin.trim().toUpperCase())}`, { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "The GSTIN could not be looked up.");
      const found = payload.result as Found;
      onFound(found);
      setState({ busy: false, note: found.configured ? `${found.statusLabel}${found.legalName ? ` · ${found.legalName}` : ""}` : "The GSTIN is valid. A register lookup is not set up for this installation." });
    } catch (error) {
      setState({ busy: false, note: (error as Error).message });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <Button size="compact" variant="ghost" isLoading={state.busy} onPress={() => void run()}>Look up GSTIN</Button>
      {state.note && <span>{state.note}</span>}
    </div>
  );
}
