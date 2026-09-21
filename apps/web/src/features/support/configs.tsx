"use client";

import { act } from "@/features/support/shared/client";
import type { RegisterConfig } from "@/features/support/shared/Register";
import { badge, col, opts, quantity, strong, text } from "@/features/support/shared/helpers";

const PRIORITIES = opts("low", "normal", "high", "urgent", "critical");
const CHANNELS = opts("web", "email", "phone", "chat", "whatsapp", "social", "internal");

// ---------------------------------------------------------------- F347: categories
const categories: RegisterConfig = {
  key: "categories",
  title: "Categories",
  description: "What a ticket is about. A category can set the default queue and priority a ticket routes to.",
  searchLabel: "Search categories",
  emptyTitle: "No categories yet",
  emptyDescription: "Add a category such as Billing or Technical Issue.",
  source: { kind: "view", view: "categories" },
  createLabel: "New category",
  createPermission: "support.manage",
  save: { action: "category-save", success: "Saved." },
  edit: { action: "category-save", permission: "support.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "description", label: "Description", kind: "textarea", wide: true },
    { name: "defaultPriority", label: "Default priority", kind: "select", defaultValue: "normal", options: PRIORITIES, rowKey: "default_priority" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("parent", "Parent", (r) => String(r.parent_name ?? "—")), badge("priority", "Default priority", (r) => r.default_priority), col("queue", "Default queue", (r) => String(r.default_queue_name ?? "—")), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name", "description"]),
};

// ---------------------------------------------------------------- F350/F351: queues
const queues: RegisterConfig = {
  key: "queues",
  title: "Queues",
  description: "Where tickets land. Round-robin, least-loaded and skills-based queues auto-assign to a member; manual queues wait for an agent to pick a ticket up.",
  searchLabel: "Search queues",
  emptyTitle: "No queues yet",
  emptyDescription: "Add a queue such as Tier 1 Support.",
  source: { kind: "view", view: "queues" },
  createLabel: "New queue",
  createPermission: "support.queue.manage",
  save: { action: "queue-save", success: "Saved." },
  edit: { action: "queue-save", permission: "support.queue.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "description", label: "Description", kind: "textarea", wide: true },
    { name: "assignmentStrategy", label: "Assignment strategy", kind: "select", defaultValue: "manual", options: opts("manual", "round_robin", "least_loaded", "skills_based"), rowKey: "assignment_strategy" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), badge("strategy", "Strategy", (r) => r.assignment_strategy), col("members", "Members", (r) => quantity(r.member_count)), col("open", "Open tickets", (r) => quantity(r.open_tickets)), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name"]),
  rowActions: [
    {
      label: "Add member",
      permission: "support.queue.manage",
      fields: [{ name: "userId", label: "Agent", kind: "select", options: "agents", required: true }, { name: "capacity", label: "Capacity", kind: "number", step: 1, min: 1, defaultValue: 20 }],
      run: (r, _n, v) => act("queue-member-set", { queueId: r.id, userId: v.userId, capacity: v.capacity }),
      success: "Member added.",
    },
  ],
};

// ---------------------------------------------------------------- F352: routing rules
const routingRules: RegisterConfig = {
  key: "routing-rules",
  title: "Routing rules",
  description: "The first active rule that matches a new ticket's channel, category or a keyword in its subject/description sends it to a queue and (optionally) sets its priority. Unmatched tickets fall back to the category's default queue.",
  searchLabel: "Search routing rules",
  emptyTitle: "No routing rules yet",
  emptyDescription: "Add a rule to route matching tickets automatically.",
  source: { kind: "view", view: "routing-rules" },
  createLabel: "New routing rule",
  createPermission: "support.queue.manage",
  save: { action: "routing-rule-save", success: "Saved." },
  edit: { action: "routing-rule-save", permission: "support.queue.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "sequence", label: "Sequence (lower runs first)", kind: "number", step: 10, defaultValue: 100 },
    { name: "matchChannel", label: "Match channel (any if blank)", kind: "select", options: CHANNELS, rowKey: "match_channel" },
    { name: "matchCategoryId", label: "Match category (any if blank)", kind: "select", options: "categories", rowKey: "match_category_id" },
    { name: "matchKeyword", label: "Match keyword in subject/description (any if blank)", kind: "text", rowKey: "match_keyword" },
    { name: "targetQueueId", label: "Send to queue", kind: "select", options: "queues", rowKey: "target_queue_id" },
    { name: "targetPriority", label: "Set priority", kind: "select", options: PRIORITIES, rowKey: "target_priority" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    col("seq", "Seq", (r) => quantity(r.sequence)),
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("match", "Matches", (r) => [r.match_channel, r.match_category_name, r.match_keyword ? `"${r.match_keyword}"` : null].filter(Boolean).join(" / ") || "Everything"),
    col("target", "Sends to", (r) => String(r.target_queue_name ?? "—")),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "match_keyword"]),
  rowActions: [{ label: "Deactivate", permission: "support.queue.manage", show: (r) => Boolean(r.active), run: (r) => act("routing-rule-deactivate", { id: r.id }), success: "Deactivated." }],
};

// ---------------------------------------------------------------- F359-361: SLA policies
const slaPolicies: RegisterConfig = {
  key: "sla-policies",
  title: "SLA policies",
  description: "First-response and resolution targets, by priority. A business-hours-only policy counts Mon-Fri 09:00-18:00; waiting on the customer can pause the clock.",
  searchLabel: "Search SLA policies",
  emptyTitle: "No SLA policies yet",
  emptyDescription: "Add a policy such as Standard or Premium.",
  source: { kind: "view", view: "sla-policies" },
  createLabel: "New SLA policy",
  createPermission: "support.sla.manage",
  save: { action: "sla-policy-save", success: "Saved." },
  edit: { action: "sla-policy-save", permission: "support.sla.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "priority", label: "Priority (any if blank)", kind: "select", options: PRIORITIES },
    { name: "firstResponseMinutes", label: "First-response target (minutes)", kind: "number", step: 15, min: 1, required: true, rowKey: "first_response_minutes" },
    { name: "resolutionMinutes", label: "Resolution target (minutes)", kind: "number", step: 30, min: 1, required: true, rowKey: "resolution_minutes" },
    { name: "businessHoursOnly", label: "Business hours only", kind: "bool", defaultValue: "true", rowKey: "business_hours_only" },
    { name: "pauseOnPendingCustomer", label: "Pause while waiting on the customer", kind: "bool", defaultValue: "true", rowKey: "pause_on_pending_customer" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("priority", "Priority", (r) => (r.priority ? String(r.priority) : "Any")),
    col("first", "First response", (r) => `${quantity(r.first_response_minutes)} min`),
    col("resolution", "Resolution", (r) => `${quantity(r.resolution_minutes)} min`),
    badge("hours", "Hours", (r) => (r.business_hours_only ? "business hours" : "24x7")),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "priority"]),
  rowActions: [{ label: "Deactivate", permission: "support.sla.manage", show: (r) => Boolean(r.active), run: (r) => act("sla-policy-deactivate", { id: r.id }), success: "Deactivated." }],
};

// ---------------------------------------------------------------- F363: escalation policies
const escalationPolicies: RegisterConfig = {
  key: "escalation-policies",
  title: "Escalation policies",
  description: "What happens when a ticket breaches (or is at risk of breaching) its SLA, or is escalated manually: where it goes, and whether its priority is raised.",
  searchLabel: "Search escalation policies",
  emptyTitle: "No escalation policies yet",
  emptyDescription: "Add a policy for a first-response or resolution risk.",
  source: { kind: "view", view: "escalation-policies" },
  createLabel: "New escalation policy",
  createPermission: "support.escalation.manage",
  save: { action: "escalation-policy-save", success: "Saved." },
  edit: { action: "escalation-policy-save", permission: "support.escalation.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "triggerType", label: "Trigger", kind: "select", defaultValue: "manual", options: opts("first_response_risk", "resolution_risk", "priority", "customer_tier", "manual"), rowKey: "trigger_type" },
    { name: "targetQueueId", label: "Escalate to queue", kind: "select", options: "queues", rowKey: "target_queue_id" },
    { name: "targetUserId", label: "Escalate to agent", kind: "select", options: "agents", rowKey: "target_user_id" },
    { name: "priorityOverride", label: "Raise priority to", kind: "select", options: PRIORITIES, rowKey: "priority_override" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), badge("trigger", "Trigger", (r) => r.trigger_type), col("override", "Priority override", (r) => String(r.priority_override ?? "—")), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name", "trigger_type"]),
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  categories,
  queues,
  "routing-rules": routingRules,
  "sla-policies": slaPolicies,
  "escalation-policies": escalationPolicies,
};
