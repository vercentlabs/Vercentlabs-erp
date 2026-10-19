// The company profile (Shared Platform plan 3): everything a company prints on its documents — legal name, PAN, CIN, Udyam number,
// the GSTIN and state (its default GST registration), address, phone, email, website, logo, the authorised signatory's signature,
// the bank accounts customers pay into and the UPI ID — plus the financial year and time zone. Anyone in the company may read it;
// changing it needs organization.manage. The setup wizard (setup.js) fills it the first time.
import { findIndianState, isValidPan } from "@vercentlabs/shared-types";

import { requireSessionPermission } from "../access/index.js";
import { validateGstin } from "../invoicing/index.js";
import { archiveFile, prepareFileUpload, readFileContent, storeFile } from "../platform/files/index.js";
import { audit } from "../security/request-security.js";

export class CompanyProfileError extends Error {
  constructor(status, message, code = "COMPANY_PROFILE_INVALID", details = undefined) {
    super(message);
    this.name = "CompanyProfileError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const invalid = (field, message) => new CompanyProfileError(422, message, "COMPANY_PROFILE_INVALID", { field });
const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
const clean = (value, max) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
};
const IMAGE_TYPES = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });
const IMAGE_MAX_BYTES = 1024 * 1024;
export const COMPANY_IMAGE_KINDS = Object.freeze({ logo: "platform.company_logo", signature: "platform.company_signature" });

async function defaultRegistration(client, organizationId) {
  return (await client.query(
    `SELECT id, name, legal_name, registration_number, state_code, state_name, registration_type, status
       FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at LIMIT 1`, [organizationId])).rows[0] ?? null;
}

async function currentImage(client, organizationId, kind) {
  return (await client.query(
    `SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $1::text AND is_current AND lifecycle_status <> 'archived'
      ORDER BY created_at DESC LIMIT 1`, [organizationId, COMPANY_IMAGE_KINDS[kind]])).rows[0] ?? null;
}

export async function listCompanyBankAccounts(client, organizationId) {
  return (await client.query(
    `SELECT id, account_name, bank_name, account_number, ifsc, branch, account_type, is_default, show_on_documents, status
       FROM tenant.company_bank_accounts WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at`, [organizationId])).rows
    .map((row) => ({ id: row.id, accountName: row.account_name, bankName: row.bank_name, accountNumber: row.account_number, ifsc: row.ifsc, branch: row.branch,
      accountType: row.account_type, isDefault: row.is_default, showOnDocuments: row.show_on_documents }));
}

export async function getCompanyProfile(client, organizationId) {
  const row = (await client.query(
    `SELECT id, name, legal_name, pan, cin, udyam_number, address_line1, address_line2, city, state_code, postal_code, country_code, phone, email, website, upi_id,
            timezone, base_currency, fiscal_year_start_month, onboarding_completed_at, closure_scheduled_for, closed_at
       FROM public.organizations WHERE id = $1`, [organizationId])).rows[0];
  if (!row) throw new CompanyProfileError(404, "Company not found.", "COMPANY_NOT_FOUND");
  const registration = await defaultRegistration(client, organizationId);
  const logo = await currentImage(client, organizationId, "logo");
  const signature = await currentImage(client, organizationId, "signature");
  const state = row.state_code ? findIndianState({ code: row.state_code }) : null;
  return {
    name: row.name, legalName: row.legal_name, pan: row.pan, cin: row.cin, udyamNumber: row.udyam_number,
    gstin: registration?.registration_number ?? null, gstRegistrationId: registration?.id ?? null, gstRegistrationType: registration?.registration_type ?? null,
    address: { line1: row.address_line1, line2: row.address_line2, city: row.city, stateCode: row.state_code, stateName: state?.name ?? null, postalCode: row.postal_code, countryCode: String(row.country_code ?? "IN").trim() },
    phone: row.phone, email: row.email, website: row.website, upiId: row.upi_id,
    timezone: row.timezone, baseCurrency: String(row.base_currency ?? "").trim(), fiscalYearStartMonth: row.fiscal_year_start_month,
    hasLogo: Boolean(logo), hasSignature: Boolean(signature),
    bankAccounts: await listCompanyBankAccounts(client, organizationId),
    onboardingCompletedAt: row.onboarding_completed_at, closureScheduledFor: row.closure_scheduled_for,
  };
}

