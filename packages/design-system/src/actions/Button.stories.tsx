import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.tsx";

const meta: Meta<typeof Button> = {
  title: "Actions/Button",
  component: Button,
  args: { children: "Save changes" },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Outline: Story = { args: { variant: "outline" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete lead" } };
export const Loading: Story = { args: { isLoading: true } };
export const Disabled: Story = { args: { isDisabled: true } };
export const Compact: Story = { args: { size: "compact" } };
export const Large: Story = { args: { size: "large" } };
export const LongLabel: Story = {
  args: { children: "Save and continue to the next step of onboarding" },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button isLoading>Loading</Button>
      <Button isDisabled>Disabled</Button>
    </div>
  ),
};
