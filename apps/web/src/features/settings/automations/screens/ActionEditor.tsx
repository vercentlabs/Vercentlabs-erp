"use client";

// One "then" step of an automation: a notification, or (for a module's own events) one of that module's actions — for CRM, plan a
// follow-up, give the record an owner, set its priority, add a tag, email the person from a template, or tell the record's followers.
import { useQuery } from "@tanstack/react-query";
import { Button, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { requestJson } from "@/shared/http/request-json";

type Field = { key: string; label: string; type?: "user" | "list" | "number" };
type Recipient = { type: "event_field"; field: string } | { type: "user"; userId: string };
export type ActionDefinition = { key: string; label: string; description: string; module?: string };
export type Action =
  | { type: "notify"; recipient: Recipient; title: string; message: string }
  | { type: "crm.create_follow_up"; followUpType: string; inHours: number; subject?: string; assignee: { type: "record_owner" } | Recipient }
  | { type: "crm.assign_owner"; userId: string }
  | { type: "crm.set_priority"; priority: "low" | "medium" | "high" }
  | { type: "crm.add_tag"; tag: string }
  | { type: "crm.send_email"; templateId: string }
  | { type: "crm.notify_followers"; title: string; message?: string }
  | { type: "send_email"; to: Recipient | { type: "address"; email: string }; subject: string; body: string }
  | { type: "create_activity"; activityType: "to_do" | "call" | "meeting" | "email"; summary: string; inDays: number; assignee: Recipient }
  | { type: "assign"; userId: string };
const ACTIVITY_KINDS = [
  { value: "to_do", label: "To-do" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
];

const FOLLOW_UP_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "demo", label: "Demo" },
  { value: "visit", label: "Visit" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "other", label: "Other" },
];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function blankAction(type: string): Action {
  switch (type) {
    case "crm.create_follow_up":
      return { type, followUpType: "call", inHours: 24, subject: "", assignee: { type: "record_owner" } };
    case "crm.assign_owner":
      return { type, userId: "" };
    case "crm.set_priority":
      return { type, priority: "high" };
    case "crm.add_tag":
      return { type, tag: "" };
    case "crm.send_email":
      return { type, templateId: "" };
    case "crm.notify_followers":
      return { type, title: "", message: "" };
    case "send_email":
      return { type, to: { type: "user", userId: "" }, subject: "", body: "" };
    case "create_activity":
      return { type, activityType: "call", summary: "", inDays: 1, assignee: { type: "user", userId: "" } };
    case "assign":
      return { type, userId: "" };
    default:
      return { type: "notify", recipient: { type: "user", userId: "" }, title: "", message: "" };
  }
}

// Whether the step has what it needs to be saved.
export function actionReady(action: Action) {
  switch (action.type) {
    case "notify":
      return Boolean(action.title.trim()) && (action.recipient.type === "event_field" || Boolean(action.recipient.userId));
    case "crm.create_follow_up":
      return Number.isFinite(action.inHours) && action.inHours >= 0 && (action.assignee.type !== "user" || Boolean(action.assignee.userId));
    case "crm.assign_owner":
      return Boolean(action.userId);
    case "crm.add_tag":
      return Boolean(action.tag.trim());
    case "crm.send_email":
      return Boolean(action.templateId);
    case "crm.notify_followers":
      return Boolean(action.title.trim());
    case "send_email":
      return Boolean(action.subject.trim()) && Boolean(action.body.trim())
        && (action.to.type === "event_field" || (action.to.type === "user" ? Boolean(action.to.userId) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.to.email)));
    case "create_activity":
      return Boolean(action.summary.trim()) && Number.isInteger(action.inDays) && action.inDays >= 0 && (action.assignee.type === "event_field" || Boolean(action.assignee.userId));
    case "assign":
      return Boolean(action.userId);
    default:
      return true;
  }
}

// After the trigger changes: steps pointing at a person "from the event" go back to a named member, and steps of another module are
// replaced by a notification.
export function adaptAction(action: Action, available: ActionDefinition[]): Action {
  if (!available.some((entry) => entry.key === action.type)) return blankAction("notify");
  if (action.type === "notify" && action.recipient.type === "event_field") return { ...action, recipient: { type: "user", userId: "" } };
  if (action.type === "crm.create_follow_up" && action.assignee.type === "event_field") return { ...action, assignee: { type: "record_owner" } };
  if (action.type === "send_email" && action.to.type === "event_field") return { ...action, to: { type: "user", userId: "" } };
  if (action.type === "create_activity" && action.assignee.type === "event_field") return { ...action, assignee: { type: "user", userId: "" } };
  return action;
}

