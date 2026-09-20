"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, ErrorState, IconButton, NumberField, PageHeader, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import {
  createSalesQuotation,
  getSalesOptions,
  getSalesQuotation,
  previewSalesDocument,
  reviseSalesQuotation,
  type SalesDocumentInput,
  type SalesQuotationDetail,
} from "@/features/sales/quotations/api/quotations-api";

type LineDraft = { key: number; itemId: string; quantity: number; discountPercent: number };
type ChargeDraft = { key: number; label: string; calculationType: "fixed" | "percentage"; value: number };

let draftKey = 0;
const nextKey = () => ++draftKey;
const isoInDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// F036/F037/F039/F040 -- create a quotation, or revise an existing one into a
// new immutable version. The totals on the right come from the server's own
// previewSalesDocument (the same pricing/tax/discount code that will run on
// save), debounced -- the browser never computes a price, so what you see is
// what is stored.
export function SalesQuotationFormScreen({ quotationId }: { quotationId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const revising = Boolean(quotationId);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options) });
  const existingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotation", quotationId),
    queryFn: () => getSalesQuotation(quotationId!).then((r) => r.quotation),
    enabled: revising,
  });

  if (optionsQuery.isLoading || (revising && existingQuery.isLoading)) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (optionsQuery.isError || !optionsQuery.data) return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => optionsQuery.refetch() }} />;
  if (revising && (existingQuery.isError || !existingQuery.data)) return <ErrorState title="Could not load this quotation" action={{ label: "Retry", onPress: () => existingQuery.refetch() }} />;

  return (
    <FormBody
      key={quotationId ?? "new"}
      options={optionsQuery.data}
      existing={existingQuery.data ?? null}
      quotationId={quotationId}
      onDone={(id) => {
        queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "quotations") });
        queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "quotation", id) });
        router.push(`/sales/quotations/${id}`);
      }}
      onCancel={() => router.push(quotationId ? `/sales/quotations/${quotationId}` : "/sales/quotations")}
    />
  );
}

