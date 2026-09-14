// Real render smoke tests for the Phase 3b primitives (Textarea, IconButton,
// Separator, Tabs, Popover, Tooltip, AlertDialog, Select) added for the CRM
// Leads golden reference. Same react-dom/server approach as
// primitives.test.mjs -- no browser, no bundler.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("Textarea marks aria-invalid when invalid", async () => {
  const { Textarea } = await import(pathToFileURL(compile("src/primitives/Textarea.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Textarea, { invalid: true, placeholder: "Notes" }));
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /<textarea/);
});

test("IconButton requires and renders an aria-label", async () => {
  const { IconButton } = await import(pathToFileURL(compile("src/primitives/IconButton.tsx")).href);
  const { MoreHorizontal } = await import("lucide-react");
  const html = renderToStaticMarkup(React.createElement(IconButton, { "aria-label": "Row actions" }, React.createElement(MoreHorizontal, { className: "size-4" })));
  assert.match(html, /aria-label="Row actions"/);
});

test("Separator renders with the correct orientation", async () => {
  const { Separator } = await import(pathToFileURL(compile("src/primitives/Separator.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Separator, { orientation: "vertical" }));
  assert.match(html, /aria-orientation="vertical"|orientation="vertical"/);
});

test("Tabs primitives mount with a selected tab and matching panel", async () => {
  const { TabsRoot, TabsList, TabsTab, TabsPanel } = await import(pathToFileURL(compile("src/primitives/Tabs.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      TabsRoot,
      { defaultValue: "overview" },
      React.createElement(TabsList, null, React.createElement(TabsTab, { value: "overview" }, "Overview"), React.createElement(TabsTab, { value: "activity" }, "Activity")),
      React.createElement(TabsPanel, { value: "overview" }, "Overview content"),
      React.createElement(TabsPanel, { value: "activity" }, "Activity content"),
    ),
  );
  assert.match(html, /Overview/);
  assert.match(html, /Overview content/);
});

test("Popover primitives mount without throwing (closed by default)", async () => {
  const { PopoverRoot, PopoverTrigger, PopoverContent } = await import(pathToFileURL(compile("src/primitives/Popover.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(PopoverRoot, null, React.createElement(PopoverTrigger, null, "Filters"), React.createElement(PopoverContent, null, "Filter form")),
  );
  assert.match(html, /Filters/);
});

test("Tooltip primitives mount without throwing (closed by default)", async () => {
  const { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } = await import(pathToFileURL(compile("src/primitives/Tooltip.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(TooltipRoot, null, React.createElement(TooltipTrigger, null, "Hover me"), React.createElement(TooltipContent, null, "Tip text")),
    ),
  );
  assert.match(html, /Hover me/);
});

test("AlertDialog primitives mount without throwing (closed by default)", async () => {
  const { AlertDialogRoot, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogFooter } = await import(
    pathToFileURL(compile("src/primitives/AlertDialog.tsx")).href
  );
  const html = renderToStaticMarkup(
    React.createElement(
      AlertDialogRoot,
      null,
      React.createElement(AlertDialogTrigger, null, "Archive lead"),
      React.createElement(
        AlertDialogContent,
        null,
        React.createElement(AlertDialogTitle, null, "Archive this lead?"),
        React.createElement(AlertDialogFooter, null, "Cancel / Confirm"),
      ),
    ),
  );
  assert.match(html, /Archive lead/);
});

test("Select primitives render the trigger with a placeholder value", async () => {
  const { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } = await import(pathToFileURL(compile("src/primitives/Select.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      SelectRoot,
      { defaultValue: "new" },
      React.createElement(SelectTrigger, null, React.createElement(SelectValue, null)),
      React.createElement(SelectContent, null, React.createElement(SelectItem, { value: "new" }, "New"), React.createElement(SelectItem, { value: "qualified" }, "Qualified")),
    ),
  );
  assert.match(html, /<button/);
});
