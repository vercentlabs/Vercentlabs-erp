import assert from "node:assert/strict";
import test from "node:test";

import { listHrPayrollResource, createEmployee } from "../src/modules/hr-payroll/index.js";
import { listSupportResource } from "../src/modules/support/index.js";
import {
  listProcurementRecords,
  getProcurementRecord,
  createProcurementRecord,
  updateProcurementRecord,
} from "../src/modules/procurement/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";

function baseContext(permissions) {
  return {
    organizationId: org,
    companyId: company,
    userId: user,
    roleSlugs: [],
    permissions,
  };
}

const privilegedHr = baseContext(["hr_payroll.view", "hr_payroll.employee.manage", "hr_payroll.sensitive.view"]);
const restrictedHr = baseContext(["hr_payroll.view", "hr_payroll.employee.manage"]);

const employeeRow = {
  id: "44444444-4444-4444-8444-444444444444",
  organization_id: org,
  company_id: company,
  first_name: "Asha",
  last_name: "Rao",
  work_email: "asha.rao@example.com",
  personal_email: "asha@example.com",
  personal_phone: "+91-90000-00000",
  date_of_birth: "1990-01-01",
  gender: "female",
  marital_status: "single",
  nationality: "IN",
  address: { city: "Pune" },
  bank_details: { accountNumber: "0000111122223333" },
  tax_identifiers: { pan: "ABCDE1234F" },
  statutory_identifiers: { uan: "100200300400" },
  emergency_contacts: [{ name: "Ravi Rao", phone: "+91-90000-00001" }],
};

