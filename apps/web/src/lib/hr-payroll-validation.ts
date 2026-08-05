import { z } from "zod";

const uuid = z.string().uuid();

export const employeeCreateSchema = z.object({
  employeeNumber: z.string().max(100).optional(),
  userId: uuid.nullish(),
  branchId: uuid.nullish(),
  firstName: z.string().trim().min(1).max(100),
  middleName: z.string().max(100).nullish(),
  lastName: z.string().trim().min(1).max(100),
  preferredName: z.string().max(100).nullish(),
  workEmail: z.string().email().nullish(),
  personalEmail: z.string().email().nullish(),
  workPhone: z.string().max(50).nullish(),
  personalPhone: z.string().max(50).nullish(),
  dateOfBirth: z.string().date().nullish(),
  gender: z.string().max(50).nullish(),
  maritalStatus: z.string().max(50).nullish(),
  nationality: z.string().max(100).nullish(),
  address: z.record(z.string(), z.unknown()).default({}),
  departmentId: uuid.nullish(),
  designationId: uuid.nullish(),
  managerEmployeeId: uuid.nullish(),
  employmentType: z.enum([
    "permanent",
    "contract",
    "intern",
    "consultant",
    "part_time",
    "temporary",
  ]),
  joiningDate: z.string().date(),
  probationEndDate: z.string().date().nullish(),
  confirmationDate: z.string().date().nullish(),
  bankDetails: z.record(z.string(), z.unknown()).default({}),
  taxIdentifiers: z.record(z.string(), z.unknown()).default({}),
  statutoryIdentifiers: z.record(z.string(), z.unknown()).default({}),
  emergencyContacts: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const leaveRequestCreateSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  startDate: z.string().date(),
  endDate: z.string().date(),
  days: z.coerce.number().positive(),
  reason: z.string().max(2000).nullish(),
  attachmentReference: z.string().max(500).nullish(),
});

export const leaveActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).nullish(),
});

export const payrollRunCreateSchema = z.object({
  branchId: uuid.nullish(),
  payrollNumber: z.string().max(100).optional(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  paymentDate: z.string().date(),
});

export const payrollActionSchema = z.object({
  action: z.enum(["calculate", "submit", "approve", "post", "cancel"]),
  accountingBatchId: uuid.nullish(),
});
