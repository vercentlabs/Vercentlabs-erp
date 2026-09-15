import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "./Dialog.tsx";
import { Button } from "../actions/Button.tsx";
import { TextField } from "../data-entry/TextField.tsx";
import { Stack } from "../layout/Stack.tsx";

const meta: Meta<typeof Dialog> = {
  title: "Overlays/Dialog",
  component: Dialog,
  args: {
    defaultOpen: true,
    title: "Edit contact",
    description: "Update the primary contact for this account.",
    children: (
      <Stack gap={4}>
        <TextField label="Name" defaultValue="Jane Cooper" />
        <TextField label="Email" defaultValue="jane@example.com" />
      </Stack>
    ),
  },
};
export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {};
export const WithoutCloseButton: Story = { args: { hideCloseButton: true } };
export const Small: Story = { args: { size: "sm" } };
export const Large: Story = { args: { size: "lg" } };

export const WithFooterActions: Story = {
  args: {
    children: (
      <Stack gap={4}>
        <TextField label="Name" defaultValue="Jane Cooper" />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Save</Button>
        </div>
      </Stack>
    ),
  },
};
