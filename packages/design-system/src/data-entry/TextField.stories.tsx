import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextField } from "./TextField.tsx";

const meta: Meta<typeof TextField> = {
  title: "Data Entry/TextField",
  component: TextField,
  args: { label: "Lead name", placeholder: "Jane Cooper" },
};
export default meta;
type Story = StoryObj<typeof TextField>;

export const Default: Story = {};
export const WithDescription: Story = { args: { description: "Full legal name as it appears on contracts" } };
export const Required: Story = { args: { isRequired: true } };
export const Invalid: Story = { args: { isInvalid: true, errorMessage: "Name is required", defaultValue: "" } };
export const Disabled: Story = { args: { isDisabled: true, defaultValue: "Jane Cooper" } };
export const ReadOnly: Story = { args: { isReadOnly: true, defaultValue: "Jane Cooper" } };
export const Compact: Story = { args: { size: "compact" } };
export const LongValue: Story = {
  args: { defaultValue: "A very long value that should truncate or wrap gracefully inside the field without breaking layout" },
};