function FormBody({
  options,
  existing,
  quotationId,
  onDone,
  onCancel,
}: {
  options: NonNullable<ReturnType<typeof getSalesOptions> extends Promise<infer R> ? (R extends { options: infer O } ? O : never) : never>;
  existing: SalesQuotationDetail | null;
  quotationId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const workspace = useWorkspaceContext();
  const revising = Boolean(quotationId);
  const baseCurrency = options.currencies.find((currency) => currency.is_base)?.code ?? options.currencies[0]?.code ?? "INR";

  const [partyId, setPartyId] = useState(existing?.quotation.party_id ?? "");
  const [currencyCode, setCurrencyCode] = useState(existing?.quotation.currency_code ?? baseCurrency);
  const [priceListId, setPriceListId] = useState(existing?.quotation.price_list_id ?? "");
  const [paymentTermId, setPaymentTermId] = useState(existing?.quotation.payment_term_id ?? "");
  const [validUntil, setValidUntil] = useState(existing?.quotation.valid_until?.slice(0, 10) ?? isoInDays(30));
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [customerNotes, setCustomerNotes] = useState(existing?.quotation.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(existing?.quotation.internal_notes ?? "");
  const [terms, setTerms] = useState(existing?.quotation.terms_and_conditions ?? "");
  const [revisionReason, setRevisionReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    existing?.lines.length
      ? existing.lines.map((line) => ({ key: nextKey(), itemId: line.item_id, quantity: Number(line.quantity), discountPercent: Number(line.discount_percent) }))
      : [{ key: nextKey(), itemId: "", quantity: 1, discountPercent: 0 }],
  );
  const [charges, setCharges] = useState<ChargeDraft[]>(() =>
    (existing?.charges ?? []).map((charge) => ({ key: nextKey(), label: charge.label, calculationType: charge.calculation_type as "fixed" | "percentage", value: Number(charge.value) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const partyOptions: SelectOption[] = options.parties.map((party) => ({ value: party.id, label: `${party.display_name} (${party.code})` }));
  const itemOptions: SelectOption[] = options.items.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }));
  const currencyOptions: SelectOption[] = options.currencies.map((currency) => ({ value: currency.code, label: `${currency.code} — ${currency.name}` }));
  const priceListOptions: SelectOption[] = [{ value: "", label: "No price list (item list price)" }, ...options.priceLists.filter((list) => list.currency_code === currencyCode).map((list) => ({ value: list.id, label: list.name }))];
  const paymentTermOptions: SelectOption[] = [{ value: "", label: "Customer default" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: `${term.name} (${term.default_due_days} days)` }))];

  function selectParty(id: string) {
    setPartyId(id);
    const party = options.parties.find((candidate) => candidate.id === id);
    // A customer's own currency and terms are the natural starting point; the
    // user can still change either, and the server validates the combination.
    if (party?.currency_code) setCurrencyCode(party.currency_code);
    if (party?.payment_term_id) setPaymentTermId(party.payment_term_id);
    setPriceListId("");
  }

  const validLines = lines.filter((line) => line.itemId && line.quantity > 0);
  const input: SalesDocumentInput | null = useMemo(() => {
    if (!partyId || !currencyCode || validLines.length === 0) return null;
    return {
      partyId,
      currencyCode,
      priceListId: priceListId || null,
      paymentTermId: paymentTermId || null,
      validUntil: validUntil || null,
      headerDiscountPercent: headerDiscount || undefined,
      customerNotes: customerNotes || undefined,
      internalNotes: internalNotes || undefined,
      termsAndConditions: terms || undefined,
      revisionReason: revisionReason || undefined,
      lines: validLines.map((line) => ({ itemId: line.itemId, quantity: line.quantity, discountPercent: line.discountPercent || undefined })),
      charges: charges.filter((charge) => charge.value > 0).map((charge) => ({ label: charge.label || "Charge", calculationType: charge.calculationType, value: charge.value })),
    };
  }, [partyId, currencyCode, priceListId, paymentTermId, validUntil, headerDiscount, customerNotes, internalNotes, terms, revisionReason, validLines, charges]);

  // Debounce so typing a quantity doesn't fire a pricing request per keystroke.
  const inputJson = JSON.stringify(input);
  const [debouncedJson, setDebouncedJson] = useState(inputJson);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedJson(inputJson), 400);
    return () => clearTimeout(handle);
  }, [inputJson]);
  const previewInput: SalesDocumentInput | null = debouncedJson === "null" ? null : (JSON.parse(debouncedJson) as SalesDocumentInput);

  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "preview", debouncedJson),
    queryFn: () => previewSalesDocument(previewInput!).then((r) => r.preview),
    enabled: Boolean(previewInput),
    retry: false,
    placeholderData: (previous) => previous,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!input) throw new SalesApiError("Choose a customer and add at least one item.", 400);
      if (quotationId) {
        await reviseSalesQuotation(quotationId, input);
        return quotationId;
      }
      const result = await createSalesQuotation({ ...input, idempotencyKey });
      return result.quotation.id;
    },
    onSuccess: (id) => onDone(id),
    onError: (err) => setError(err instanceof SalesApiError ? err.message : "The quotation could not be saved."),
  });

  const preview = previewQuery.data;
  const previewError = previewQuery.isError ? (previewQuery.error instanceof SalesApiError ? previewQuery.error.message : "Pricing could not be calculated.") : null;

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={revising ? `Revise ${existing?.quotation.quotation_number}` : "New quotation"}
        description={revising ? "Saving creates a new version. Earlier versions stay exactly as they were sent." : "Build a priced offer. Totals update as you edit and are calculated by the server."}
        secondaryActions={
          <Button variant="secondary" onPress={onCancel}>
            Cancel
          </Button>
        }
        primaryAction={
          <Button variant="primary" onPress={() => saveMutation.mutate()} isLoading={saveMutation.isPending} isDisabled={!input || Boolean(previewError) || (revising && !revisionReason.trim())}>
            {revising ? "Save new version" : "Save quotation"}
          </Button>
        }
      />

      {error && <SalesAlert>{error}</SalesAlert>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SalesPanel title="Customer & terms">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Customer" isRequired options={partyOptions} selectedKey={partyId || null} onSelectionChange={(key) => selectParty(String(key ?? ""))} placeholder="Select a customer" isDisabled={revising} />
              <TextField label="Valid until" type="date" isRequired value={validUntil} onChange={setValidUntil} />
              <Select label="Currency" options={currencyOptions} selectedKey={currencyCode} onSelectionChange={(key) => { setCurrencyCode(String(key ?? baseCurrency)); setPriceListId(""); }} />
              <Select label="Price list" options={priceListOptions} selectedKey={priceListId} onSelectionChange={(key) => setPriceListId(String(key ?? ""))} />
              <Select label="Payment terms" options={paymentTermOptions} selectedKey={paymentTermId} onSelectionChange={(key) => setPaymentTermId(String(key ?? ""))} />
              {revising && <TextField label="Reason for this revision" isRequired value={revisionReason} onChange={setRevisionReason} />}
            </div>
          </SalesPanel>

          <SalesPanel
            title="Items"
            actions={
              <Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, { key: nextKey(), itemId: "", quantity: 1, discountPercent: 0 }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add item
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {lines.map((line, index) => {
                const priced = preview?.lines.find((candidate) => candidate.sequence === validLines.findIndex((v) => v.key === line.key) + 1);
                return (
                  <div key={line.key} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Select
                      aria-label={`Item ${index + 1}`}
                      label={index === 0 ? "Item" : undefined}
                      options={itemOptions}
                      selectedKey={line.itemId || null}
                      onSelectionChange={(key) => updateLine(line.key, { itemId: String(key ?? "") })}
                      placeholder="Select an item"
                    />
                    <NumberField aria-label={`Quantity ${index + 1}`} label={index === 0 ? "Quantity" : undefined} value={line.quantity} onChange={(value) => updateLine(line.key, { quantity: value })} minValue={0} step={1} />
                    <NumberField aria-label={`Discount ${index + 1}`} label={index === 0 ? "Discount %" : undefined} value={line.discountPercent} onChange={(value) => updateLine(line.key, { discountPercent: value })} minValue={0} maxValue={100} step={1} />
                    <IconButton aria-label={`Remove item ${index + 1}`} variant="ghost" isDisabled={lines.length === 1} onPress={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                    {priced && (
                      <p className="text-xs text-text-muted sm:col-span-4">
                        {money(currencyCode, priced.unitPrice)} each · net {money(currencyCode, priced.netAmount)} · tax {money(currencyCode, priced.taxAmount)} · line total <span className="font-medium text-text">{money(currencyCode, priced.lineTotal)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </SalesPanel>

          <SalesPanel
            title="Charges & discount"
            description="Freight, handling, or a whole-document discount (which needs price-override permission)."
            actions={
              <Button variant="secondary" size="compact" onPress={() => setCharges((current) => [...current, { key: nextKey(), label: "", calculationType: "fixed", value: 0 }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add charge
              </Button>
            }
          >
            {charges.map((charge) => (
              <div key={charge.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <TextField aria-label="Charge label" label="Label" value={charge.label} onChange={(value) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, label: value } : c)))} />
                <Select
                  aria-label="Charge type"
                  label="Type"
                  options={[
                    { value: "fixed", label: "Fixed amount" },
                    { value: "percentage", label: "% of subtotal" },
                  ]}
                  selectedKey={charge.calculationType}
                  onSelectionChange={(key) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, calculationType: key === "percentage" ? "percentage" : "fixed" } : c)))}
                />
                <NumberField aria-label="Charge value" label="Value" value={charge.value} onChange={(value) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, value } : c)))} minValue={0} step={0.01} />
                <IconButton aria-label="Remove charge" variant="ghost" onPress={() => setCharges((current) => current.filter((c) => c.key !== charge.key))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            ))}
            <NumberField label="Whole-document discount (%)" value={headerDiscount} onChange={setHeaderDiscount} minValue={0} maxValue={100} step={1} className="sm:max-w-xs" />
          </SalesPanel>

          <SalesPanel title="Notes & terms">
            <TextArea label="Notes for the customer" value={customerNotes} onChange={setCustomerNotes} />
            <TextArea label="Terms and conditions" value={terms} onChange={setTerms} />
            <TextArea label="Internal notes (never shown to the customer)" value={internalNotes} onChange={setInternalNotes} />
          </SalesPanel>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <SalesPanel title="Totals" description="Calculated by the server.">
            {previewError ? (
              <SalesAlert tone="warning">{previewError}</SalesAlert>
            ) : !preview ? (
              <p className="text-sm text-text-muted">Choose a customer and add an item to see pricing.</p>
            ) : (
              <>
                <SalesFacts
                  columns={2}
                  items={[
                    { label: "Subtotal", value: money(currencyCode, preview.totals.subtotal) },
                    { label: "Discounts", value: money(currencyCode, preview.totals.discountTotal) },
                    { label: "Charges", value: money(currencyCode, preview.totals.chargeTotal) },
                    { label: "Tax", value: money(currencyCode, preview.totals.taxTotal) },
                    { label: "Rounding", value: money(currencyCode, preview.totals.roundingAdjustment) },
                    ...(preview.totals.marginPercent !== undefined ? [{ label: "Margin", value: `${Number(preview.totals.marginPercent).toFixed(1)}%` }] : []),
                  ]}
                />
                <div className="flex items-center justify-between border-t border-border pt-3 text-lg font-semibold text-text">
                  <span>Grand total</span>
                  <span className="tabular-nums">{money(currencyCode, preview.totals.grandTotal)}</span>
                </div>
              </>
            )}
          </SalesPanel>
        </div>
      </div>
    </div>
  );
}
