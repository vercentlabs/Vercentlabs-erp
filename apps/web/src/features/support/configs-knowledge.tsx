"use client";

import { act } from "@/features/support/shared/client";
import type { RegisterConfig } from "@/features/support/shared/Register";
import { badge, col, opts, quantity, strong, text } from "@/features/support/shared/helpers";

// ---------------------------------------------------------------- F369: knowledge base
const knowledgeArticles: RegisterConfig = {
  key: "knowledge-articles",
  title: "Knowledge base",
  description: "Draft, submit for review, then a second person publishes it (customer/public articles reach the portal and search). Publishing your own article is blocked -- ask someone else to review it.",
  searchLabel: "Search articles",
  emptyTitle: "No articles yet",
  emptyDescription: "Write an article for common questions.",
  source: { kind: "view", view: "knowledge-articles" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "review", "published", "retired") }, { name: "visibility", label: "Visibility", options: opts("internal", "customer", "public") }],
  createLabel: "New article",
  createPermission: "support.knowledge.manage",
  save: { action: "article-save", success: "Saved." },
  edit: { action: "article-save", permission: "support.knowledge.manage", show: (r) => r.status !== "published" },
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "summary", label: "Summary", kind: "text", wide: true },
    { name: "content", label: "Content", kind: "textarea", required: true, wide: true },
    { name: "categoryId", label: "Category", kind: "select", options: "categories", rowKey: "category_id" },
    { name: "visibility", label: "Visibility", kind: "select", defaultValue: "internal", options: opts("internal", "customer", "public") },
  ],
  columns: () => [
    strong("number", "Number", (r) => String(r.article_number)),
    col("title", "Title", (r) => String(r.title)),
    col("category", "Category", (r) => String(r.category_name ?? "—")),
    badge("visibility", "Visibility", (r) => r.visibility),
    col("version", "Version", (r) => quantity(r.version)),
    col("helpful", "Helpful", (r) => `${quantity(r.helpful_count)} / ${quantity(Number(r.helpful_count ?? 0) + Number(r.not_helpful_count ?? 0))}`),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["article_number", "title", "summary", "status", "visibility"]),
  rowActions: [
    { label: "Submit for review", permission: "support.knowledge.manage", show: (r) => r.status === "draft", run: (r) => act("article-submit", { id: r.id }), success: "Submitted for review." },
    { label: "Publish", permission: "support.knowledge.manage", show: (r) => r.status === "review", run: (r) => act("article-publish", { id: r.id, approve: true }), success: "Published." },
    { label: "Send back", permission: "support.knowledge.manage", show: (r) => r.status === "review", run: (r) => act("article-publish", { id: r.id, approve: false }), success: "Sent back to draft." },
    { label: "Retire", permission: "support.knowledge.manage", show: (r) => r.status === "published", note: { label: "Reason", required: true }, run: (r, note) => act("article-retire", { id: r.id, reason: note }), success: "Retired." },
    { label: "New version", permission: "support.knowledge.manage", show: (r) => r.status === "retired", run: (r) => act("article-revise", { id: r.id }), success: "A new draft version was created." },
  ],
};

// ---------------------------------------------------------------- F370: canned responses
const cannedResponses: RegisterConfig = {
  key: "canned-responses",
  title: "Canned responses",
  description: "Reusable replies for common questions. Shared responses are visible to every agent; unshared ones are private to whoever made them.",
  searchLabel: "Search canned responses",
  emptyTitle: "No canned responses yet",
  emptyDescription: "Add a reply you send often.",
  source: { kind: "view", view: "canned-responses" },
  createLabel: "New canned response",
  createPermission: "support.communication.manage",
  save: { action: "canned-response-save", success: "Saved." },
  edit: { action: "canned-response-save", permission: "support.communication.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "categoryId", label: "Category", kind: "select", options: "categories", rowKey: "category_id" },
    { name: "subject", label: "Subject (for email)", kind: "text" },
    { name: "body", label: "Body", kind: "textarea", required: true, wide: true },
    { name: "shared", label: "Shared with every agent", kind: "bool", defaultValue: "true" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("category", "Category", (r) => String(r.category_name ?? "—")), badge("shared", "Visibility", (r) => (r.shared ? "shared" : "private")), col("used", "Used", (r) => quantity(r.usage_count))],
  searchText: (r) => text(r, ["code", "name", "body"]),
};

export const KNOWLEDGE_REGISTERS: Record<string, RegisterConfig> = {
  "knowledge-articles": knowledgeArticles,
  "canned-responses": cannedResponses,
};
