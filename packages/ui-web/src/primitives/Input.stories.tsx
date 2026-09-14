import type { Meta, StoryObj } from "@storybook/nextjs";
import { expect, userEvent, within } from "storybook/test";

import { Input } from "./Input";

// Input is a bare form control -- a real caller always pairs it with a
// visible <label> (the eventual FormField wrapper's job, see
// docs/ux/UI_REWRITE_TRACKER.md's form-system phase). A placeholder is
// NOT a substitute for a label (it disappears on input and isn't reliably
// exposed as the accessible name); the Storybook a11y test-runner
// correctly failed the first version of this story file for relying on
// one. Every story here supplies a real associated label so what's
// demonstrated is accessible usage, not just what the bare primitive
// technically allows a caller to omit.
const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
  args: { id: "supplier-legal-name", placeholder: "Enter supplier legal name" },
  decorators: [
    (Story) => (
      <div>
        <label htmlFor="supplier-legal-name" style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
          Supplier legal name
        </label>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true, value: "Cannot be edited in this state" },
};

export const Invalid: Story = {
  name: "Error / invalid state",
  args: { invalid: true, value: "not-an-email", "aria-describedby": "supplier-legal-name-error" },
  // No story-level `decorators` override here -- the meta-level label
  // decorator already wraps this render output, so redefining it would
  // double-wrap the input in two <label htmlFor> elements.
  render: (args) => (
    <>
      <Input {...args} />
      <p id="supplier-legal-name-error" role="alert" style={{ color: "var(--color-state-danger)", fontSize: 12, marginTop: 4 }}>
        Enter a valid registered legal name.
      </p>
    </>
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox");
    // aria-invalid + a real associated error message, not just red border
    // (SP032: accessible validation errors, no hidden critical errors).
    await expect(input).toHaveAttribute("aria-invalid", "true");
  },
};

export const LongText: Story = {
  args: { value: "A Very Long Registered Supplier Legal Name Private Limited Company" },
};

export const KeyboardTyping: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox");
    await userEvent.type(input, "Acme Manufacturing Pvt Ltd");
    await expect(input).toHaveValue("Acme Manufacturing Pvt Ltd");
  },
};
