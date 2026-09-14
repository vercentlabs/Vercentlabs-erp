import type { Meta, StoryObj } from "@storybook/nextjs";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Save changes" },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button {...args} variant="primary">Primary</Button>
      <Button {...args} variant="secondary">Secondary</Button>
      <Button {...args} variant="danger">Danger</Button>
      <Button {...args} variant="ghost">Ghost</Button>
      <Button {...args} variant="link">Link</Button>
    </div>
  ),
};

export const Sizes: Story = {
  name: "Density (compact / standard / comfortable)",
  render: (args) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Button {...args} size="compact">Compact</Button>
      <Button {...args} size="standard">Standard</Button>
      <Button {...args} size="large">Comfortable</Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button");
    // Loading must not just look busy -- it must be genuinely
    // non-activatable and announced to assistive tech (SP032).
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
  },
};

export const LongText: Story = {
  args: { children: "Submit this purchase requisition for multi-level approval and routing" },
  render: (args) => (
    <div style={{ maxWidth: 220 }}>
      <Button {...args} />
    </div>
  ),
};

export const KeyboardFocus: Story = {
  name: "Keyboard focus (visible ring, no pointer required)",
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button");
    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};

export const KeyboardActivation: Story = {
  name: "Keyboard activation (Enter/Space, no click required)",
  args: { children: "Approve" },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button");
    button.focus();
    let activated = false;
    button.addEventListener("click", () => {
      activated = true;
    });
    await userEvent.keyboard("{Enter}");
    await expect(activated).toBe(true);
  },
};
