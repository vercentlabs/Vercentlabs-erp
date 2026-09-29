import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarChart } from "./BarChart.tsx";
import { ChartCard } from "./ChartCard.tsx";
import { ChartDataTable } from "./ChartDataTable.tsx";
import { DonutChart } from "./DonutChart.tsx";
import { chartSeriesColor, chartStateColor } from "./chart-format.ts";

const meta: Meta = { title: "Charts/Overview" };
export default meta;
type Story = StoryObj;

// Illustrative figures for the component catalogue only — screens always
// plot server aggregates.
const stages = [
  { name: "Qualification", pipeline: 420000, weighted: 84000, deals: 6 },
  { name: "Needs analysis", pipeline: 310000, weighted: 124000, deals: 4 },
  { name: "Proposal", pipeline: 520000, weighted: 312000, deals: 3 },
  { name: "Negotiation", pipeline: 180000, weighted: 144000, deals: 2 },
];
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export const GroupedColumns: Story = {
  render: () => (
    <ChartCard title="Pipeline by stage" description="Open opportunities, by stage">
      <BarChart
        data={stages}
        categoryKey="name"
        orientation="responsive"
        ariaLabel="Pipeline and weighted value by stage"
        valueFormatter={money}
        series={[
          { key: "pipeline", label: "Pipeline value", color: chartSeriesColor[1] },
          { key: "weighted", label: "Weighted value", color: chartSeriesColor[2] },
        ]}
        tooltipFooter={(row) => `${row.deals} opportunities`}
      />
      <ChartDataTable
        caption="Pipeline by stage"
        rows={stages}
        rowKey={(row) => row.name}
        rowHeader={{ header: "Stage", cell: (row) => row.name }}
        columns={[
          { key: "pipeline", header: "Pipeline value", cell: (row) => money(row.pipeline) },
          { key: "weighted", header: "Weighted value", cell: (row) => money(row.weighted) },
          { key: "deals", header: "Opportunities", cell: (row) => row.deals },
        ]}
      />
    </ChartCard>
  ),
};

export const Donut: Story = {
  render: () => (
    <ChartCard title="Lead qualification" description="Active leads">
      <DonutChart
        ariaLabel="Active leads by qualification"
        totalLabel="active leads"
        segments={[
          { key: "qualified", label: "Qualified", value: 12, color: chartStateColor.positive },
          { key: "not_reviewed", label: "Not reviewed", value: 30, color: chartStateColor.pending },
          { key: "unqualified", label: "Unqualified", value: 5, color: chartStateColor.neutral },
        ]}
      />
    </ChartCard>
  ),
};

export const Empty: Story = {
  render: () => (
    <ChartCard title="Lead momentum" isEmpty emptyText="No leads were created in the last six months.">
      <span />
    </ChartCard>
  ),
};
