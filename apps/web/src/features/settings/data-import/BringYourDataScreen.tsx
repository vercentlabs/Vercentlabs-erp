"use client";

// Settings › Bring your data (Shared Platform plan 5): the guided way in — masters, then opening stock, then opening balances, then
// what customers and suppliers still owe — as of one cut-over date. Each step shows how much is in and opens its import.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { Button, ErrorState, LinkButton, PageHeader, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";

type Step = { key: string; stage: string; label: string; count: number; done: boolean; href: string; allowed: boolean };
type Checklist = { cutoverDate: string | null; done: number; total: number; steps: Step[] };

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const KEY = ["settings", "data-checklist"];
const STAGE_NOTE: Record<string, string> = {
  Masters: "Who and what you deal with.",
  "Opening stock": "What you hold on the cut-over date, with its cost.",
  "Opening balances": "Bank, cash, loans and capital on the cut-over date.",
  "Open invoices": "Invoices and bills not yet settled on the cut-over date, so they can be collected and paid.",
};

export function BringYourDataScreen() {
  const query = useQuery({ queryKey: KEY, queryFn: () => send<{ checklist: Checklist }>("/api/settings/data-checklist").then((data) => data.checklist) });
  if (query.isLoading) return <LoadingState label="Loading" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load the checklist" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <Checklist checklist={query.data} />;
}

function Checklist({ checklist }: { checklist: Checklist }) {
  const queryClient = useQueryClient();
  const [cutover, setCutover] = useState(checklist.cutoverDate ?? "");
  const save = useMutation({
    mutationFn: () => send("/api/settings/data-checklist", { method: "PUT", body: JSON.stringify({ cutoverDate: cutover || null }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const stages = [...new Set(checklist.steps.map((step) => step.stage))];
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Bring your data" description={`Move your company in, step by step. ${checklist.done} of ${checklist.total} steps have data.`} />
      {save.error && <Notice>{(save.error as Error).message}</Notice>}
      <Panel title="Cut-over date" description="The day you start on Vercentlabs. Opening stock, balances and open invoices are what you had at the start of this day; close the old books the day before.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48"><TextField label="Cut-over date" type="date" value={cutover} onChange={setCutover} /></div>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
        </div>
      </Panel>
      {stages.map((stage, index) => (
        <Panel key={stage} title={`${index + 1}. ${stage}`} description={STAGE_NOTE[stage]}>
          <ul className="flex flex-col divide-y divide-border">
            {checklist.steps.filter((step) => step.stage === stage).map((step) => (
              <li key={step.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2 text-sm">
                  {step.done ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <Circle className="size-4 text-text-muted" aria-hidden="true" />}
                  <span className="font-medium">{step.label}</span>
                  <span className="text-text-muted">{step.done ? `${step.count.toLocaleString("en-IN")} in` : "Not started"}</span>
                </span>
                {step.allowed ? <LinkButton href={step.href} variant={step.done ? "outline" : "secondary"} size="compact">{step.done ? "Add more" : "Start"}</LinkButton>
                  : <span className="text-xs text-text-muted">Needs a permission you do not have</span>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
