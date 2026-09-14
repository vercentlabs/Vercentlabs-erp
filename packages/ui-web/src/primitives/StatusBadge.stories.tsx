import type { Meta, StoryObj } from "@storybook/nextjs";

import { StatusBadge } from "./StatusBadge";

const meta: Meta<typeof StatusBadge> = {
  title: "Primitives/StatusBadge",
  component: StatusBadge,
  args: { children: "Active" },
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const Default: Story = {};

export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <StatusBadge tone="neutral">Draft</StatusBadge>
      <StatusBadge tone="success">Active</StatusBadge>
      <StatusBadge tone="warning">Pending approval</StatusBadge>
      <StatusBadge tone="danger">Blocked</StatusBadge>
      <StatusBadge tone="info">Processing</StatusBadge>
    </div>
  ),
};

export const LongText: Story = {
  args: { children: "Awaiting multi-level segregation-of-duties approval", tone: "warning" },
};