export function ActionEditor({
  action, available, userFields, members, onChange, onRemove,
}: {
  action: Action;
  available: ActionDefinition[];
  userFields: Field[];
  members: Array<{ value: string; label: string }>;
  onChange: (action: Action) => void;
  onRemove?: () => void;
}) {
  const definition = available.find((entry) => entry.key === action.type);
  // the organization's activity types (CRM plan 5.2), else the standard ones
  const activityTypes = useQuery({
    queryKey: ["settings", "automations", "crm-activity-types"],
    queryFn: () => requestJson<{ types: Array<{ code: string; name: string }> }>("/api/crm/activity-types").then((result) => result.types.map((type) => ({ value: type.code, label: type.name }))),
    enabled: action.type === "crm.create_follow_up",
  });
  const templates = useQuery({
    queryKey: ["settings", "automations", "crm-email-templates"],
    queryFn: () => requestJson<{ templates: Array<{ id: string; name: string }> }>("/api/crm/email-templates").then((result) => result.templates),
    enabled: action.type === "crm.send_email",
  });

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      <Select
        label="Do this"
        options={available.map((entry) => ({ value: entry.key, label: entry.label }))}
        selectedKey={action.type}
        onSelectionChange={(key) => String(key) !== action.type && onChange(blankAction(String(key)))}
      />
      {definition && <p className="text-xs text-text-muted">{definition.description}</p>}

      {action.type === "notify" && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="To"
              options={[...userFields.map((field) => ({ value: `field:${field.key}`, label: field.label })), { value: "member", label: "A specific member" }]}
              selectedKey={action.recipient.type === "event_field" ? `field:${action.recipient.field}` : "member"}
              onSelectionChange={(key) =>
                onChange({ ...action, recipient: String(key).startsWith("field:") ? { type: "event_field", field: String(key).slice(6) } : { type: "user", userId: "" } })}
            />
            {action.recipient.type === "user" && (
              <Select label="Member" options={members} selectedKey={action.recipient.userId || null}
                onSelectionChange={(key) => onChange({ ...action, recipient: { type: "user", userId: String(key) } })} />
            )}
          </div>
          <TextField label="Title" value={action.title} onChange={(title) => onChange({ ...action, title })} isRequired maxLength={120} />
          <TextArea label="Message" value={action.message} onChange={(message) => onChange({ ...action, message })} maxLength={500} />
        </>
      )}

      {action.type === "crm.create_follow_up" && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select label="Follow up by" options={activityTypes.data ?? FOLLOW_UP_TYPES} selectedKey={action.followUpType}
              onSelectionChange={(key) => onChange({ ...action, followUpType: String(key) })} />
            <TextField label="Hours after the event" type="number" value={String(action.inHours)}
              description="0 is straight away; 24 is a day later (up to 90 days)."
              onChange={(value) => onChange({ ...action, inHours: value === "" ? Number.NaN : Number(value) })} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="For"
              options={[
                { value: "record_owner", label: "The record's owner" },
                ...userFields.map((field) => ({ value: `field:${field.key}`, label: field.label })),
                { value: "member", label: "A specific member" },
              ]}
              selectedKey={action.assignee.type === "record_owner" ? "record_owner" : action.assignee.type === "event_field" ? `field:${action.assignee.field}` : "member"}
              onSelectionChange={(key) => {
                const value = String(key);
                onChange({ ...action, assignee: value === "record_owner" ? { type: "record_owner" } : value.startsWith("field:") ? { type: "event_field", field: value.slice(6) } : { type: "user", userId: "" } });
              }}
            />
            {action.assignee.type === "user" && (
              <Select label="Member" options={members} selectedKey={action.assignee.userId || null}
                onSelectionChange={(key) => onChange({ ...action, assignee: { type: "user", userId: String(key) } })} />
            )}
          </div>
          <TextField label="Subject (optional)" value={action.subject ?? ""} onChange={(subject) => onChange({ ...action, subject })} maxLength={200} />
        </>
      )}

      {action.type === "crm.assign_owner" && (
        <Select label="Give it to" options={members} selectedKey={action.userId || null} onSelectionChange={(key) => onChange({ ...action, userId: String(key) })} />
      )}

      {action.type === "crm.set_priority" && (
        <Select label="Priority" options={PRIORITIES} selectedKey={action.priority}
          onSelectionChange={(key) => onChange({ ...action, priority: String(key) as "low" | "medium" | "high" })} />
      )}

      {action.type === "crm.add_tag" && (
        <TextField label="Tag" value={action.tag} onChange={(tag) => onChange({ ...action, tag })} isRequired maxLength={60}
          description="An existing tag of this name is used; otherwise it is created." />
      )}

      {action.type === "crm.send_email" && (
        templates.isError ? (
          <p className="text-sm text-danger">The email templates could not be loaded. You need access to CRM to choose one.</p>
        ) : templates.data && templates.data.length === 0 ? (
          <p className="text-sm text-text-secondary">There are no email templates yet. Add one in CRM › Settings › Email templates.</p>
        ) : (
          <Select label="Template" options={(templates.data ?? []).map((template) => ({ value: template.id, label: template.name }))}
            selectedKey={action.templateId || null} isDisabled={templates.isLoading}
            onSelectionChange={(key) => onChange({ ...action, templateId: String(key) })} />
        )
      )}

      {action.type === "crm.notify_followers" && (
        <>
          <TextField label="Title" value={action.title} onChange={(title) => onChange({ ...action, title })} isRequired maxLength={120} />
          <TextArea label="Message" value={action.message ?? ""} onChange={(message) => onChange({ ...action, message })} maxLength={500} />
        </>
      )}

      {action.type === "send_email" && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="To"
              options={[...userFields.map((field) => ({ value: `field:${field.key}`, label: field.label })), { value: "member", label: "A specific member" }, { value: "address", label: "An email address" }]}
              selectedKey={action.to.type === "event_field" ? `field:${action.to.field}` : action.to.type}
              onSelectionChange={(key) => {
                const value = String(key);
                onChange({ ...action, to: value.startsWith("field:") ? { type: "event_field", field: value.slice(6) } : value === "address" ? { type: "address", email: "" } : { type: "user", userId: "" } });
              }}
            />
            {action.to.type === "user" && (
              <Select label="Member" options={members} selectedKey={action.to.userId || null} onSelectionChange={(key) => onChange({ ...action, to: { type: "user", userId: String(key) } })} />
            )}
            {action.to.type === "address" && (
              <TextField label="Email address" type="email" value={action.to.email} onChange={(email) => onChange({ ...action, to: { type: "address", email } })} />
            )}
          </div>
          <TextField label="Subject" value={action.subject} onChange={(subject) => onChange({ ...action, subject })} isRequired maxLength={200}
            description="Use {{field}} for the event's values, for example {{invoiceNumber}}." />
          <TextArea label="Message" value={action.body} onChange={(body) => onChange({ ...action, body })} isRequired maxLength={4000} />
        </>
      )}

      {action.type === "create_activity" && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select label="Activity" options={ACTIVITY_KINDS} selectedKey={action.activityType}
              onSelectionChange={(key) => onChange({ ...action, activityType: String(key) as "to_do" | "call" | "meeting" | "email" })} />
            <TextField label="Due (days after)" type="number" value={String(action.inDays)}
              onChange={(value) => onChange({ ...action, inDays: value === "" ? Number.NaN : Number(value) })} />
            <Select
              label="For"
              options={[...userFields.map((field) => ({ value: `field:${field.key}`, label: field.label })), { value: "member", label: "A specific member" }]}
              selectedKey={action.assignee.type === "event_field" ? `field:${action.assignee.field}` : "member"}
              onSelectionChange={(key) => onChange({ ...action, assignee: String(key).startsWith("field:") ? { type: "event_field", field: String(key).slice(6) } : { type: "user", userId: "" } })}
            />
          </div>
          {action.assignee.type === "user" && (
            <Select label="Member" options={members} selectedKey={action.assignee.userId || null} onSelectionChange={(key) => onChange({ ...action, assignee: { type: "user", userId: String(key) } })} />
          )}
          <TextField label="What to do" value={action.summary} onChange={(summary) => onChange({ ...action, summary })} isRequired maxLength={300}
            description="For example: Call {{customerId}} about invoice {{invoiceNumber}}." />
        </>
      )}

      {action.type === "assign" && (
        <Select label="Hand it to" options={members} selectedKey={action.userId || null} onSelectionChange={(key) => onChange({ ...action, userId: String(key) })} />
      )}

      {onRemove && (
        <div>
          <Button variant="ghost" size="compact" onPress={onRemove}>Remove this step</Button>
        </div>
      )}
    </div>
  );
}
