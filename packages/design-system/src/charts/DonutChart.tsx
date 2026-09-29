import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { cn } from "../utilities/cn.ts";
import { ChartLegend } from "./ChartLegend.tsx";
import { ChartTooltipContent } from "./ChartTooltip.tsx";
import { formatShare, type ChartValueFormatter } from "./chart-format.ts";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  /** A chart colour (chartStateColor / chartSeriesColor). */
  color: string;
  /** The records behind this segment. */
  href?: string;
}

export interface DonutChartProps {
  className?: string;
  /** At most ~6 segments; a donut is for part-to-whole at a glance. */
  segments: DonutSegment[];
  /** Shown in the centre under the total, e.g. "active leads". */
  totalLabel: string;
  valueFormatter?: ChartValueFormatter;
  /** Names the list of segments for assistive technology. */
  ariaLabel: string;
  onNavigate?: (href: string) => void;
}

const SIZE = 168;

/** Part-to-whole with every segment written out beside it: the list gives
 * each segment's exact value and share, and links to its records, so the
 * ring itself is decoration for sighted mouse users only. */
export function DonutChart({ className, segments, totalLabel, valueFormatter = (value) => value.toLocaleString("en-IN"), ariaLabel, onNavigate }: DonutChartProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const plotted = segments.filter((segment) => segment.value > 0);
  return (
    <div className={cn("@container", className)}>
      <div className="flex flex-col items-center gap-4 @sm:flex-row @sm:items-center">
        <div aria-hidden="true" className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <PieChart width={SIZE} height={SIZE} accessibilityLayer={false}>
            <Pie
              data={plotted}
              dataKey="value"
              nameKey="label"
              innerRadius={SIZE * 0.32}
              outerRadius={SIZE / 2 - 2}
              startAngle={90}
              endAngle={-270}
              stroke="var(--color-surface)"
              strokeWidth={plotted.length > 1 ? 2 : 0}
              isAnimationActive={false}
              // The ring is hidden from assistive technology; the legend
              // links are the keyboard route, so the ring takes no focus.
              rootTabIndex={-1}
              cursor={onNavigate ? "pointer" : undefined}
              onClick={
                onNavigate
                  ? (item) => {
                      const href = (item.payload as DonutSegment | undefined)?.href;
                      if (href) onNavigate(href);
                    }
                  : undefined
              }
            >
              {plotted.map((segment) => (
                <Cell key={segment.key} fill={segment.color} />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={(props) => (
                <ChartTooltipContent
                  active={props.active}
                  payload={props.payload}
                  title={(datum) => (datum as DonutSegment | undefined)?.label}
                  valueFormatter={(value) => `${valueFormatter(value)} · ${formatShare(value, total)}`}
                />
              )}
            />
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold text-text">{valueFormatter(total)}</span>
            <span className="text-xs text-text-muted">{totalLabel}</span>
          </div>
        </div>
        <ChartLegend
          className="w-full min-w-0 flex-1"
          variant="list"
          aria-label={ariaLabel}
          onNavigate={onNavigate}
          items={segments.map((segment) => ({
            key: segment.key,
            label: segment.label,
            color: segment.color,
            value: valueFormatter(segment.value),
            detail: formatShare(segment.value, total),
            href: segment.href,
          }))}
        />
      </div>
    </div>
  );
}
