import type { Meta, StoryObj } from "@storybook/react-vite";
import { EnterpriseDataGrid } from "./EnterpriseDataGrid.tsx";
import { StatusBadge } from "../../data-display/StatusBadge.tsx";
import type { ColumnDef } from "@tanstack/react-table";

interface Lead {
  id: string;
  name: string;
  company: string;
  stage: "new" | "qualified" | "won";
}

const data: Lead[] = [
  { id: "1", name: "Jane Cooper", company: "Acme Corp", stage: "qualified" },
  { id: "2", name: "Tom Alter", company: "Globex", stage: "new" },
  { id: "3", name: "Priya Nair", company: "Initech", stage: "won" },
];

const columns: ColumnDef<Lead, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "company", header: "Company" },
  {
    accessorKey: "stage",
    header: "Stage",
    cell: ({ getValue }) => {
      const v = getValue<Lead["stage"]>();
      return <StatusBadge tone={v === "won" ? "success" : v === "qualified" ? "info" : "neutral"}>{v}</StatusBadge>;
    },
  },
];

const meta: Meta<typeof EnterpriseDataGrid<Lead>> = {
  title: "Enterprise/EnterpriseDataGrid",
  component: EnterpriseDataGrid,
  args: { "aria-label": "Leads", columns, data },
};
export default meta;
type Story = StoryObj<typeof EnterpriseDataGrid<Lead>>;

export const Default: Story = {};
export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty" } };
export const NoResults: Story = { args: { data: [], state: "no-results" } };
export const ErrorState: Story = { args: { state: "error" } };
export const PermissionDenied: Story = { args: { state: "permission-denied" } };
export const WithRowSelection: Story = { args: { enableRowSelection: true } };
export const CompactDensity: Story = { args: { density: "compact" } };
