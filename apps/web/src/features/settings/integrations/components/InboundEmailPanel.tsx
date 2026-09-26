"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextField,
} from "@vercentlabs/design-system";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

import { SecretRevealDialog, type RevealedSecret } from "./SecretRevealDialog";

type Route = { id: string; name: string; targetLabel: string; companyName: string | null; routeKeyPrefix: string; status: "active" | "disabled"; lastReceivedAt: string | null; receivedCount: number };
type InboundEvent = { id: string; subject: string | null; status: string; outcome: string | null; error: string | null; ticketId: string | null; receivedAt: string; attachmentNotes: unknown };
type Payload = { routes: Route[]; events: InboundEvent[]; targets: Array<{ key: string; label: string }>; companies: Array<{ id: string; name: string }> };

const QUERY_KEY = ["settings", "integrations", "inbound-mail"];
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const OUTCOME: Record<string, string> = { new_ticket: "New ticket", new_ticket_after_closed: "New ticket (earlier one was closed)", reply: "Added to ticket", duplicate: "Duplicate ignored" };

export function InboundEmailPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<Payload>("/api/settings/integrations/inbound-mail") });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const toggle = useMutation({
    mutationFn: (route: Route) => requestJson(`/api/settings/integrations/inbound-mail/${route.id}/status`, { method: "POST", json: { status: route.status === "active" ? "disabled" : "active" } }),
    onSuccess: refresh,
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError) return <ErrorState title="Could not load inbound email" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const { routes, events, targets, companies } = query.data!;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-text-secondary">
          Point your email provider&apos;s inbound webhook at an address created here. Requests must carry an <code className="font-mono">X-Inbound-Signature</code> header (hex HMAC-SHA256 of the raw body with the route&apos;s signing secret).
        </p>
        {canManage && (
          <Button variant="primary" onPress={() => setCreating(true)} isDisabled={companies.length === 0}>
            New inbound address
          </Button>
        )}
      </div>
      {routes.length === 0 ? (
        <EmptyState title="No inbound addresses" description="Create one to turn customer emails into Support tickets." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <Table caption="Inbound addresses">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Does</TableHeaderCell>
                <TableHeaderCell>Received</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {routes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-text">{route.name}</span>
                      <span className="font-mono text-xs text-text-muted">{`${route.routeKeyPrefix}…`}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{route.targetLabel}</span>
                      {route.companyName && <span className="text-xs text-text-muted">{route.companyName}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{route.lastReceivedAt ? `${route.receivedCount} · last ${formatter.format(new Date(route.lastReceivedAt))}` : "Nothing yet"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={route.status === "active" ? "success" : "neutral"}>{route.status === "active" ? "Active" : "Disabled"}</StatusBadge>
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <Button variant="ghost" size="compact" isLoading={toggle.isPending && toggle.variables?.id === route.id} onPress={() => toggle.mutate(route)}>
                        {route.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text">Recent messages</h3>
        {events.length === 0 ? (
          <p className="text-sm text-text-secondary">No messages received yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <Table caption="Recent inbound messages">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Subject</TableHeaderCell>
                  <TableHeaderCell>Received</TableHeaderCell>
                  <TableHeaderCell>Result</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.subject ?? "(no subject)"}</TableCell>
                    <TableCell>{formatter.format(new Date(event.receivedAt))}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{event.outcome ? (OUTCOME[event.outcome] ?? event.outcome) : event.status === "failed" ? "Failed" : "Processing"}</span>
                        {event.error && <span className="text-xs text-danger">{event.error}</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {creating && (
        <CreateRouteDialog
          targets={targets}
          companies={companies}
          onClose={() => setCreating(false)}
          onCreated={(name, webhookUrl, signingSecret) => {
            setCreating(false);
            setSecret({
              title: "Inbound address created",
              description: `Configure your email provider for "${name}" with these values.`,
              items: [
                { label: "Webhook URL", value: webhookUrl },
                { label: "Signing secret", value: signingSecret },
              ],
            });
            refresh();
          }}
        />
      )}
      {secret && <SecretRevealDialog secret={secret} onDone={() => setSecret(null)} />}
    </div>
  );
}

function CreateRouteDialog({
  targets,
  companies,
  onClose,
  onCreated,
}: {
  targets: Payload["targets"];
  companies: Payload["companies"];
  onClose: () => void;
  onCreated: (name: string, webhookUrl: string, signingSecret: string) => void;
}) {
  const [name, setName] = useState("Support inbox");
  const [target, setTarget] = useState(targets[0]?.key ?? "");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => requestJson<{ webhookUrl: string; signingSecret: string }>("/api/settings/integrations/inbound-mail", { method: "POST", json: { name, target, companyId } }),
    onSuccess: (result) => onCreated(name, result.webhookUrl, result.signingSecret),
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The address could not be created."),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New inbound address">
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={setName} isRequired />
        <Select label="What should incoming mail do?" selectedKey={target} onSelectionChange={(key) => setTarget(String(key))} options={targets.map((option) => ({ value: option.key, label: option.label }))} />
        <Select label="Company" selectedKey={companyId} onSelectionChange={(key) => setCompanyId(String(key))} options={companies.map((company) => ({ value: company.id, label: company.name }))} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!name.trim() || !target || !companyId} isLoading={create.isPending} onPress={() => create.mutate()}>
            Create address
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
