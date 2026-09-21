"use client";

import type { RegisterConfig } from "@/features/support/shared/Register";
import { badge, col, link, opts, text } from "@/features/support/shared/helpers";

// F371: the customer portal's own ticket list and knowledge browse -- both reuse the same Register
// component; the server scopes every row to the caller's own linked customer party.
export const myTickets: RegisterConfig = {
  key: "my-tickets",
  title: "My tickets",
  description: "Tickets you have raised with us.",
  searchLabel: "Search my tickets",
  emptyTitle: "No tickets yet",
  emptyDescription: "Raise a ticket if you need help.",
  source: { kind: "view", view: "my-tickets" },
  filters: [{ name: "status", label: "Status", options: opts("new", "open", "pending_customer", "pending_internal", "resolved", "closed") }],
  createLabel: "New ticket",
  save: { action: "my-ticket-create", success: "Ticket created." },
  fields: [
    { name: "subject", label: "Subject", kind: "text", required: true, wide: true },
    { name: "description", label: "Description", kind: "textarea", required: true, wide: true },
  ],
  columns: () => [
    link("ticket", "Ticket", (r) => String(r.ticket_number), (r) => `/support/portal-ticket/${String(r.id)}`),
    col("subject", "Subject", (r) => String(r.subject)),
    badge("status", "Status", (r) => r.status),
    col("created", "Created", (r) => String(r.created_at).slice(0, 10)),
  ],
  searchText: (r) => text(r, ["ticket_number", "subject", "status"]),
};

export const myKnowledge: RegisterConfig = {
  key: "my-knowledge",
  title: "Help articles",
  description: "Answers to common questions.",
  searchLabel: "Search help articles",
  emptyTitle: "No articles yet",
  emptyDescription: "Nothing published yet.",
  source: { kind: "view", view: "my-knowledge-articles" },
  columns: () => [link("title", "Title", (r) => String(r.title), (r) => `/support/portal-article/${String(r.id)}`), col("summary", "Summary", (r) => String(r.summary ?? "")), col("category", "Category", (r) => String(r.category_name ?? "—"))],
  searchText: (r) => text(r, ["title", "summary"]),
};

export const PORTAL_REGISTERS: Record<string, RegisterConfig> = {
  "my-tickets": myTickets,
  "my-knowledge": myKnowledge,
};
