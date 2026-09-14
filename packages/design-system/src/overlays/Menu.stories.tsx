import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pencil, Trash2, Copy } from "lucide-react";
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from "./Menu.tsx";
import { Button } from "../actions/Button.tsx";

const meta: Meta = {
  title: "Overlays/Menu",
  render: () => (
    <MenuTrigger>
      <Button variant="outline">Actions</Button>
      <Menu onAction={() => {}}>
        <MenuItem id="edit">
          <Pencil className="size-4" aria-hidden="true" />
          Edit
        </MenuItem>
        <MenuItem id="copy">
          <Copy className="size-4" aria-hidden="true" />
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="delete" isDanger>
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </MenuItem>
      </Menu>
    </MenuTrigger>
  ),
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
