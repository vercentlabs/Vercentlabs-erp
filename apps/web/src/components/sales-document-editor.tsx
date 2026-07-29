"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/components/app-icon";

type OptionRow = Record<string, string | number | boolean | null>;
type Options = {
  companies: OptionRow[];
  branches: OptionRow[];
  parties: OptionRow[];
  contacts: OptionRow[];
  addresses: OptionRow[];
  items: OptionRow[];
  uoms: OptionRow[];
  warehouses: OptionRow[];
  priceLists: OptionRow[];
  paymentTerms: OptionRow[];
  currencies: OptionRow[];
  users: OptionRow[];
  opportunities: OptionRow[];
  opportunityItems: OptionRow[];
};
type SalesPreview = {
  totals: {
    subtotal: unknown;
    discountTotal: unknown;
    taxTotal: unknown;
    grandTotal: unknown;
  };
};
type Line = {
  itemId: string;
  uomId: string;
  warehouseId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  requestedDeliveryDate: string;
  manualPriceReason: string;
};

const emptyLine = (): Line => ({
  itemId: "",
  uomId: "",
  warehouseId: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  discountPercent: "0",
  requestedDeliveryDate: "",
  manualPriceReason: "",
});

const iso = (days = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const optionId = (option: OptionRow | undefined, key = "id") =>
  String(option?.[key] || "");

function formatMoney(value: unknown, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency || "INR"} —`;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "INR"} ${new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
}

export default function SalesDocumentEditor({
  mode,
  opportunityId,
}: {
  mode: "quotation" | "order";
  opportunityId?: string;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<SalesPreview | null>(null);
  const [form, setForm] = useState({
    companyId: "",
    branchId: "",
    partyId: "",
    contactId: "",
    ownerUserId: "",
    currencyCode: "",
    exchangeRate: "1",
    priceListId: "",
    paymentTermId: "",
    billingAddressId: "",
    shippingAddressId: "",
    validUntil: iso(15),
    requestedDeliveryDate: "",
    customerPoNumber: "",
    customerPoDate: "",
    priority: "normal",
    deliveryTerms: "",
    shippingMethod: "",
    incoterm: "",
    placeOfSupply: "",
    supplyType: "domestic",
    customerNotes: "",
    internalNotes: "",
    termsAndConditions: "",
  });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    fetch(
      `/api/sales/options${
        opportunityId ? `?opportunityId=${encodeURIComponent(opportunityId)}` : ""
      }`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message);
        return data;
      })
      .then((data) => {
        const value = data.options as Options;
        setOptions(value);
        const opportunity = value.opportunities[0];
        const company = opportunity?.company_id || value.companies[0]?.id || "";
        const party = opportunity?.party_id || value.parties[0]?.id || "";
        const currency =
          opportunity?.currency_code || value.currencies[0]?.code || "INR";
        setForm((current) => ({
          ...current,
          companyId: String(company),
          branchId: String(opportunity?.branch_id || ""),
          partyId: String(party),
          contactId: String(opportunity?.contact_id || ""),
          ownerUserId: String(
            opportunity?.owner_user_id || value.users[0]?.id || "",
          ),
          currencyCode: String(currency),
          priceListId: String(
            value.opportunityItems[0]?.price_list_id ||
              value.priceLists.find(
                (priceList) => String(priceList.currency_code) === String(currency),
              )?.id ||
              "",
          ),
          paymentTermId: String(
            value.parties.find((candidate) => String(candidate.id) === String(party))
              ?.payment_term_id || value.paymentTerms[0]?.id || "",
          ),
        }));
        if (value.opportunityItems.length) {
          setLines(
            value.opportunityItems.map((item) => ({
              itemId: String(item.item_id),
              uomId: String(item.uom_id || ""),
              warehouseId: "",
              description: String(item.description || ""),
              quantity: String(item.quantity || 1),
              unitPrice: String(item.unit_price || ""),
              discountPercent: String(item.discount_percent || 0),
              requestedDeliveryDate: "",
              manualPriceReason: "Imported from CRM opportunity",
            })),
          );
        }
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name !== "AbortError") {
          setMessage(error instanceof Error ? error.message : "Sales data could not be loaded.");
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [opportunityId]);

  const partyContacts = useMemo(
    () =>
      options?.contacts.filter(
        (contact) => String(contact.party_id) === form.partyId,
      ) || [],
    [options, form.partyId],
  );
  const partyAddresses = useMemo(
    () =>
      options?.addresses.filter(
        (address) => String(address.party_id) === form.partyId,
      ) || [],
    [options, form.partyId],
  );
  const companyBranches = useMemo(
    () =>
      options?.branches.filter(
        (branch) => String(branch.company_id) === form.companyId,
      ) || [],
    [options, form.companyId],
  );
  const companyWarehouses = useMemo(
    () =>
      options?.warehouses.filter(
        (warehouse) => String(warehouse.company_id) === form.companyId,
      ) || [],
    [options, form.companyId],
  );
  const selectedCustomer = options?.parties.find(
    (party) => String(party.id) === form.partyId,
  );

  function updateLine(index: number, key: keyof Line, value: string) {
    setPreview(null);
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [key]: value } : line,
      ),
    );
  }

  function itemChanged(index: number, itemId: string) {
    const item = options?.items.find((row) => String(row.id) === itemId);
    setPreview(null);
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              itemId,
              uomId: String(item?.uom_id || ""),
              description: String(item?.description || ""),
              unitPrice: "",
            }
          : line,
      ),
    );
  }

  const payload = () => ({
    ...form,
    opportunityId: opportunityId || null,
    branchId: form.branchId || null,
    contactId: form.contactId || null,
    ownerUserId: form.ownerUserId || null,
    priceListId: form.priceListId || null,
    paymentTermId: form.paymentTermId || null,
    billingAddressId: form.billingAddressId || null,
    shippingAddressId: form.shippingAddressId || null,
    requestedDeliveryDate: form.requestedDeliveryDate || null,
    customerPoDate: form.customerPoDate || null,
    lines: lines.map((line) => ({
      ...line,
      uomId: line.uomId || null,
      warehouseId: line.warehouseId || null,
      unitPrice: line.unitPrice || null,
      requestedDeliveryDate: line.requestedDeliveryDate || null,
      manualPriceReason: line.manualPriceReason || null,
    })),
    charges: [],
  });

  async function request(endpoint: string, body: unknown) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message);
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function previewDocument() {
    setPending(true);
    setMessage("");
    try {
      const data = await request("/api/sales/pricing/preview", payload());
      setPreview(data.preview as SalesPreview);
    } catch (error) {
      setMessage(
        error instanceof Error && error.name === "AbortError"
          ? "Pricing preview timed out. Try again."
          : error instanceof Error
            ? error.message
            : "Preview failed.",
      );
    } finally {
      setPending(false);
    }
  }

  async function save() {
    setPending(true);
    setMessage("");
    try {
      const endpoint =
        mode === "quotation" ? "/api/sales/quotations" : "/api/sales/orders";
      const data = await request(endpoint, payload());
      router.push(
        mode === "quotation"
          ? `/sales/quotations/${data.quotation.id}`
          : `/sales/orders/${data.order.id}`,
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error && error.name === "AbortError"
          ? "The save request timed out. Your document was not confirmed as saved."
          : error instanceof Error
            ? error.message
            : "Save failed.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!options) {
    return (
      <section className="module-loading-state" aria-live="polite">
        <span className="module-empty-icon" aria-hidden="true">
          <AppIcon name="sales" size={22} />
        </span>
        <strong>{message || "Preparing the sales workspace…"}</strong>
        <p>Loading customers, products, pricing, warehouses and commercial policy.</p>
      </section>
    );
  }

  return (
    <div className="sales-editor enterprise-sales-editor">
      {message ? (
        <div className="form-message error" role="alert">
          {message}
        </div>
      ) : null}

      <header className="document-composer-header">
        <div className="document-composer-identity">
          <span aria-hidden="true">
            <AppIcon name="sales" size={21} />
          </span>
          <div>
            <p className="eyebrow">Sales · {mode === "quotation" ? "Proposal" : "Commitment"}</p>
            <h1>{mode === "quotation" ? "Create quotation" : "Create sales order"}</h1>
            <p>
              Build a governed commercial document with pricing, tax, fulfilment
              and approval evidence in one workspace.
            </p>
          </div>
        </div>
        <ol className="document-stepper" aria-label="Document creation steps">
          <li className={form.partyId ? "complete" : "active"}><span>1</span>Customer</li>
          <li className={lines.some((line) => line.itemId) ? "complete" : ""}><span>2</span>Lines</li>
          <li className={preview ? "complete" : ""}><span>3</span>Validate</li>
          <li><span>4</span>Create</li>
        </ol>
      </header>

      <div className="enterprise-document-editor sales-document-composer">
        <main className="enterprise-editor-main">
          <section className="enterprise-editor-section">
            <header className="enterprise-section-heading">
              <span>01</span>
              <div>
                <p className="eyebrow">Commercial context</p>
                <h2>Customer and operating company</h2>
                <p>Define who is buying, who owns the sale and which entity will fulfil it.</p>
              </div>
            </header>
            <div className="enterprise-form-grid">
              <label>
                Company
                <select
                  value={form.companyId}
                  onChange={(event) => {
                    setPreview(null);
                    setForm({ ...form, companyId: event.target.value, branchId: "" });
                  }}
                >
                  {options.companies.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Branch
                <select
                  value={form.branchId}
                  onChange={(event) => setForm({ ...form, branchId: event.target.value })}
                >
                  <option value="">Company-wide</option>
                  {companyBranches.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-span-2">
                Customer
                <select
                  value={form.partyId}
                  onChange={(event) => {
                    setPreview(null);
                    setForm({
                      ...form,
                      partyId: event.target.value,
                      contactId: "",
                      billingAddressId: "",
                      shippingAddressId: "",
                    });
                  }}
                >
                  <option value="">Select customer</option>
                  {options.parties.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.display_name)} · {String(option.party_type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer contact
                <select
                  value={form.contactId}
                  onChange={(event) => setForm({ ...form, contactId: event.target.value })}
                >
                  <option value="">No contact selected</option>
                  {partyContacts.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.first_name)} {String(option.last_name || "")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sales owner
                <select
                  value={form.ownerUserId}
                  onChange={(event) => setForm({ ...form, ownerUserId: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {options.users.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.display_name || option.name || option.email)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="enterprise-editor-section">
            <header className="enterprise-section-heading">
              <span>02</span>
              <div>
                <p className="eyebrow">Pricing and tax</p>
                <h2>Commercial terms</h2>
                <p>Set currency, pricing policy, payment terms and tax jurisdiction.</p>
              </div>
            </header>
            <div className="enterprise-form-grid">
              <label>
                Currency
                <select
                  value={form.currencyCode}
                  onChange={(event) => {
                    setPreview(null);
                    setForm({ ...form, currencyCode: event.target.value, priceListId: "" });
                  }}
                >
                  {options.currencies.map((option) => (
                    <option key={optionId(option, "code")} value={optionId(option, "code")}>
                      {String(option.code)} · {String(option.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exchange rate
                <input
                  inputMode="decimal"
                  value={form.exchangeRate}
                  onChange={(event) => {
                    setPreview(null);
                    setForm({ ...form, exchangeRate: event.target.value });
                  }}
                />
              </label>
              <label>
                Price list
                <select
                  value={form.priceListId}
                  onChange={(event) => {
                    setPreview(null);
                    setForm({ ...form, priceListId: event.target.value });
                  }}
                >
                  <option value="">Use item default prices</option>
                  {options.priceLists
                    .filter(
                      (option) => String(option.currency_code) === form.currencyCode,
                    )
                    .map((option) => (
                      <option key={optionId(option)} value={optionId(option)}>
                        {String(option.name)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Payment term
                <select
                  value={form.paymentTermId}
                  onChange={(event) => setForm({ ...form, paymentTermId: event.target.value })}
                >
                  <option value="">Use customer default</option>
                  {options.paymentTerms.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Supply type
                <select
                  value={form.supplyType}
                  onChange={(event) => setForm({ ...form, supplyType: event.target.value })}
                >
                  <option value="domestic">Domestic</option>
                  <option value="export">Export</option>
                  <option value="sez">SEZ</option>
                  <option value="deemed_export">Deemed export</option>
                </select>
              </label>
              <label>
                Place of supply
                <input
                  value={form.placeOfSupply}
                  onChange={(event) =>
                    setForm({ ...form, placeOfSupply: event.target.value.toUpperCase() })
                  }
                  placeholder="State or jurisdiction code"
                />
              </label>
            </div>
          </section>

          <section className="enterprise-editor-section">
            <header className="enterprise-section-heading with-action">
              <span>03</span>
              <div>
                <p className="eyebrow">Products and services</p>
                <h2>Document lines</h2>
                <p>Add items, quantities, fulfilment source and any governed price override.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setLines([...lines, emptyLine()])}
              >
                Add line
              </button>
            </header>
            <div className="sales-line-cards">
              {lines.map((line, index) => (
                <article className="sales-line-card" key={index}>
                  <header>
                    <div>
                      <span className="line-index">{String(index + 1).padStart(2, "0")}</span>
                      <strong>Document line</strong>
                    </div>
                    <button
                      className="line-remove-button"
                      type="button"
                      onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))}
                      disabled={lines.length === 1}
                    >
                      Remove
                    </button>
                  </header>
                  <div className="enterprise-form-grid line-form-grid">
                    <label className="field-span-2">
                      Item
                      <select
                        value={line.itemId}
                        onChange={(event) => itemChanged(index, event.target.value)}
                      >
                        <option value="">Select product or service</option>
                        {options.items
                          .filter(
                            (item) =>
                              !item.company_id || String(item.company_id) === form.companyId,
                          )
                          .map((option) => (
                            <option key={optionId(option)} value={optionId(option)}>
                              {String(option.code)} · {String(option.name)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) => updateLine(index, "quantity", event.target.value)}
                      />
                    </label>
                    <label>
                      Unit of measure
                      <select
                        value={line.uomId}
                        onChange={(event) => updateLine(index, "uomId", event.target.value)}
                      >
                        <option value="">Select UOM</option>
                        {options.uoms.map((option) => (
                          <option key={optionId(option)} value={optionId(option)}>
                            {String(option.code)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Unit price
                      <input
                        inputMode="decimal"
                        value={line.unitPrice}
                        placeholder="Calculated by pricing"
                        onChange={(event) => updateLine(index, "unitPrice", event.target.value)}
                      />
                    </label>
                    <label>
                      Discount percentage
                      <input
                        inputMode="decimal"
                        value={line.discountPercent}
                        onChange={(event) =>
                          updateLine(index, "discountPercent", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Fulfilment warehouse
                      <select
                        value={line.warehouseId}
                        onChange={(event) => updateLine(index, "warehouseId", event.target.value)}
                      >
                        <option value="">Not selected</option>
                        {companyWarehouses.map((option) => (
                          <option key={optionId(option)} value={optionId(option)}>
                            {String(option.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Requested delivery
                      <input
                        type="date"
                        value={line.requestedDeliveryDate}
                        onChange={(event) =>
                          updateLine(index, "requestedDeliveryDate", event.target.value)
                        }
                      />
                    </label>
                    <label className="field-span-2">
                      Customer-facing description
                      <textarea
                        value={line.description}
                        onChange={(event) =>
                          updateLine(index, "description", event.target.value)
                        }
                      />
                    </label>
                    <label className="field-span-2">
                      Manual price reason
                      <input
                        value={line.manualPriceReason}
                        onChange={(event) =>
                          updateLine(index, "manualPriceReason", event.target.value)
                        }
                        placeholder="Required when overriding the calculated price"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="enterprise-editor-section">
            <header className="enterprise-section-heading">
              <span>04</span>
              <div>
                <p className="eyebrow">Delivery and communication</p>
                <h2>Customer promise</h2>
                <p>Capture destination, delivery expectations and document communication.</p>
              </div>
            </header>
            <div className="enterprise-form-grid">
              <label>
                Billing address
                <select
                  value={form.billingAddressId}
                  onChange={(event) => setForm({ ...form, billingAddressId: event.target.value })}
                >
                  <option value="">No address selected</option>
                  {partyAddresses.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.address_type)} · {String(option.line1)}, {String(option.city)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shipping address
                <select
                  value={form.shippingAddressId}
                  onChange={(event) => setForm({ ...form, shippingAddressId: event.target.value })}
                >
                  <option value="">No address selected</option>
                  {partyAddresses.map((option) => (
                    <option key={optionId(option)} value={optionId(option)}>
                      {String(option.address_type)} · {String(option.line1)}, {String(option.city)}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "quotation" ? (
                <label>
                  Valid until
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(event) => setForm({ ...form, validUntil: event.target.value })}
                  />
                </label>
              ) : (
                <>
                  <label>
                    Requested delivery
                    <input
                      type="date"
                      value={form.requestedDeliveryDate}
                      onChange={(event) =>
                        setForm({ ...form, requestedDeliveryDate: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Customer PO number
                    <input
                      value={form.customerPoNumber}
                      onChange={(event) =>
                        setForm({ ...form, customerPoNumber: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Customer PO date
                    <input
                      type="date"
                      value={form.customerPoDate}
                      onChange={(event) =>
                        setForm({ ...form, customerPoDate: event.target.value })
                      }
                    />
                  </label>
                </>
              )}
              <label>
                Priority
                <select
                  value={form.priority}
                  onChange={(event) => setForm({ ...form, priority: event.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label>
                Delivery terms
                <input
                  value={form.deliveryTerms}
                  onChange={(event) => setForm({ ...form, deliveryTerms: event.target.value })}
                />
              </label>
              <label>
                Shipping method
                <input
                  value={form.shippingMethod}
                  onChange={(event) => setForm({ ...form, shippingMethod: event.target.value })}
                />
              </label>
              <label>
                Incoterm
                <input
                  value={form.incoterm}
                  onChange={(event) => setForm({ ...form, incoterm: event.target.value })}
                />
              </label>
              <label className="field-span-2">
                Customer notes
                <textarea
                  value={form.customerNotes}
                  onChange={(event) => setForm({ ...form, customerNotes: event.target.value })}
                />
              </label>
              <label className="field-span-2">
                Terms and conditions
                <textarea
                  value={form.termsAndConditions}
                  onChange={(event) =>
                    setForm({ ...form, termsAndConditions: event.target.value })
                  }
                />
              </label>
              <label className="field-span-2">
                Internal notes
                <textarea
                  value={form.internalNotes}
                  onChange={(event) => setForm({ ...form, internalNotes: event.target.value })}
                />
              </label>
            </div>
          </section>
        </main>

        <aside className="enterprise-editor-aside">
          <section className="document-summary-card">
            <p className="eyebrow">Commercial summary</p>
            <h2>{mode === "quotation" ? "Quotation" : "Sales order"}</h2>
            <dl className="document-summary-list">
              <div>
                <dt>Customer</dt>
                <dd>{String(selectedCustomer?.display_name || "Not selected")}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{form.currencyCode || "—"}</dd>
              </div>
              <div>
                <dt>Lines</dt>
                <dd>{lines.length}</dd>
              </div>
              <div>
                <dt>Pricing status</dt>
                <dd>{preview ? "Validated" : "Preview required"}</dd>
              </div>
            </dl>
            {preview ? (
              <div className="pricing-summary">
                <div><span>Subtotal</span><strong>{formatMoney(preview.totals.subtotal, form.currencyCode)}</strong></div>
                <div><span>Discount</span><strong>{formatMoney(preview.totals.discountTotal, form.currencyCode)}</strong></div>
                <div><span>Tax</span><strong>{formatMoney(preview.totals.taxTotal, form.currencyCode)}</strong></div>
                <div className="pricing-grand-total"><span>Grand total</span><strong>{formatMoney(preview.totals.grandTotal, form.currencyCode)}</strong></div>
              </div>
            ) : (
              <div className="summary-guidance">
                <AppIcon name="sparkles" size={18} />
                <p>Run a preview to validate pricing, tax, discount and margin controls on the server.</p>
              </div>
            )}
            <div className="sticky-document-actions">
              <button
                className="secondary-button full-width-button"
                type="button"
                onClick={previewDocument}
                disabled={pending}
              >
                {pending ? "Validating…" : "Preview pricing"}
              </button>
              <button
                className="primary-button full-width-button"
                type="button"
                onClick={save}
                disabled={pending}
              >
                {pending
                  ? "Working…"
                  : mode === "quotation"
                    ? "Create quotation"
                    : "Create sales order"}
              </button>
            </div>
          </section>

          <section className="assurance-card">
            <p className="eyebrow">Governed workflow</p>
            <h3>Before creation</h3>
            <ul className="assurance-list">
              <li><span>✓</span>Customer and company scope are enforced</li>
              <li><span>✓</span>Pricing and tax are recalculated server-side</li>
              <li><span>✓</span>Manual overrides retain business evidence</li>
              <li><span>✓</span>Approval policy applies after creation</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
