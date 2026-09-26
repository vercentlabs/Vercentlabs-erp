"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  Checkbox,
  CheckboxGroup,
  Dialog,
  EmptyState,
  ErrorState,
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

type Subscription = {
  id: string;
  name: string;
  endpointUrl: string;
  eventTypes: string[];
  status: "active" | "disabled";
  signed: boolean;
  health: "disabled" | "failing" | "degraded" | "healthy" | "no_deliveries";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  pendingDeliveries: number;
  deadDeliveries: number;
};
type EventOption = { key: string; moduleKey: string; label: string; description: string };
type Delivery = { id: string; eventLabel: string; status: "pending" | "processing" | "retry" | "delivered" | "dead"; attemptCount: number; lastStatusCode: number | null; lastError: string | null; createdAt: string; deliveredAt: string | null; redeliveryCount: number };

const QUERY_KEY = ["settings", "integrations", "webhooks"];
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const HEALTH: Record<Subscription["health"], { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Some failures", tone: "warning" },
  failing: { label: "Failing", tone: "danger" },
  disabled: { label: "Disabled", tone: "neutral" },
  no_deliveries: { label: "No deliveries yet", tone: "info" },
};
const DELIVERY: Record<Delivery["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Queued", tone: "neutral" },
  processing: { label: "Sending", tone: "info" },
  retry: { label: "Will retry", tone: "warning" },
  delivered: { label: "Delivered", tone: "success" },
  dead: { label: "Failed", tone: "danger" },
};

