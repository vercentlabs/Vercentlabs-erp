import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./StatusBadge.tsx";

const meta: Meta<typeof StatusBadge> = {
  title: "Data Display/StatusBadge",
  component: StatusBadge,
  args: { children: "Qualified" },
};
export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Neutral: Story = { args: { tone: "neutral", children: "Draft" } };
export const Info: Story = { args: { tone: "info", children: "In review" } };
export const Success: Story = { args: { tone: "success", children: "Won" } };
export const Warning: Story = { args: { tone: "warning", children: "At risk" } };
export const Danger: Story = { args: { tone: "danger", children: "Overdue" } };

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="neutral">Draft</StatusBadge>
      <StatusBadge tone="info">In review</StatusBadge>
      <StatusBadge tone="success">Won</StatusBadge>
      <StatusBadge tone="warning">At risk</StatusBadge>
      <StatusBadge tone="danger">Overdue</StatusBadge>
    </div>
  ),
};
