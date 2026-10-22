"use client";

// Setup › Print & WhatsApp templates (Sales plan): the WhatsApp message each document starts from — a quotation, an order confirmation, an
// invoice, a credit or debit note, a payment receipt and a payment reminder — with {placeholders} filled in when it is sent. Empty: the
// built-in wording. The PDFs themselves carry the company's logo, address, bank details and signature (Settings › Organization).
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, TextArea } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { Notice, Panel } from "@/shared/ui/Panel";
import { SalesApiError, request } from "@/features/sales/shared/http";

type Templates = { kinds: Array<{ kind: string; label: string; placeholders: string[] }>; templates: Array<{ kind: string; channel: string; body: string }> };

export function MessageTemplatesScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "templates"), queryFn: () => request<Templates>("/templates") });
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Print & WhatsApp templates" description="The message each document's Send on WhatsApp starts from. Leave a template empty to use the built-in wording." />
      <p className="text-sm text-text-secondary">
        The PDFs print the company&apos;s logo, address, GSTIN, bank details, UPI QR and signature from <Link className="text-brand hover:underline" href="/settings/organization">Settings › Organization</Link>.
      </p>
      {query.isLoading ? <p className="text-sm text-text-secondary">Loading…</p>
        : query.isError || !query.data ? <ErrorState title="Could not load the templates" action={{ label: "Try again", onPress: () => void query.refetch() }} />
          : query.data.kinds.map((kind) => (
            <TemplateEditor key={kind.kind} kind={kind} initial={query.data.templates.find((entry) => entry.kind === kind.kind && entry.channel === "whatsapp")?.body ?? ""} canManage={canManage} />
          ))}
    </div>
  );
}

function TemplateEditor({ kind, initial, canManage }: { kind: Templates["kinds"][number]; initial: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => request("/templates", { method: "PUT", body: JSON.stringify({ kind: kind.kind, channel: "whatsapp", body: body.trim() || null }) }),
    onSuccess: () => { setSaved(true); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "templates") }); },
  });
  return (
    <Panel title={kind.label} description={`Placeholders: ${kind.placeholders.map((name) => `{${name}}`).join(", ")}`}>
      <TextArea label={`${kind.label} on WhatsApp`} value={body} onChange={(value) => { setBody(value); setSaved(false); }} isDisabled={!canManage}
        placeholder="Empty: the built-in message (Dear {name}, please find our …)." />
      {save.isError && <Notice tone="danger">{save.error instanceof SalesApiError ? save.error.message : "The template could not be saved."}</Notice>}
      {saved && <Notice tone="success">Saved. Messages from now on start from it.</Notice>}
      {canManage && <div><Button variant="secondary" size="compact" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>}
    </Panel>
  );
}