export function WebhooksPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<{ subscriptions: Subscription[]; events: EventOption[] }>("/api/settings/integrations/webhooks") });
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Subscription | null>(null);
  const [rotating, setRotating] = useState<Subscription | null>(null);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (failure: unknown) => setError(failure instanceof Error ? failure.message : "The change could not be saved.");
  const toggle = useMutation({
    mutationFn: (subscription: Subscription) => requestJson(`/api/settings/integrations/webhooks/${subscription.id}`, { method: "PATCH", json: { status: subscription.status === "active" ? "disabled" : "active" } }),
    onSuccess: refresh,
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: (subscription: Subscription) => requestJson<{ signingSecret: string }>(`/api/settings/integrations/webhooks/${subscription.id}/rotate-secret`, { method: "POST" }),
    onSuccess: (result, subscription) => {
      setRotating(null);
      setSecret({ title: "New signing secret", description: `Deliveries to "${subscription.name}" are signed with this secret from now on.`, items: [{ label: "Signing secret", value: result.signingSecret }] });
      refresh();
    },
    onError: fail,
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError) return <ErrorState title="Could not load webhooks" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const { subscriptions, events } = query.data!;
  const eventLabel = new Map(events.map((event) => [event.key, event.label]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-text-secondary">
          Send selected events to your own HTTPS endpoint. Every delivery is signed (HMAC-SHA256, header <code className="font-mono">X-Vercentlabs-Signature</code>) and retried if it fails; delivery is at least once, so de-duplicate on the event id.
        </p>
        {canManage && (
          <Button variant="primary" onPress={() => setCreating(true)}>
            New webhook
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {subscriptions.length === 0 ? (
        <EmptyState title="No webhooks yet" description="Create one to receive events such as a lead being assigned." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <Table caption="Webhooks">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Webhook</TableHeaderCell>
                <TableHeaderCell>Events</TableHeaderCell>
                <TableHeaderCell>Health</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {subscriptions.map((subscription) => (
                <TableRow key={subscription.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-text">{subscription.name}</span>
                      <span className="break-all font-mono text-xs text-text-muted">{subscription.endpointUrl}</span>
                      {!subscription.signed && <span className="text-xs text-warning">Not signed yet: rotate the secret to start signing deliveries.</span>}
                    </div>
                  </TableCell>
                  <TableCell>{subscription.eventTypes.map((type) => eventLabel.get(type) ?? type).join(", ")}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge tone={HEALTH[subscription.health].tone}>{HEALTH[subscription.health].label}</StatusBadge>
                      {subscription.deadDeliveries > 0 && <span className="text-xs text-danger">{`${subscription.deadDeliveries} failed`}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="compact" onPress={() => setViewing(subscription)}>
                        Deliveries
                      </Button>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="compact" onPress={() => setRotating(subscription)}>
                            Rotate secret
                          </Button>
                          <Button variant="ghost" size="compact" isLoading={toggle.isPending && toggle.variables?.id === subscription.id} onPress={() => toggle.mutate(subscription)}>
                            {subscription.status === "active" ? "Disable" : "Enable"}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating && (
        <CreateWebhookDialog
          events={events}
          onClose={() => setCreating(false)}
          onCreated={(name, signingSecret) => {
            setCreating(false);
            setSecret({ title: "Webhook signing secret", description: `Use it to verify deliveries to "${name}".`, items: [{ label: "Signing secret", value: signingSecret }] });
            refresh();
          }}
        />
      )}
      {viewing && <DeliveriesDialog subscription={viewing} canManage={canManage} onClose={() => setViewing(null)} />}
      {secret && <SecretRevealDialog secret={secret} onDone={() => setSecret(null)} />}
      <AlertDialog
        isOpen={Boolean(rotating)}
        onOpenChange={(open) => !open && setRotating(null)}
        title="Rotate the signing secret?"
        description="Deliveries are signed with the new secret immediately; update your receiver before the next event."
        confirmLabel="Rotate secret"
        isConfirming={rotate.isPending}
        onConfirm={() => rotating && rotate.mutate(rotating)}
      />
    </div>
  );
}

function CreateWebhookDialog({ events, onClose, onCreated }: { events: EventOption[]; onClose: () => void; onCreated: (name: string, secret: string) => void }) {
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("https://");
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => requestJson<{ signingSecret: string }>("/api/settings/integrations/webhooks", { method: "POST", json: { name, endpointUrl, eventTypes } }),
    onSuccess: (result) => onCreated(name, result.signingSecret),
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The webhook could not be created."),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New webhook" size="lg">
      <div className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={setName} isRequired />
        <TextField label="Endpoint URL" value={endpointUrl} onChange={setEndpointUrl} isRequired description="A public HTTPS address. Private and internal addresses are refused." />
        <CheckboxGroup label="Events" value={eventTypes} onChange={setEventTypes} isRequired>
          {events.map((event) => (
            <Checkbox key={event.key} value={event.key}>
              <span className="flex flex-col">
                <span className="text-sm text-text">{event.label}</span>
                <span className="text-xs text-text-muted">{event.description}</span>
              </span>
            </Checkbox>
          ))}
        </CheckboxGroup>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!name.trim() || !endpointUrl.trim() || eventTypes.length === 0} isLoading={create.isPending} onPress={() => create.mutate()}>
            Create webhook
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DeliveriesDialog({ subscription, canManage, onClose }: { subscription: Subscription; canManage: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = [...QUERY_KEY, "deliveries", subscription.id];
  const query = useQuery({ queryKey: key, queryFn: () => requestJson<{ deliveries: Delivery[] }>(`/api/settings/integrations/webhooks/${subscription.id}/deliveries`) });
  const redeliver = useMutation({
    mutationFn: (id: string) => requestJson(`/api/settings/integrations/webhook-deliveries/${id}/redeliver`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const deliveries = query.data?.deliveries ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Recent deliveries: ${subscription.name}`} size="xl">
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : deliveries.length === 0 ? (
        <EmptyState title="No deliveries yet" description="Deliveries appear here when a subscribed event happens." />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Recent deliveries">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Attempts</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{delivery.eventLabel}</span>
                      {delivery.lastError && <span className="text-xs text-text-muted">{delivery.lastError}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{formatter.format(new Date(delivery.createdAt))}</TableCell>
                  <TableCell>
                    <StatusBadge tone={DELIVERY[delivery.status].tone}>{DELIVERY[delivery.status].label}</StatusBadge>
                  </TableCell>
                  <TableCell>{`${delivery.attemptCount}${delivery.redeliveryCount ? ` (resent ${delivery.redeliveryCount}×)` : ""}`}</TableCell>
                  <TableCell>
                    {canManage && (delivery.status === "dead" || delivery.status === "retry") && (
                      <Button variant="secondary" size="compact" isLoading={redeliver.isPending && redeliver.variables === delivery.id} onPress={() => redeliver.mutate(delivery.id)}>
                        Send again
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
