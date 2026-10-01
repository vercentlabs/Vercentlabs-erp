"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  PageHeader,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { CrmDashboardScreen } from "@/features/crm/home/dashboard/screens/CrmDashboardScreen";

const CREATE_LINKS = [
  { label: "Lead", href: "/crm/leads/new" },
  { label: "Account", href: "/crm/accounts/new" },
  { label: "Contact", href: "/crm/contacts/new" },
  { label: "Opportunity", href: "/crm/opportunities/new" },
  { label: "Call", href: "/crm/calls/new" },
  { label: "Meeting", href: "/crm/meetings/new" },
  { label: "Follow-up", href: "/crm/follow-ups/new" },
  { label: "Task", href: "/crm/tasks/new" },
];

// CRM Home is the command centre and the only CRM overview: the canonical
// pipeline dashboard (F024 — every figure a permission-safe aggregate that
// opens the records behind it) under a personal header. /crm/dashboard
// redirects here, so there is one set of KPIs, not two copies. Workspaces
// are reached from the CRM sidebar, not repeated here as tiles.
export function CrmHomeScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${workspace.fullName.split(" ")[0] || workspace.fullName}`}
        description="What changed, what needs attention, and what to do next. Every number opens the records behind it."
        primaryAction={
          <MenuTrigger>
            <Button variant="primary">
              <Plus className="size-4" aria-hidden="true" />
              Create
            </Button>
            <Menu onAction={(key) => router.push(String(key))}>
              {CREATE_LINKS.map((link) => (
                <MenuItem key={link.href} id={link.href}>
                  {link.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        }
      />
      <CrmDashboardScreen embedded />
    </div>
  );
}
