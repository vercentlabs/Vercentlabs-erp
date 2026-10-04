"use client";

// The CRM "+ Create" menu: the six things a salesperson starts from scratch.
// A quotation is not here: it belongs to Sales and is started from its
// opportunity (Opportunity → Create Quotation).
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const CREATE_LINKS = [
  { label: "Lead", href: "/crm/leads/new", permission: "crm.leads.create" },
  { label: "Account", href: "/crm/accounts/new", permission: "crm.accounts.create" },
  { label: "Contact", href: "/crm/contacts/new", permission: "crm.contacts.create" },
  { label: "Opportunity", href: "/crm/opportunities/new", permission: "crm.opportunities.create" },
  { label: "Task", href: "/crm/tasks/new", permission: "crm.tasks.create" },
  { label: "Follow-up", href: "/crm/follow-ups/new", permission: "crm.follow_ups.create" },
];

export function CrmCreateMenu({ size = "standard" }: { size?: "compact" | "standard" }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const owner = workspace.roleSlugs.includes("organization_owner");
  const links = CREATE_LINKS.filter((link) => owner || workspace.permissions.includes(link.permission));
  if (links.length === 0) return null;
  return (
    <MenuTrigger>
      <Button variant="primary" size={size}>
        <Plus className="size-4" aria-hidden="true" />
        Create
      </Button>
      <Menu onAction={(key) => router.push(String(key))}>
        {links.map((link) => <MenuItem key={link.href} id={link.href}>{link.label}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  );
}
