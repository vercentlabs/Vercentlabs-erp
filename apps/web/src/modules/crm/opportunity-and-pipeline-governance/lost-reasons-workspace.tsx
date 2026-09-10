"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, Dialog, FormField, PageHeader, SectionHeader, StatePanel, StatusBadge, Surface } from "@/shared/design";

type Reason = {
  id: string;
  name: string;
  code: string;
  category: string | null;
  outcomeType: "won" | "lost" | "both";
  sequence: number;
  status: "active" | "inactive";
  updatedAt: string;
};

const CATEGORIES = ["price", "competition", "timing", "budget", "fit", "no_response", "duplicate", "other"];

function nice(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export default function LostReasonsWorkspace({ canManage, reasons }: { canManage: boolean; reasons: Reason[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh(action: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try {
      await action();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action could not be completed.");
    } finally {
      setPending(false);
    }
  }

  async function setActive(reason: Reason, active: boolean) {
    await refresh(async () => {
      const result = await requestJson(`/api/crm/lost-reasons/${reason.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: active ? "active" : "inactive",
          expectedUpdatedAt: reason.updatedAt,
        }),
      });
      if (!result.ok) throw new Error(result.message || "Reason could not be updated.");
      setMessage(result.message || "Reason updated.");
    });
  }

  // Concurrency (Prompts 1-5 integrity closeout): each PATCH now carries the
  // row's own expectedUpdatedAt — a stale administrator (whose copy of
  // `reasons` no longer matches the server) gets a typed 409 conflict from
  // either request instead of silently overwriting a concurrent edit.
  async function move(reason: Reason, direction: -1 | 1) {
    const ordered = [...reasons].sort((a, b) => a.sequence - b.sequence);
    const index = ordered.findIndex((r) => r.id === reason.id);
    const swapWith = ordered[index + direction];
    if (!swapWith) return;
    await refresh(async () => {
      const [a, b] = await Promise.all([
        requestJson(`/api/crm/lost-reasons/${reason.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequence: swapWith.sequence, expectedUpdatedAt: reason.updatedAt }),
        }),
        requestJson(`/api/crm/lost-reasons/${swapWith.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequence: reason.sequence, expectedUpdatedAt: swapWith.updatedAt }),
        }),
      ]);
      if (!a.ok || !b.ok) throw new Error(a.message || b.message || "Order could not be updated.");
      setMessage("Order updated.");
    });
  }

  const grouped: Record<string, Reason[]> = { won: [], lost: [], both: [] };
  for (const reason of [...reasons].sort((a, b) => a.sequence - b.sequence)) grouped[reason.outcomeType]?.push(reason);

  return (
    <>
      <PageHeader
        eyebrow="CRM · Pipeline configuration"
        title="Won / lost reasons"
        description="Governed closure reasons captured whenever an Opportunity is marked won or lost. Renaming a reason never rewrites the label already recorded on past deals."
        context={canManage ? <ActionButton tone="primary" type="button" onClick={() => setCreating(true)}>New reason</ActionButton> : null}
      />
      {message ? <p className="notice" role="status">{message}</p> : null}
      {(["won", "both", "lost"] as const).map((outcomeType) => (
        <Surface as="section" key={outcomeType} className="crm-suite-surface">
          <SectionHeader eyebrow="Outcome" title={outcomeType === "both" ? "Applies to won or lost" : `${nice(outcomeType)} reasons`} />
          <div className="crm-stage-summary">
            {grouped[outcomeType].map((reason, index) => (
              <div key={reason.id}>
                <span>
                  <strong>{reason.name}</strong>
                  <small>{reason.category ? nice(reason.category) : "Uncategorised"}</small>
                </span>
                <StatusBadge tone={reason.status === "active" ? "success" : "neutral"}>{nice(reason.status)}</StatusBadge>
                {canManage ? (
                  <span className="crm-inline-actions">
                    <ActionButton tone="secondary" type="button" disabled={pending || index === 0} onClick={() => void move(reason, -1)} aria-label={`Move ${reason.name} up`}>↑</ActionButton>
                    <ActionButton tone="secondary" type="button" disabled={pending || index === grouped[outcomeType].length - 1} onClick={() => void move(reason, 1)} aria-label={`Move ${reason.name} down`}>↓</ActionButton>
                    <ActionButton tone={reason.status === "active" ? "danger" : "primary"} type="button" disabled={pending} onClick={() => void setActive(reason, reason.status !== "active")}>
                      {reason.status === "active" ? "Deactivate" : "Activate"}
                    </ActionButton>
                  </span>
                ) : null}
              </div>
            ))}
            {!grouped[outcomeType].length ? <StatePanel title="No reasons configured yet." /> : null}
          </div>
        </Surface>
      ))}
      {creating ? <CreateReasonDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); router.refresh(); }} /> : null}
    </>
  );
}

function CreateReasonDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("other");
  const [outcomeType, setOutcomeType] = useState<"won" | "lost" | "both">("lost");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function create() {
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson("/api/crm/lost-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, category, outcomeType, status: "active" }),
      });
      if (!result.ok) throw new Error(result.message || "Reason could not be created.");
      onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reason could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="New closure reason" description="A governed reason available when marking an Opportunity won or lost." onClose={onClose} busy={pending}>
      <FormField label="Name" htmlFor="reason-name">
        <input id="reason-name" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
      </FormField>
      <FormField label="Code" htmlFor="reason-code">
        <input id="reason-code" value={code} onChange={(event) => setCode(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="lost_to_competitor" disabled={pending} />
      </FormField>
      <FormField label="Category" htmlFor="reason-category">
        <select id="reason-category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={pending}>
          {CATEGORIES.map((value) => <option key={value} value={value}>{nice(value)}</option>)}
        </select>
      </FormField>
      <FormField label="Applies to" htmlFor="reason-outcome">
        <select id="reason-outcome" value={outcomeType} onChange={(event) => setOutcomeType(event.target.value as "won" | "lost" | "both")} disabled={pending}>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="both">Both</option>
        </select>
      </FormField>
      {message ? <p className="notice" role="status">{message}</p> : null}
      <div className="form-row">
        <ActionButton tone="primary" type="button" disabled={pending || !name.trim() || !code.trim()} busy={pending} onClick={() => void create()}>
          Create reason
        </ActionButton>
      </div>
    </Dialog>
  );
}
