"use client";

// "Is your business registered for GST?" — Yes: the GSTIN (we take the state from it). No: the state only, and documents are made
// without GST. GST can't be worked out without the business's state, so this is asked once: from Get started, or the first time
// someone makes a tax invoice or a POS sale, if it isn't set yet. It saves to the company registration Settings › Company and Taxes use.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Radio, RadioGroup, Select, TextField } from "@vercentlabs/design-system";

import { STATE_OPTIONS } from "@/shared/locale-options";
import { Notice } from "@/shared/ui/Panel";

type GstStatus = { needed: boolean; taxEnabled: boolean; gstin: string | null; stateCode: string | null; canEdit: boolean };
export const GST_DETAILS_KEY = ["settings", "gst-details"];
export const getGstDetails = async () => {
  const response = await fetch("/api/settings/gst-details", { credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? "Could not check the GST details.");
  return payload.gst as GstStatus;
};

export function GstDetailsDialog({ isOpen, onClose }: { isOpen: boolean; onClose: (saved: boolean) => void }) {
  const queryClient = useQueryClient();
  const [registered, setRegistered] = useState<"yes" | "no" | null>(null);
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/gst-details", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registered === "yes" ? { registered: true, gstin } : { registered: false, stateCode }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw Object.assign(new Error(payload.message ?? "That did not work."), { field: payload.field });
      await queryClient.invalidateQueries({ queryKey: GST_DETAILS_KEY });
      await queryClient.invalidateQueries({ queryKey: ["workspace", "guide"] });
      onClose(true);
    } catch (caught) {
      setError({ message: (caught as Error).message, field: (caught as { field?: string }).field });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose(false)} title="Add your GST details">
      <div className="flex flex-col gap-4 text-sm">
        <RadioGroup label="Is your business registered for GST?" value={registered ?? ""} onChange={(value) => setRegistered(value as "yes" | "no")}>
          <Radio value="yes">Yes</Radio>
          <Radio value="no">No</Radio>
        </RadioGroup>
        {registered === "yes" && <TextField label="GSTIN" value={gstin} onChange={(value) => setGstin(value.toUpperCase())} maxLength={15}
          description="We take your state from it." isInvalid={error?.field === "gstin"} errorMessage={error?.field === "gstin" ? error.message : undefined} />}
        {registered === "no" && <Select label="Your state" selectedKey={stateCode} onSelectionChange={(key) => setStateCode(String(key))} options={STATE_OPTIONS}
          description="Your documents are made without GST." />}
        {error && error.field !== "gstin" && <Notice>{error.message}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onClose(false)}>Not now</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!registered || (registered === "yes" ? gstin.length !== 15 : !stateCode)} onPress={() => void save()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

// On the screens that make a tax invoice or a POS sale: asks the question once, if it isn't answered yet.
export function GstDetailsGate() {
  const query = useQuery({ queryKey: GST_DETAILS_KEY, queryFn: getGstDetails, staleTime: 60_000, retry: false });
  const [dismissed, setDismissed] = useState(false);
  const status = query.data;
  if (!status?.needed || dismissed) return null;
  if (!status.canEdit) return <Notice tone="warning">Your company&apos;s GST details aren&apos;t set yet, so tax can&apos;t be worked out. Ask the owner or an administrator to add them.</Notice>;
  return <GstDetailsDialog isOpen onClose={() => setDismissed(true)} />;
}
