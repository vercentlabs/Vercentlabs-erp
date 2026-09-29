import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartLegend } from "./ChartLegend.tsx";
import { ChartTooltipContent } from "./ChartTooltip.tsx";
import { formatCompactNumber, niceTicks, toChartNumber, truncateLabel, type ChartValueFormatter } from "./chart-format.ts";

export interface BarChartSeries {
  /** The row property holding this series' value. */
  key: string;
  label: string;
  /** A chart colour (chartSeriesColor). */
  color: string;
}

export interface BarChartProps<T extends object> {
  className?: string;
  data: T[];
  /** The row property naming the category (stage, month, source). */
  categoryKey: keyof T & string;
  series: BarChartSeries[];
  /** "vertical" = columns rising from the x-axis; "horizontal" = bars from
   * the y-axis, best for long category names; "responsive" = columns, turning
   * into bars when the chart is narrower than 480px (phones). */
  orientation?: "vertical" | "horizontal" | "responsive";
  /** Full precision, for the tooltip (e.g. currency). */
  valueFormatter?: ChartValueFormatter;
  /** Short form, for the value axis. Defaults to compact numbers. */
  axisFormatter?: ChartValueFormatter;
  /** Plot height for column charts; bar charts size to their row count. */
  height?: number;
  /** Names the chart graphic for assistive technology. */
  ariaLabel: string;
  /** An extra tooltip line for the hovered category. */
  tooltipFooter?: (datum: T) => ReactNode;
  /** Clicking a category's bars (e.g. open the records behind it). Give the
   * same destination a keyboard route too — ChartDataTable's links. */
  onSelect?: (datum: T) => void;
  /** Only whole numbers on the value axis (counts). */
  integerValues?: boolean;
}

const AXIS_TEXT = { fill: "var(--color-text-muted)", fontSize: 12 };

function useElementWidth<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Grouped bars on one value axis. Every series must share a unit — counts
 * with counts, money with money; never two scales on one chart. */
export function BarChart<T extends object>({
  className,
  data,
  categoryKey,
  series,
  orientation = "vertical",
  valueFormatter,
  axisFormatter = (value) => formatCompactNumber(value),
  height = 280,
  ariaLabel,
  tooltipFooter,
  onSelect,
  integerValues,
}: BarChartProps<T>) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const horizontal = orientation === "horizontal" || (orientation === "responsive" && width > 0 && width < 480);
  // Horizontal bars: one row per category, tall enough for its bars and the
  // 2px gap between them, plus the value axis.
  const barThickness = horizontal ? 12 : 24;
  const plotHeight = horizontal ? Math.max(160, data.length * (series.length * (barThickness + 2) + 18) + 36) : height;
  const categoryWidth = horizontal ? Math.min(140, Math.max(88, Math.round(width * 0.3))) : 0;
  const categoryCharacters = horizontal ? Math.floor(categoryWidth / 7) : 14;

  const renderCategoryTick = (props: { x?: number | string; y?: number | string; payload?: { value?: unknown }; width?: number | string; visibleTicksCount?: number }) => {
    const label = String(props.payload?.value ?? "");
    if (horizontal)
      return (
        <Text x={Number(props.x)} y={Number(props.y)} textAnchor="end" verticalAnchor="middle" {...AXIS_TEXT}>
          {truncateLabel(label, categoryCharacters)}
        </Text>
      );
    // Columns: wrap to two lines within the category's band, never overlap.
    const band = Number(props.width ?? 0) / Math.max(1, props.visibleTicksCount ?? data.length);
    return (
      <Text
        x={Number(props.x)}
        y={Number(props.y)}
        width={Math.max(40, band - 6)}
        maxLines={2}
        textAnchor="middle"
        verticalAnchor="start"
        {...AXIS_TEXT}
      >
        {label}
      </Text>
    );
  };

  const maxValue = Math.max(0, ...data.flatMap((row) => series.map((item) => toChartNumber((row as Record<string, number | string>)[item.key]))));
  const ticks = niceTicks(maxValue, horizontal ? 3 : 4, integerValues);
  const valueAxis = {
    type: "number" as const,
    domain: [0, ticks[ticks.length - 1]] as [number, number],
    ticks,
    tickFormatter: (value: number) => axisFormatter(value),
    tick: AXIS_TEXT,
    axisLine: false,
    tickLine: false,
    allowDecimals: !integerValues,
  };
  const categoryAxis = {
    type: "category" as const,
    dataKey: categoryKey as string,
    tick: renderCategoryTick,
    axisLine: { stroke: "var(--color-border-strong)" },
    tickLine: false,
    interval: 0 as const,
  };

  return (
    <div className={className}>
      {series.length > 1 && (
        <ChartLegend className="mb-2" items={series.map((item) => ({ key: item.key, label: item.label, color: item.color }))} />
      )}
      <div ref={containerRef} className="w-full min-w-0" style={{ height: plotHeight + (horizontal ? 0 : 44) }}>
        {width > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart
              data={data}
              layout={horizontal ? "vertical" : "horizontal"}
              margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              barGap={2}
              barCategoryGap={horizontal ? 8 : "24%"}
              title={ariaLabel}
              accessibilityLayer
            >
              <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--color-border)" />
              {horizontal ? (
                <>
                  <XAxis {...valueAxis} />
                  <YAxis {...categoryAxis} width={categoryWidth} />
                </>
              ) : (
                <>
                  <XAxis {...categoryAxis} height={44} />
                  <YAxis {...valueAxis} width={56} />
                </>
              )}
              <Tooltip
                cursor={{ fill: "var(--color-surface-muted)" }}
                isAnimationActive={false}
                content={(props) => (
                  <ChartTooltipContent
                    active={props.active}
                    payload={props.payload}
                    label={props.label}
                    valueFormatter={valueFormatter}
                    footer={tooltipFooter ? (datum) => tooltipFooter(datum as T) : undefined}
                  />
                )}
              />
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  fill={item.color}
                  maxBarSize={barThickness}
                  radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                  isAnimationActive={false}
                  cursor={onSelect ? "pointer" : undefined}
                  onClick={onSelect ? (item) => onSelect(item.payload as T) : undefined}
                />
              ))}
            </RechartsBarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