function hrClient() {
  return {
    async query(sql) {
      if (/INSERT INTO tenant\.document_sequences/.test(sql)) {
        return {
          rows: [{
            allocated_value: "1",
            prefix: "EMP",
            padding: 6,
          }],
        };
      }
      if (/INSERT INTO tenant\.hr_employees/.test(sql)) return { rows: [employeeRow] };
      if (/INSERT INTO tenant\.hr_payroll_events/.test(sql)) return { rows: [] };
      if (/SELECT record\.\* FROM tenant\.hr_employees/.test(sql)) return { rows: [employeeRow] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("HR: privileged role reads all employee fields via list", async () => {
  const rows = await listHrPayrollResource(hrClient(), privilegedHr, "employees", {});
  assert.equal(rows[0].personal_email, "asha@example.com");
  assert.equal(rows[0].bank_details.accountNumber, "0000111122223333");
});

test("HR: restricted role cannot read protected employee fields via list", async () => {
  const rows = await listHrPayrollResource(hrClient(), restrictedHr, "employees", {});
  assert.equal(rows[0].first_name, "Asha");
  for (const field of [
    "personal_email",
    "personal_phone",
    "date_of_birth",
    "gender",
    "marital_status",
    "nationality",
    "address",
    "bank_details",
    "tax_identifiers",
    "statutory_identifiers",
    "emergency_contacts",
  ]) {
    assert.equal(field in rows[0], false, `expected ${field} to be omitted`);
  }
});

test("HR: restricted role cannot read protected fields echoed back from create (secondary response path)", async () => {
  const created = await createEmployee(hrClient(), restrictedHr, {
    firstName: "Asha",
    lastName: "Rao",
    employmentType: "permanent",
    joiningDate: "2026-01-01",
  });
  assert.equal("bank_details" in created, false);
  assert.equal("personal_email" in created, false);
});

test("HR: privileged role still sees protected fields echoed back from create", async () => {
  const created = await createEmployee(hrClient(), privilegedHr, {
    firstName: "Asha",
    lastName: "Rao",
    employmentType: "permanent",
    joiningDate: "2026-01-01",
  });
  assert.equal(created.bank_details.accountNumber, "0000111122223333");
});

const privilegedSupport = baseContext(["support.view", "support.sensitive.view"]);
const restrictedSupport = baseContext(["support.view"]);

const publicCommunication = {
  id: "55555555-5555-4555-8555-555555555555",
  ticket_id: "66666666-6666-4666-8666-666666666666",
  body: "We received your request.",
  private_note: false,
};
const privateCommunication = {
  id: "77777777-7777-4777-8777-777777777777",
  ticket_id: "66666666-6666-4666-8666-666666666666",
  body: "Escalating to L2 — customer is a churn risk.",
  private_note: true,
};

function supportClient() {
  return {
    async query(sql) {
      if (/SELECT record\.\* FROM tenant\.support_communications/.test(sql)) {
        return { rows: [publicCommunication, privateCommunication] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("Support: privileged role sees internal/private communications in list", async () => {
  const rows = await listSupportResource(supportClient(), privilegedSupport, "communications", {});
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.private_note === true));
});

test("Support: restricted role cannot see internal/private communications in list (bulk/list bypass prevention)", async () => {
  const rows = await listSupportResource(supportClient(), restrictedSupport, "communications", {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].private_note, false);
});

const privilegedProcurement = baseContext([
  "procurement.suppliers.view",
  "procurement.suppliers.manage",
  "procurement.suppliers.sensitive",
]);
const restrictedProcurement = baseContext([
  "procurement.suppliers.view",
  "procurement.suppliers.manage",
]);

const supplierRow = {
  id: "88888888-8888-4888-8888-888888888888",
  organization_id: org,
  company_id: company,
  status: "active",
  version: 1,
  data: {
    legalName: "Acme Supplies",
    supplierCode: "SUP-001",
    taxRegistrationNumber: "GST-123456",
    bankAccountNumber: "9999888877776666",
    bankName: "Example Bank",
  },
};

function procurementClient({ selectRow = supplierRow } = {}) {
  return {
    async query(sql) {
      if (/SELECT count\(\*\)::int AS total FROM tenant\.procurement_suppliers/.test(sql)) {
        return { rows: [{ total: 1 }] };
      }
      if (/SELECT \* FROM tenant\.procurement_suppliers WHERE organization_id=\$1 AND id=\$2/.test(sql)) {
        return { rows: [selectRow] };
      }
      if (/SELECT \* FROM tenant\.procurement_suppliers WHERE/.test(sql)) {
        return { rows: [selectRow] };
      }
      if (/FROM tenant\.procurement_supplier_(sites|qualifications|certifications|scorecards)/.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("Procurement: privileged role reads supplier banking fields via list and detail", async () => {
  const list = await listProcurementRecords(procurementClient(), privilegedProcurement, "suppliers", {});
  assert.equal(list.rows[0].bankAccountNumber, "9999888877776666");
  const detail = await getProcurementRecord(procurementClient(), privilegedProcurement, "suppliers", supplierRow.id);
  assert.equal(detail.bankAccountNumber, "9999888877776666");
  // taxRegistrationNumber was never gated — confirms the scoping decision is additive, not a new restriction on existing data.
  assert.equal(detail.taxRegistrationNumber, "GST-123456");
});

test("Procurement: restricted role cannot read supplier banking fields via list or detail (IDOR-adjacent field leak closed)", async () => {
  const list = await listProcurementRecords(procurementClient(), restrictedProcurement, "suppliers", {});
  assert.equal("bankAccountNumber" in list.rows[0], false);
  assert.equal("bankName" in list.rows[0], false);
  assert.equal(list.rows[0].taxRegistrationNumber, "GST-123456");
  const detail = await getProcurementRecord(procurementClient(), restrictedProcurement, "suppliers", supplierRow.id);
  assert.equal("bankAccountNumber" in detail, false);
});

test("Procurement: restricted role cannot set supplier banking fields on create (mass-assignment write bypass closed)", async () => {
  await assert.rejects(
    createProcurementRecord(procurementClient(), restrictedProcurement, "suppliers", {
      legalName: "New Supplier",
      supplierCode: "SUP-002",
      bankAccountNumber: "1234567890123456",
    }),
    (error) => error.code === "PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN" && error.status === 403,
  );
});

test("Procurement: restricted role cannot set supplier banking fields on update, but ordinary field updates are unaffected", async () => {
  await assert.rejects(
    updateProcurementRecord(procurementClient(), restrictedProcurement, "suppliers", supplierRow.id, {
      expectedVersion: 1,
      bankIfscCode: "EXMP0001234",
    }),
    (error) => error.code === "PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN",
  );
});

test("Procurement: privileged role's sensitive-field write is not blocked by the permission gate (allow case)", async () => {
  // The mock client only implements SELECT handlers, so a privileged create/update payload
  // that clears the field-permission gate will fail later at the (unmocked) INSERT — proving
  // the gate itself did not fire for this caller, without needing to mock the full document
  // creation pipeline (numbering, reference validation, child inserts, outbox, audit event).
  await assert.rejects(
    createProcurementRecord(procurementClient(), privilegedProcurement, "suppliers", {
      legalName: "New Supplier",
      supplierCode: "SUP-002",
      bankAccountNumber: "1234567890123456",
    }),
    (error) => error.code !== "PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN",
  );
});

test("Procurement: restricted role can still update a supplier when the payload does not touch sensitive fields", async () => {
  // Same technique as above: reaching the unmocked INSERT/UPDATE query (rather than a
  // PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN rejection) proves ordinary, non-sensitive updates
  // are unaffected by the new gate — the backward-compatibility requirement from Part 8.
  await assert.rejects(
    updateProcurementRecord(procurementClient(), restrictedProcurement, "suppliers", supplierRow.id, {
      expectedVersion: 1,
      paymentTerms: "NET_30",
    }),
    (error) => error.code !== "PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN",
  );
});
