import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select.tsx";

const stageOptions = [
  { value: "new", label: "New" },
  { value: "qualified", label: "Qualified" },
  { value: "won", label: "Won" },
];

const meta: Meta<typeof Select> = {
  title: "Data Entry/Select",
  component: Select,
  args: { label: "Stage", placeholder: "Choose a stage", options: stageOptions },
};
export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {};
export const WithSelection: Story = { args: { defaultSelectedKey: "qualified" } };
export const Disabled: Story = { args: { isDisabled: true } };
export const Invalid: Story = { args: { isInvalid: true, errorMessage: "Stage is required" } };
export const ManyOptions: Story = {
  args: {
    options: Array.from({ length: 20 }).map((_, i) => ({ value: String(i), label: `Option ${i + 1}` })),
  },
};
