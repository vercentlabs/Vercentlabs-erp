import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox.tsx";

const meta: Meta<typeof Checkbox> = {
  title: "Data Entry/Checkbox",
  component: Checkbox,
  args: { children: "Send confirmation email" },
};
export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {};
export const Checked: Story = { args: { defaultSelected: true } };
export const Indeterminate: Story = { args: { isIndeterminate: true } };
export const Disabled: Story = { args: { isDisabled: true } };
export const DisabledChecked: Story = { args: { isDisabled: true, defaultSelected: true } };
export const Invalid: Story = { args: { isInvalid: true } };
