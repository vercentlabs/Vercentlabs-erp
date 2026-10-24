import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { IconButton } from "../actions/IconButton.tsx";
import { IconLinkButton } from "../actions/IconLinkButton.tsx";
import { LinkButton } from "../actions/LinkButton.tsx";
import { Checkbox } from "../data-entry/Checkbox.tsx";
import { ComboBox } from "../data-entry/ComboBox.tsx";
import { DateField } from "../data-entry/DateField.tsx";
import { DatePicker } from "../data-entry/DatePicker.tsx";
import { MultiSelect } from "../data-entry/MultiSelect.tsx";
import { NumberField } from "../data-entry/NumberField.tsx";
import { SearchField } from "../data-entry/SearchField.tsx";
import { Select } from "../data-entry/Select.tsx";
import { Switch } from "../data-entry/Switch.tsx";
import { TextField } from "../data-entry/TextField.tsx";
import { MenuTrigger } from "../overlays/Menu.tsx";
import { Popover, PopoverTrigger } from "../overlays/Popover.tsx";
import { cn } from "../utilities/cn.ts";

export interface ActionBarProps {
  className?: string;
  /** Left-aligned content — usually a SearchField and the list's filters.
   * The SearchField fills the row; filter fields (selects, dates, pickers,
   * checkboxes) are gathered into one Filters menu; buttons stay inline. */
  start?: ReactNode;
  /** Right-aligned content — usually action buttons (Import, Export,
   * Create). */
  end?: ReactNode;
  /** Placed first in the row, before the search (the saved-view dropdown). */
  leading?: ReactNode;
  /** Number shown on the Filters button. Counted from the filter fields when
   * omitted (a select away from its first, "any" option, a filled field, a
   * ticked checkbox). */
  activeFilterCount?: number;
  /** Adds "Clear all" to the Filters menu. */
  onClearFilters?: () => void;
  /** false keeps every filter inline, as passed. */
  collapseFilters?: boolean;
}

type AnyElement = ReactElement<Record<string, unknown>>;

// Stay in the row: actions and menus a user presses, not values they set. An
// app component can opt in with a static `toolbarInline = true` (a Table /
// Board switch, say).
const INLINE = new Set<unknown>([Button, LinkButton, IconButton, IconLinkButton, PopoverTrigger, MenuTrigger, "a", "button"]);
// Fields that take a visible label inside the menu.
const LABELLED = new Set<unknown>([Select, TextField, ComboBox, MultiSelect, DateField, DatePicker, NumberField]);
const TOGGLES = new Set<unknown>([Checkbox, Switch]);

function flatten(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement(child) && child.type === Fragment ? flatten((child as AnyElement).props.children as ReactNode) : [child],
  );
}

function isActive(element: AnyElement) {
  const props = element.props;
  if (element.type === Select) {
    const options = props.options as Array<{ value: unknown }> | undefined;
    return props.selectedKey != null && props.selectedKey !== "" && options?.[0] !== undefined && props.selectedKey !== options[0].value;
  }
  if (TOGGLES.has(element.type)) return props.isSelected === true;
  if (element.type === MultiSelect) return Array.isArray(props.selectedKeys) ? props.selectedKeys.length > 0 : false;
  if (LABELLED.has(element.type)) return props.value != null && props.value !== "";
  return false;
}

function inMenu(element: AnyElement, index: number) {
  const key = element.key ?? index;
  if (LABELLED.has(element.type))
    return cloneElement(element, {
      key,
      label: element.props.label ?? element.props["aria-label"],
      className: cn(element.props.className as string | undefined, "w-full sm:w-full"),
    });
  if (TOGGLES.has(element.type)) return <div key={key} className="sm:col-span-2 lg:col-span-3">{element}</div>;
  return <div key={key} className="min-w-0 [&>*]:w-full">{element}</div>;
}

export interface FilterMenuProps {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
}

/** One "Filters" button holding a list's filter fields in a panel: one
 * column on a phone, two on a tablet, three on a desktop. */
export function FilterMenu({ children, activeCount = 0, onClear }: FilterMenuProps) {
  return (
    <PopoverTrigger>
      <Button variant={activeCount ? "secondary" : "outline"} size="compact">
        <Filter className="size-4" aria-hidden="true" />
        <span>Filters</span>
        {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 text-xs tabular-nums text-white">{activeCount}</span>}
      </Button>
      <Popover placement="bottom start">
        <div className="grid w-[min(48rem,calc(100vw-4rem))] grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children}
          {onClear && (
            <div className="flex justify-end sm:col-span-2 lg:col-span-3">
              <Button variant="ghost" size="compact" onPress={onClear}>Clear all</Button>
            </div>
          )}
        </div>
      </Popover>
    </PopoverTrigger>
  );
}

/** The toolbar row above an EnterpriseDataGrid or list: one line on a
 * desktop — [view] [search …] [Filters] [buttons] … [actions] — and two on a
 * phone, where the search drops to its own full-width line and the rest
 * share the first. For a row selected in the grid, BulkActionBar replaces
 * this instead of stacking beside it. */
export function ActionBar({ className, start, end, leading, activeFilterCount, onClearFilters, collapseFilters = true }: ActionBarProps) {
  const children = flatten(start);
  let search: AnyElement | null = null;
  const filters: AnyElement[] = [];
  const inline: ReactNode[] = [];
  for (const child of children) {
    if (!isValidElement(child)) inline.push(child);
    else if (child.type === SearchField && !search) search = child as AnyElement;
    else if (collapseFilters && typeof child.type !== "string" && !INLINE.has(child.type) && !(child.type as { toolbarInline?: boolean }).toolbarInline) filters.push(child as AnyElement);
    else inline.push(child);
  }
  const count = activeFilterCount ?? filters.filter(isActive).length;
  return (
    // On a phone the start group dissolves into the row (display: contents),
    // so its controls and the end actions share lines instead of stacking.
    <div className={cn("flex flex-wrap items-center justify-between gap-2 sm:gap-3", className)}>
      <div className="flex flex-1 flex-wrap items-center gap-2 max-sm:contents">
        {/* On a phone: the search has the first line to itself; the view dropdown leads the second, filling what Filters and the buttons leave. */}
        {leading && <div className="flex min-w-0 max-sm:flex-1 sm:contents">{leading}</div>}
        {search && (
          <div className="min-w-0 flex-1 max-sm:order-first max-sm:basis-full sm:min-w-64">
            {cloneElement(search, { className: "w-full" })}
          </div>
        )}
        {filters.length > 0 && (
          <FilterMenu activeCount={count} onClear={onClearFilters}>
            {filters.map(inMenu)}
          </FilterMenu>
        )}
        {inline}
      </div>
      {end && <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:contents">{end}</div>}
    </div>
  );
}
