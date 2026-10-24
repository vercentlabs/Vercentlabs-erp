"use client";

// Sales › Setup › Quotation templates (Sales report Phase 2): ready-made starts for quotations — products, headings and notes, how long
// the quotation stays valid, payment terms, terms and the note to the customer. New quotation › Start from template fills the form from
// one. Desktop: the list with how templates work beside it; tablet and phone: one column, the list first.
import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { AlertDialog, Button, Dialog, ErrorState, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { SalesSearchPicker } from "@/features/sales/shared/SalesSearchPicker";
import { AddSectionButtons, SectionLineRow, sectionsAt, useSectionLines } from "@/features/sales/shared/SectionLines";

import { getSalesOptions, type SalesOptions } from "../api/quotations-api";
import {
  createQuotationTemplate, deleteQuotationTemplate, listQuotationTemplates, setQuotationTemplateActive, updateQuotationTemplate, type QuotationTemplate, type TemplateLine,
} from "../api/templates-api";

const failure = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export function QuotationTemplatesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");
  const key = scopedQueryKey(workspace, "sales", "quotation-templates", "all");
  const query = useQuery({ queryKey: key, queryFn: () => listQuotationTemplates(true), enabled: canManage });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((result) => result.options), staleTime: 60_000, enabled: canManage });
  const [editing, setEditing] = useState<QuotationTemplate | "new" | null>(null);
  const [deleting, setDeleting] = useState<QuotationTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "quotation-templates") }); };
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (problem) => { setDeleting(null); setError(failure(problem, "That did not work. Try again.")); },
  });

  if (!canManage) return <PermissionState title="You cannot set up quotation templates" description="Ask someone who manages Sales settings." />;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You cannot set up quotation templates" description="Ask someone who manages Sales settings." />;
  const templates = query.data ?? [];
  const active = templates.filter((template) => template.active);
  const inactive = templates.filter((template) => !template.active);

  const row = (template: QuotationTemplate) => (
    <li key={template.id} className={`flex items-start gap-3 px-4 py-3.5 ${template.active ? "" : "bg-surface-muted"}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${template.active ? "text-text" : "text-text-muted"}`}>{template.name}</span>
          {!template.active && <StatusBadge tone="neutral">Off</StatusBadge>}
        </div>
        {template.description && <p className="text-text-secondary">{template.description}</p>}
        <span className="text-xs text-text-muted">
          {[`${template.lineCount} ${template.lineCount === 1 ? "product" : "products"}`, template.sectionLines.length ? `${template.sectionLines.length} headings and notes` : null,
            template.validityDays ? `valid ${template.validityDays} days` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="shrink-0 sm:hidden">
        <MoreMenu label={`Actions for ${template.name}`} items={[
          { id: "edit", label: "Edit", onAction: () => setEditing(template) },
          { id: "active", label: template.active ? "Switch off" : "Switch on", isDisabled: change.isPending, onAction: () => change.mutate(() => setQuotationTemplateActive(template.id, !template.active)) },
          { id: "delete", label: "Delete", danger: true, onAction: () => setDeleting(template) },
        ]} />
      </div>
      <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_6.5rem_auto]">
        <Button variant="ghost" size="compact" aria-label={`Edit ${template.name}`} onPress={() => setEditing(template)}>Edit</Button>
        <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => setQuotationTemplateActive(template.id, !template.active))}>
          {template.active ? "Switch off" : "Switch on"}
        </Button>
        <Button variant="ghost" size="compact" className="text-danger" aria-label={`Delete ${template.name}`} onPress={() => setDeleting(template)}>Delete</Button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Quotation templates" description="Ready-made starts for quotations you send often."
        primaryAction={<Button variant="primary" className="flex-1 sm:flex-none" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New template</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {query.isLoading ? <LoadingState label="Loading templates" rows={4} />
            : query.isError ? <ErrorState title="Templates could not be loaded" action={{ label: "Try again", onPress: () => void query.refetch() }} />
            : (
              <>
                <section aria-labelledby="templates-active" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                  <h2 id="templates-active" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`${active.length} active ${active.length === 1 ? "template" : "templates"}`}</h2>
                  {active.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">No templates yet. Add one with New template.</p>
                    : <ul className="flex flex-col divide-y divide-border">{active.map(row)}</ul>}
                </section>
                {inactive.length > 0 && (
                  <section aria-labelledby="templates-off" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                    <h2 id="templates-off" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`Switched off (${inactive.length})`}</h2>
                    <ul className="flex flex-col divide-y divide-border">{inactive.map(row)}</ul>
                  </section>
                )}
              </>
            )}
        </div>
        <section aria-labelledby="templates-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="templates-how" className="text-sm font-semibold text-text">How templates work</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>On a new quotation, choose Start from template: its products, headings, terms and validity fill the form.</li>
            <li>Prices come from today&apos;s price list, so a template never holds an old price.</li>
            <li>Change anything on the quotation before saving; the template stays as it is.</li>
            <li>Switch off a template you no longer offer. Deleting one never changes quotations made from it.</li>
          </ul>
        </section>
      </div>
      {editing && options.data && (
        <TemplateDialog template={editing === "new" ? null : editing} options={options.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
      <AlertDialog isOpen={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title={`Delete "${deleting?.name ?? ""}"?`}
        description="Removed for good; quotations made from it do not change. To keep it, switch it off instead."
        confirmLabel="Delete template" isConfirming={change.isPending} onConfirm={() => deleting && change.mutate(() => deleteQuotationTemplate(deleting.id))} />
    </div>
  );
}

type LineDraft = { key: number; itemId: string; quantity: number; discountValue: number };
let lineKey = 1;

function TemplateDialog({ template, options, onClose, onSaved }: { template: QuotationTemplate | null; options: SalesOptions; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [validity, setValidity] = useState<number>(template?.validityDays ?? Number.NaN);
  const [paymentTermId, setPaymentTermId] = useState(template?.paymentTermId ?? "");
  const [terms, setTerms] = useState(template?.termsAndConditions ?? "");
  const [notes, setNotes] = useState(template?.customerNotes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => (template?.lines.length ? template.lines : [{ itemId: "", quantity: 1 } as TemplateLine])
    .map((line) => ({ key: lineKey++, itemId: line.itemId, quantity: line.quantity, discountValue: line.discountType === "percent" ? Number(line.discountValue ?? 0) : 0 })));
  const sections = useSectionLines(template?.sectionLines);
  const filled = lines.map((line) => Boolean(line.itemId) && line.quantity > 0);
  const input = {
    name: name.trim(), description: description.trim() || null, validityDays: Number.isFinite(validity) ? validity : null, paymentTermId: paymentTermId || null,
    termsAndConditions: terms.trim() || null, customerNotes: notes.trim() || null,
    lines: lines.filter((_, index) => filled[index]).map((line) => ({ itemId: line.itemId, quantity: line.quantity, ...(line.discountValue > 0 ? { discountType: "percent" as const, discountValue: line.discountValue } : {}) })),
    sectionLines: sections.toSaved(filled),
  };
  const save = useMutation({ mutationFn: () => (template ? updateQuotationTemplate(template.id, input) : createQuotationTemplate(input)), onSuccess: onSaved });
  const ready = Boolean(input.name) && input.lines.length > 0;
  const update = (key: number, patch: Partial<LineDraft>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const sectionRow = (block: Parameters<typeof SectionLineRow>[0]["block"]) => (
    <SectionLineRow key={`s${block.key}`} block={block} lineCount={lines.length} onChange={(text) => sections.update(block.key, text)}
      onMove={(by) => sections.move(block.key, by, lines.length)} onRemove={() => sections.remove(block.key)} />
  );

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} size="lg" title={template ? `Edit "${template.name}"` : "New quotation template"}
      description="Products and terms a new quotation starts with. Prices come from the price list when it is made.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{failure(save.error, "The template could not be saved.")}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Name" isRequired autoFocus value={name} onChange={setName} placeholder="For example: Standard distributor offer" />
          <TextField label="Description" value={description} onChange={setDescription} placeholder="Shown when choosing a template" />
          <NumberField label="Valid for (days)" value={validity} onChange={setValidity} minValue={1} maxValue={365} step={1} description="Empty: the usual quotation validity." />
          <Select label="Payment terms" selectedKey={paymentTermId || "customer"} onSelectionChange={(key) => setPaymentTermId(key === "customer" ? "" : String(key))}
            options={[{ value: "customer", label: "The customer's own terms" }, ...(options.paymentTerms ?? []).map((term) => ({ value: term.id, label: term.name }))]} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">Products</legend>
          {lines.map((line, index) => (
            <Fragment key={line.key}>
              {sectionsAt(sections.sections, index).map(sectionRow)}
              <div className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
                <SalesSearchPicker kind="products" aria-label={`Product ${index + 1}`} label={index === 0 ? "Product" : undefined} known={options} value={line.itemId || null}
                  onPick={(id) => update(line.key, { itemId: id })} placeholder="Search products" />
                <NumberField aria-label={`Quantity ${index + 1}`} label={index === 0 ? "Quantity" : undefined} value={line.quantity} minValue={0} step={1}
                  onChange={(value) => update(line.key, { quantity: Number.isFinite(value) ? value : 0 })} />
                <NumberField aria-label={`Discount % ${index + 1}`} label={index === 0 ? "Discount %" : undefined} value={line.discountValue} minValue={0} maxValue={100} step={0.5}
                  onChange={(value) => update(line.key, { discountValue: Number.isFinite(value) ? value : 0 })} />
                <Button variant="ghost" size="compact" isDisabled={lines.length === 1} aria-label={`Remove product ${index + 1}`}
                  onPress={() => { sections.lineRemoved(index); setLines((current) => current.filter((entry) => entry.key !== line.key)); }}>
                  <Trash2 className="size-4" aria-hidden="true" />Remove
                </Button>
              </div>
            </Fragment>
          ))}
          {sectionsAt(sections.sections, lines.length).map(sectionRow)}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, { key: lineKey++, itemId: "", quantity: 1, discountValue: 0 }])}>
              <Plus className="size-3.5" aria-hidden="true" />Add product
            </Button>
            <AddSectionButtons onAdd={(kind) => sections.add(kind, lines.length)} />
          </div>
        </fieldset>
        <TextArea label="Terms and conditions" value={terms} onChange={setTerms} description="Empty: the usual quotation terms." />
        <TextArea label="Note to the customer" value={notes} onChange={setNotes} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>{template ? "Save template" : "Add template"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
