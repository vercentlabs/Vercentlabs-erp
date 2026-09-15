import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabList, Tab, TabPanel } from "./Tabs.tsx";

const meta: Meta<typeof Tabs> = {
  title: "Navigation/Tabs",
  component: Tabs,
  render: (args) => (
    <Tabs {...args}>
      <TabList aria-label="Record sections">
        <Tab id="overview">Overview</Tab>
        <Tab id="activity">Activity</Tab>
        <Tab id="notes">Notes</Tab>
        <Tab id="disabled" isDisabled>
          Locked section
        </Tab>
      </TabList>
      <TabPanel id="overview">Overview panel content</TabPanel>
      <TabPanel id="activity">Activity panel content</TabPanel>
      <TabPanel id="notes">Notes panel content</TabPanel>
      <TabPanel id="disabled">Not reachable</TabPanel>
    </Tabs>
  ),
};
export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {};
export const ActivitySelected: Story = { args: { defaultSelectedKey: "activity" } };
