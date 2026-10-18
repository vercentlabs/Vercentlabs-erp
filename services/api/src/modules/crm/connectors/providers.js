// What each lead provider sends and how its leads read as CRM leads (CRM plan 3.3).
//
//   IndiaMART   pull: the CRM Listing API v2 (glusr_crm_key), read on a schedule over a time window; also push: the same lead JSON
//               POSTed to the connector's webhook ("Push API").
//   TradeIndia  pull: the My Inquiry API (userid, profile_id, key), read on a schedule by day.
//   JustDial    push: each lead POSTed (JSON or form fields) to the connector's webhook.
//   Meta        push: the Lead Ads "leadgen" webhook (verified by the app secret's signature, and by a verify token when Meta subscribes);
//               the lead itself is then read from the Graph API with the page access token.
//   Google      push: the Google Ads lead-form webhook, verified by the connector's key sent as google_key.
//
// Each adapter turns one provider lead into { externalId, enquiryAt, input } — input is what createLead takes. Network calls go through
// an injectable fetch, so the adapters are tested without the providers.
import { createHmac, timingSafeEqual } from "node:crypto";

import { CrmError } from "../data-management/errors.js";

const text = (value, max = 500) => {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
};
const IST = "+05:30";

function splitName(value) {
  const name = text(value, 200)?.replace(/^(mr|mrs|ms|miss|dr|shri|smt)\.?\s+/i, "");
  if (!name) return {};
  const parts = name.split(" ");
  return parts.length === 1 ? { firstName: parts[0] } : { firstName: parts.slice(0, -1).join(" ").slice(0, 80), lastName: parts.at(-1).slice(0, 80) };
}
const email = (value) => {
  const clean = text(value, 320)?.toLowerCase();
  return clean && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : undefined;
};
// "+91-9876543210" / "9876543210" → as typed; the lead's phone check reads it for India.
const phone = (value) => text(value, 40)?.replace(/^\+91-/, "+91 ");
const country = (value) => {
  const clean = text(value, 60)?.toUpperCase();
  return clean && /^[A-Z]{2}$/.test(clean) ? clean : clean === "INDIA" ? "IN" : undefined;
};
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ""));
// An IST wall-clock time ("2026-10-18 09:12:33") as an instant.
const istTime = (value) => {
  const clean = text(value, 40);
  if (!clean) return null;
  const at = new Date(`${clean.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(clean) ? "" : IST}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

async function getJson(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new CrmError(502, `${label} could not be reached: ${error?.message ?? error}`, "CRM_CONNECTOR_UNREACHABLE");
  }
  const body = await response.text();
  let json;
  try { json = body ? JSON.parse(body) : null; } catch { json = null; }
  if (!response.ok) throw new CrmError(502, `${label} answered ${response.status}${json?.MESSAGE || json?.error?.message ? `: ${json.MESSAGE ?? json.error.message}` : ""}.`, "CRM_CONNECTOR_REFUSED");
  return json;
}

// ------------------------------------------------------------------ IndiaMART
// The API's time format: 18-Oct-202609:00:00 (IST), a window of at most 7 days.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function indiamartTime(at) {
  const ist = new Date(at.getTime() + 330 * 60000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()}${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
}
const INDIAMART_TYPES = { W: "Direct enquiry", B: "Buy lead", P: "Call (PNS)", V: "Catalogue view", BIZ: "Catalogue", WA: "WhatsApp" };
function indiamartLead(raw) {
  const externalId = text(raw?.UNIQUE_QUERY_ID, 100);
  if (!externalId) return null;
  return {
    externalId,
    enquiryAt: istTime(raw.QUERY_TIME),
    input: compact({
      ...splitName(raw.SENDER_NAME),
      email: email(raw.SENDER_EMAIL) ?? email(raw.SENDER_EMAIL_ALT),
      mobile: phone(raw.SENDER_MOBILE),
      phone: phone(raw.SENDER_PHONE) ?? phone(raw.SENDER_MOBILE_ALT),
      companyName: text(raw.SENDER_COMPANY, 240),
      city: text(raw.SENDER_CITY, 120),
      state: text(raw.SENDER_STATE, 120),
      countryCode: country(raw.SENDER_COUNTRY_ISO) ?? "IN",
      productInterest: text(raw.QUERY_PRODUCT_NAME ?? raw.QUERY_MCAT_NAME ?? raw.SUBJECT, 200),
      description: text([raw.SUBJECT, raw.QUERY_MESSAGE].filter(Boolean).join(" — "), 4000),
      sourceDetail: text(`IndiaMART · ${INDIAMART_TYPES[raw.QUERY_TYPE] ?? "Enquiry"} · ${externalId}`, 200),
    }),
  };
}

// ------------------------------------------------------------------ TradeIndia
const day = (at) => new Date(at.getTime() + 330 * 60000).toISOString().slice(0, 10);
function tradeindiaLead(raw) {
  const externalId = text(raw?.rfi_id ?? raw?.inquiry_id, 100);
  if (!externalId) return null;
  return {
    externalId,
    enquiryAt: istTime(raw.generated_date && raw.generated_time ? `${raw.generated_date} ${raw.generated_time}` : raw.generated_date),
    input: compact({
      ...splitName(raw.sender_name),
      email: email(raw.sender_email),
      mobile: phone(raw.sender_mobile),
      phone: phone(raw.sender_phone),
      companyName: text(raw.sender_co ?? raw.sender_company, 240),
      city: text(raw.sender_city, 120),
      state: text(raw.sender_state, 120),
      countryCode: country(raw.sender_country) ?? "IN",
      productInterest: text(raw.product_name ?? raw.subject, 200),
      description: text([raw.subject, raw.message].filter(Boolean).join(" — "), 4000),
      sourceDetail: text(`TradeIndia · ${raw.inquiry_type ?? "Enquiry"} · ${externalId}`, 200),
    }),
  };
}

// ------------------------------------------------------------------ JustDial
function justdialLead(raw) {
  const externalId = text(raw?.leadid ?? raw?.lead_id, 100);
  if (!externalId) return null;
  const name = [raw.prefix && !/^(mr|mrs|ms)\.?$/i.test(raw.prefix) ? raw.prefix : null, raw.name].filter(Boolean).join(" ");
  return {
    externalId,
    enquiryAt: istTime(raw.date && raw.time ? `${raw.date} ${raw.time}` : raw.date),
    input: compact({
      ...splitName(name),
      email: email(raw.email),
      mobile: phone(raw.mobile),
      phone: phone(raw.phone),
      companyName: text(raw.company, 240),
      city: text(raw.city, 120),
      countryCode: "IN",
      productInterest: text(raw.category, 200),
      description: text([raw.category && `Looking for: ${raw.category}`, raw.area && `Area: ${raw.area}`, raw.pincode && `PIN ${raw.pincode}`].filter(Boolean).join(" · "), 4000),
      sourceDetail: text(`JustDial · ${raw.leadtype ?? "Lead"} · ${externalId}`, 200),
    }),
  };
}

// ------------------------------------------------------------------ Meta and Google lead forms
// Form answers by their question name (Meta's full_name, phone_number…; Google's FULL_NAME, PHONE_NUMBER…) into lead fields.
function fromAnswers(answers, extra) {
  const get = (...names) => {
    for (const name of names) {
      const value = answers.get(name);
      if (value) return value;
    }
    return undefined;
  };
  const named = get("full_name", "name") ? splitName(get("full_name", "name")) : compact({ firstName: text(get("first_name"), 80), lastName: text(get("last_name"), 80) });
  const known = new Set(["full_name", "name", "first_name", "last_name", "email", "work_email", "phone_number", "work_phone_number", "company_name", "job_title",
    "city", "state", "province", "region", "country", "post_code", "postal_code", "zip_code"]);
  const other = [...answers.entries()].filter(([name]) => !known.has(name)).map(([name, value]) => `${name.replace(/_/g, " ")}: ${value}`);
  return compact({
    ...named,
    email: email(get("email", "work_email")),
    mobile: phone(get("phone_number", "work_phone_number")),
    companyName: text(get("company_name"), 240),
    jobTitle: text(get("job_title"), 160),
    city: text(get("city"), 120),
    state: text(get("state", "province", "region"), 120),
    countryCode: country(get("country")),
    description: text(other.join("\n"), 4000),
    ...extra,
  });
}

async function metaLead(fetchImpl, credentials, leadgenId) {
  const fields = "created_time,field_data,form_id,ad_name,campaign_name,platform";
  const raw = await getJson(fetchImpl, `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}?fields=${fields}&access_token=${encodeURIComponent(credentials.pageAccessToken)}`, "Meta");
  const answers = new Map((raw?.field_data ?? []).map((field) => [String(field.name ?? "").toLowerCase(), text((field.values ?? []).join(", "), 1000)]));
  const where = raw?.platform === "ig" ? "Instagram" : "Facebook";
  return {
    externalId: String(leadgenId),
    enquiryAt: raw?.created_time ? new Date(raw.created_time).toISOString() : null,
    input: fromAnswers(answers, { sourceDetail: text(`${where} lead ad${raw?.campaign_name ? ` · ${raw.campaign_name}` : ""}${raw?.ad_name ? ` · ${raw.ad_name}` : ""}`, 200) }),
  };
}

function googleLead(body) {
  const externalId = text(body?.lead_id, 200);
  if (!externalId) return null;
  const answers = new Map((body.user_column_data ?? []).map((column) => [String(column.column_id ?? column.column_name ?? "").toLowerCase()
    .replace(/^work_email$/, "work_email").replace(/^full_name$/, "full_name"), text(column.string_value, 1000)]));
  return {
    externalId,
    enquiryAt: null,
    test: Boolean(body.is_test),
    input: fromAnswers(answers, { sourceDetail: text(`Google Ads lead form${body.campaign_id ? ` · campaign ${body.campaign_id}` : ""}`, 200) }),
  };
}

const equal = (a, b) => {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

// ------------------------------------------------------------------ the providers
export const LEAD_PROVIDERS = Object.freeze({
  indiamart: {
    label: "IndiaMART", sourceCode: "indiamart", sourceName: "IndiaMART", pull: true, push: true,
    credentials: [{ key: "crmKey", label: "CRM key", help: "IndiaMART Lead Manager → Import/Export leads → Push/Pull API → CRM key." }],
    async pull(fetchImpl, credentials, { from, to }) {
      // At most 7 days a call; the caller moves on window by window.
      const until = new Date(Math.min(to.getTime(), from.getTime() + 7 * 86400000 - 1000));
      const url = `https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=${encodeURIComponent(credentials.crmKey)}&start_time=${indiamartTime(from)}&end_time=${indiamartTime(until)}`;
      const json = await getJson(fetchImpl, url, "IndiaMART");
      const code = Number(json?.CODE ?? 200);
      if (code === 204) return { leads: [], until };
      if (code === 429) throw new CrmError(429, "IndiaMART allows one read every 5 minutes; it will be read again on the next run.", "CRM_CONNECTOR_TOO_SOON");
      if (code !== 200) throw new CrmError(502, `IndiaMART refused the read: ${json?.MESSAGE ?? `code ${code}`}.`, "CRM_CONNECTOR_REFUSED");
      return { leads: (json?.RESPONSE ?? []).map(indiamartLead).filter(Boolean), until };
    },
    // The Push API POSTs { RESPONSE: { …one lead } }.
    fromPush(body) {
      const raw = body?.RESPONSE ?? body;
      return [indiamartLead(Array.isArray(raw) ? raw[0] : raw)].filter(Boolean);
    },
  },
  tradeindia: {
    label: "TradeIndia", sourceCode: "tradeindia", sourceName: "TradeIndia", pull: true, push: false,
    credentials: [{ key: "userId", label: "User ID" }, { key: "profileId", label: "Profile ID" }, { key: "apiKey", label: "Key", help: "TradeIndia seller panel → Inquiries → API." }],
    async pull(fetchImpl, credentials, { from, to }) {
      const url = `https://www.tradeindia.com/utils/my_inquiry.html?userid=${encodeURIComponent(credentials.userId)}&profile_id=${encodeURIComponent(credentials.profileId)}`
        + `&key=${encodeURIComponent(credentials.apiKey)}&from_date=${day(from)}&to_date=${day(to)}`;
      const json = await getJson(fetchImpl, url, "TradeIndia");
      const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      return { leads: rows.map(tradeindiaLead).filter(Boolean), until: to };
    },
  },
  justdial: {
    label: "JustDial", sourceCode: "justdial", sourceName: "JustDial", pull: false, push: true, credentials: [],
    fromPush(body) {
      return [justdialLead(body)].filter(Boolean);
    },
  },
  meta: {
    label: "Facebook and Instagram lead ads", sourceCode: "meta_lead_ads", sourceName: "Facebook / Instagram ads", pull: false, push: true,
    credentials: [
      { key: "appSecret", label: "App secret", help: "Meta for Developers → your app → App settings → Basic." },
      { key: "pageAccessToken", label: "Page access token", help: "A long-lived token of the Page whose lead forms you run, with leads_retrieval." },
      { key: "verifyToken", label: "Verify token", help: "Any phrase; type the same in the app's Webhooks setup.", generated: true },
    ],
    // Meta's subscription check: GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
    verifySubscription(credentials, params) {
      if (params.get("hub.mode") !== "subscribe" || !equal(params.get("hub.verify_token"), credentials.verifyToken)) return null;
      return params.get("hub.challenge") ?? "";
    },
    verifyPush(credentials, rawBody, headers) {
      const supplied = String(headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/i, "");
      const expected = createHmac("sha256", String(credentials.appSecret ?? "")).update(rawBody).digest("hex");
      if (!equal(supplied, expected)) throw new CrmError(401, "The Meta signature does not match.", "CRM_CONNECTOR_SIGNATURE");
    },
    async fromPush(body, { fetchImpl, credentials }) {
      const ids = (body?.entry ?? []).flatMap((entry) => (entry.changes ?? []).filter((change) => change.field === "leadgen").map((change) => change.value?.leadgen_id)).filter(Boolean);
      const leads = [];
      for (const id of ids.slice(0, 50)) leads.push(await metaLead(fetchImpl, credentials, id));
      return leads;
    },
  },
  google: {
    label: "Google Ads lead forms", sourceCode: "google_ads", sourceName: "Google Ads", pull: false, push: true,
    credentials: [{ key: "googleKey", label: "Key", help: "Paste this into the lead form's webhook \"Key\" in Google Ads.", generated: true }],
    verifyPush(credentials, rawBody) {
      let body;
      try { body = JSON.parse(rawBody); } catch { body = null; }
      if (!equal(body?.google_key, credentials.googleKey)) throw new CrmError(401, "The Google Ads key does not match.", "CRM_CONNECTOR_SIGNATURE");
    },
    fromPush(body) {
      return [googleLead(body)].filter(Boolean);
    },
  },
});

export const providerOf = (key) => {
  const provider = LEAD_PROVIDERS[key];
  if (!provider) throw new CrmError(400, "Choose IndiaMART, JustDial, TradeIndia, Meta or Google.", "CRM_CONNECTOR_PROVIDER");
  return provider;
};