// The GSTIN becomes (or updates) the company's default GST registration; its state and PAN must agree with the profile.
async function saveGstin(client, session, gstin, { legalName, name, stateCode, address }) {
  const check = validateGstin(gstin);
  if (!check.valid) throw invalid("gstin", check.message);
  const state = findIndianState({ code: check.stateCode });
  if (!state) throw invalid("gstin", "The GSTIN's state code is not an Indian state.");
  if (stateCode && stateCode !== check.stateCode) throw invalid("gstin", `This GSTIN is registered in ${state.name}; the address is in another state. Use the GSTIN of the address's state (other states' GSTINs go in Settings › Taxes).`);
  const current = await defaultRegistration(client, session.organizationId);
  const same = current && current.registration_number === check.gstin;
  if (current) {
    await client.query(
      `UPDATE tenant.tax_registrations SET registration_number = $3, state_code = $4, state_name = $5, legal_name = COALESCE($6, legal_name), name = COALESCE($7, name),
              address_line1 = COALESCE($8, address_line1), updated_by = $9, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [session.organizationId, current.id, check.gstin, check.stateCode, state.name, legalName, name, address, session.userId]);
  } else {
    await client.query(
      `INSERT INTO tenant.tax_registrations (organization_id, code, name, legal_name, registration_number, state_code, state_name, address_line1, is_default, registration_type, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'regular', $9, $9)`,
      [session.organizationId, `GST-${check.stateCode}`, name ?? state.name, legalName, check.gstin, check.stateCode, state.name, address, session.userId]);
  }
  return { gstin: check.gstin, stateCode: check.stateCode, changed: !same };
}

// input: any of name, legalName, pan, cin, udyamNumber, gstin, address { line1, line2, city, stateCode, postalCode }, phone, email,
// website, upiId, timezone, fiscalYearStartMonth.
export async function updateCompanyProfile(client, session, input = {}) {
  requireSessionPermission(session, "organization.manage");
  const before = await getCompanyProfile(client, session.organizationId);
  const sets = [];
  const values = [session.organizationId];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (has(input, "name")) {
    const name = clean(input.name, 200);
    if (!name) throw invalid("name", "Enter the company name.");
    set("name", name);
  }
  if (has(input, "legalName")) set("legal_name", clean(input.legalName, 200));
  let pan = before.pan;
  if (has(input, "pan")) {
    pan = clean(input.pan, 10)?.toUpperCase() ?? null;
    if (pan && !isValidPan(pan)) throw invalid("pan", "A PAN is 10 characters, like ABCDE1234F.");
    set("pan", pan);
    set("tax_id", pan);
  }
  if (has(input, "cin")) {
    const cin = clean(input.cin, 21)?.toUpperCase() ?? null;
    if (cin && !/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(cin)) throw invalid("cin", "A CIN is 21 characters, like U72900PN2020PTC123456.");
    set("cin", cin);
  }
  if (has(input, "udyamNumber")) {
    const udyam = clean(input.udyamNumber, 19)?.toUpperCase() ?? null;
    if (udyam && !/^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/.test(udyam)) throw invalid("udyamNumber", "An Udyam number looks like UDYAM-MH-26-0012345.");
    set("udyam_number", udyam);
  }
  let stateCode = before.address.stateCode;
  if (has(input, "address")) {
    const address = input.address ?? {};
    const state = address.stateCode ? findIndianState({ code: address.stateCode }) : address.state ? findIndianState({ name: address.state }) : null;
    if ((address.stateCode || address.state) && !state) throw invalid("address.stateCode", "Choose the state.");
    const postal = clean(address.postalCode, 10);
    if (postal && !/^[1-9][0-9]{5}$/.test(postal)) throw invalid("address.postalCode", "Enter the 6-digit PIN code.");
    stateCode = state?.code ?? null;
    set("address_line1", clean(address.line1, 200)); set("address_line2", clean(address.line2, 200)); set("city", clean(address.city, 100));
    set("state_code", stateCode); set("postal_code", postal);
  }
  if (has(input, "phone")) {
    const phone = clean(input.phone, 20);
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw invalid("phone", "Enter a valid phone number.");
    set("phone", phone);
  }
  if (has(input, "email")) {
    const email = clean(input.email, 320)?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid("email", "Enter a valid email address.");
    set("email", email);
  }
  if (has(input, "website")) {
    let website = clean(input.website, 200);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website) { try { new URL(website); } catch { throw invalid("website", "Enter a valid website address."); } }
    set("website", website);
  }
  if (has(input, "upiId")) {
    const upi = clean(input.upiId, 320);
    if (upi && !/^[A-Za-z0-9._-]{2,200}@[A-Za-z]{2,64}$/.test(upi)) throw invalid("upiId", "A UPI ID looks like yourcompany@okhdfcbank.");
    set("upi_id", upi);
  }
  if (has(input, "timezone")) {
    const zone = clean(input.timezone, 100);
    try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { throw invalid("timezone", "Choose a valid time zone."); }
    set("timezone", zone);
  }
  if (has(input, "fiscalYearStartMonth")) {
    const month = Number(input.fiscalYearStartMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw invalid("fiscalYearStartMonth", "Choose the month the financial year starts.");
    set("fiscal_year_start_month", month);
  }
  let gst = null;
  if (has(input, "gstin") && clean(input.gstin, 15)) {
    const gstin = clean(input.gstin, 15).toUpperCase();
    if (pan && gstin.slice(2, 12) !== pan) throw invalid("gstin", "The GSTIN's PAN (characters 3 to 12) does not match the company's PAN.");
    gst = await saveGstin(client, session, gstin, {
      legalName: has(input, "legalName") ? clean(input.legalName, 200) : before.legalName, name: has(input, "name") ? clean(input.name, 200) : before.name, stateCode,
      address: has(input, "address") ? clean(input.address?.line1, 200) : before.address.line1,
    });
    if (!pan) { set("pan", gstin.slice(2, 12)); set("tax_id", gstin.slice(2, 12)); }
  }
  if (sets.length) {
    sets.push("updated_at = now()");
    await client.query(`UPDATE public.organizations SET ${sets.join(", ")} WHERE id = $1`, values);
  }
  const after = await getCompanyProfile(client, session.organizationId);
  await audit(client, {
    organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.profile.updated", entityType: "organization", entityId: session.organizationId,
    beforeData: { ...before, bankAccounts: undefined }, afterData: { ...after, bankAccounts: undefined }, metadata: { gstinChanged: Boolean(gst?.changed) },
  });
  return after;
}

// ---------------------------------------------------------------- logo and signature

export async function prepareCompanyImage({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,5})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  const mimeType = IMAGE_TYPES[extension];
  if (!mimeType) throw new CompanyProfileError(400, "Use a PNG, JPEG or WebP image.", "COMPANY_IMAGE_TYPE");
  if (bytes?.length > IMAGE_MAX_BYTES) throw new CompanyProfileError(413, "The image can be at most 1 MB.", "COMPANY_IMAGE_TOO_LARGE");
  try {
    return await prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: IMAGE_MAX_BYTES, allowedTypes: [...new Set(Object.values(IMAGE_TYPES))] }, env);
  } catch (error) {
    if (error?.status && error.status < 500) throw new CompanyProfileError(error.status, "This file is not a real image of that type.", "COMPANY_IMAGE_CONTENT");
    throw error;
  }
}

export async function setCompanyImage(client, session, kind, prepared, options = {}) {
  requireSessionPermission(session, "organization.manage");
  if (!COMPANY_IMAGE_KINDS[kind]) throw new CompanyProfileError(400, "Only the logo and the signature can be uploaded here.", "COMPANY_IMAGE_KIND");
  const entityType = COMPANY_IMAGE_KINDS[kind];
  const previous = await currentImage(client, session.organizationId, kind);
  if (previous) await archiveFile(client, { organizationId: session.organizationId, entityType, entityId: session.organizationId, fileId: previous.id, actorUserId: session.userId });
  const file = await storeFile(client, { organizationId: session.organizationId, entityType, entityId: session.organizationId, prepared, uploadedBy: session.userId }, options);
  if (kind === "logo") await client.query(`UPDATE public.organizations SET logo_file_id = $2, updated_at = now() WHERE id = $1`, [session.organizationId, file.id]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: `organization.${kind}.changed`, entityType: "organization", entityId: session.organizationId });
  return { fileId: file.id };
}

export async function removeCompanyImage(client, session, kind) {
  requireSessionPermission(session, "organization.manage");
  const previous = await currentImage(client, session.organizationId, kind);
  if (previous) await archiveFile(client, { organizationId: session.organizationId, entityType: COMPANY_IMAGE_KINDS[kind], entityId: session.organizationId, fileId: previous.id, actorUserId: session.userId });
  if (kind === "logo") await client.query(`UPDATE public.organizations SET logo_file_id = NULL, updated_at = now() WHERE id = $1`, [session.organizationId]);
  return { removed: Boolean(previous) };
}

// The image's bytes (for the settings page and the document engine), or null.
export async function readCompanyImage(client, organizationId, kind, options = {}) {
  if (!COMPANY_IMAGE_KINDS[kind]) return null;
  const image = await currentImage(client, organizationId, kind);
  if (!image) return null;
  const content = await readFileContent(client, { organizationId, entityType: COMPANY_IMAGE_KINDS[kind], entityId: organizationId, fileId: image.id }, options);
  return { fileName: image.file_name, mimeType: image.mime_type, body: content.body };
}

// ---------------------------------------------------------------- bank accounts printed on documents

export async function saveCompanyBankAccount(client, session, input = {}) {
  requireSessionPermission(session, "organization.manage");
  const accountName = clean(input.accountName, 200);
  const bankName = clean(input.bankName, 200);
  const accountNumber = String(input.accountNumber ?? "").replace(/\s+/g, "");
  const ifsc = String(input.ifsc ?? "").trim().toUpperCase();
  if (!accountName) throw invalid("accountName", "Enter the account holder's name.");
  if (!bankName) throw invalid("bankName", "Enter the bank's name.");
  if (!/^[0-9]{6,20}$/.test(accountNumber)) throw invalid("accountNumber", "An account number is 6 to 20 digits.");
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw invalid("ifsc", "An IFSC is 11 characters, like HDFC0001234.");
  const accountType = ["current", "savings", "cash_credit", "overdraft"].includes(input.accountType) ? input.accountType : "current";
  const existingCount = Number((await client.query(`SELECT count(*) FROM tenant.company_bank_accounts WHERE organization_id = $1 AND status = 'active'`, [session.organizationId])).rows[0].count);
  const isDefault = input.isDefault === true || existingCount === 0;
  if (isDefault) await client.query(`UPDATE tenant.company_bank_accounts SET is_default = false WHERE organization_id = $1 AND is_default`, [session.organizationId]);
  const values = [session.organizationId, accountName, bankName, accountNumber, ifsc, clean(input.branch, 200), accountType, isDefault, input.showOnDocuments !== false, session.userId];
  let row;
  if (input.id) {
    row = (await client.query(
      `UPDATE tenant.company_bank_accounts SET account_name = $2, bank_name = $3, account_number = $4, ifsc = $5, branch = $6, account_type = $7,
              is_default = $8 OR is_default, show_on_documents = $9, updated_by = $10, updated_at = now()
        WHERE organization_id = $1 AND id = $11 AND status = 'active' RETURNING id`, [...values, input.id])).rows[0];
    if (!row) throw new CompanyProfileError(404, "That bank account was not found.", "COMPANY_BANK_NOT_FOUND");
  } else {
    row = (await client.query(
      `INSERT INTO tenant.company_bank_accounts (organization_id, account_name, bank_name, account_number, ifsc, branch, account_type, is_default, show_on_documents, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`, values)).rows[0];
  }
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.bank_account.saved", entityType: "company_bank_account", entityId: row.id,
    metadata: { bankName, ifsc, accountEnding: accountNumber.slice(-4) } });
  return listCompanyBankAccounts(client, session.organizationId);
}

export async function removeCompanyBankAccount(client, session, id) {
  requireSessionPermission(session, "organization.manage");
  const removed = (await client.query(
    `UPDATE tenant.company_bank_accounts SET status = 'inactive', is_default = false, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 AND status = 'active' RETURNING id`,
    [session.organizationId, id, session.userId])).rows[0];
  if (!removed) throw new CompanyProfileError(404, "That bank account was not found.", "COMPANY_BANK_NOT_FOUND");
  // The oldest remaining account becomes the default, so documents always have one to print.
  await client.query(
    `UPDATE tenant.company_bank_accounts SET is_default = true WHERE id = (SELECT id FROM tenant.company_bank_accounts WHERE organization_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM tenant.company_bank_accounts WHERE organization_id = $1 AND status = 'active' AND is_default)`, [session.organizationId]);
  return listCompanyBankAccounts(client, session.organizationId);
}
