import type { Meta, StoryObj } from "@storybook/nextjs";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "./Button";
import { DialogClose, DialogContent, DialogDescription, DialogFooter, DialogRoot, DialogTitle, DialogTrigger } from "./Dialog";

function ConfirmArchiveDialog() {
  return (
    <DialogRoot>
      <DialogTrigger render={<Button variant="danger">Archive supplier</Button>} />
      <DialogContent>
        <DialogTitle>Archive this supplier?</DialogTitle>
        <DialogDescription>
          Archived suppliers cannot receive new purchase orders until reactivated. Existing orders and history are
          preserved.
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <DialogClose render={<Button variant="danger">Archive</Button>} />
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}

const meta: Meta<typeof ConfirmArchiveDialog> = {
  title: "Primitives/Dialog",
  component: ConfirmArchiveDialog,
};
export default meta;

type Story = StoryObj<typeof ConfirmArchiveDialog>;

export const Closed: Story = {};

export const OpenWithFocusTrap: Story = {
  name: "Open, focus trapped, Escape closes and returns focus to trigger",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const triggerButton = canvas.getByRole("button", { name: "Archive supplier" });
    await userEvent.click(triggerButton);

    // Base UI's Dialog.Popup owns focus-trap/aria-modal wiring -- assert
    // the resulting DOM actually has it, not just that Base UI claims to.
    const dialog = within(document.body).getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(within(dialog).getByText("Archive this supplier?")).toBeVisible();

    // Escape closes and focus returns to the element that opened it (SP032:
    // focus restoration) -- never left on a removed/hidden element.
    // waitFor: unlike a Close-button click (see CancelReturnsFocus below,
    // which passes immediately), Escape-triggered dismissal in this Base UI
    // release restores focus asynchronously, not synchronously within the
    // keydown handler.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(triggerButton).toHaveFocus());
  },
};

export const CancelReturnsFocus: Story = {
  name: "Cancel button closes and returns focus to trigger",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const triggerButton = canvas.getByRole("button", { name: "Archive supplier" });
    await userEvent.click(triggerButton);
    const cancelButton = within(document.body).getByRole("button", { name: "Cancel" });
    await userEvent.click(cancelButton);
    await expect(triggerButton).toHaveFocus();
  },
};
