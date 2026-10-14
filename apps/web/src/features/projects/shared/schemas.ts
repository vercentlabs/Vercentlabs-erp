import { z } from "zod";

// The fields of a project as a request carries them (create and edit).
export const projectFields = {
  name: z.string().max(300).nullable().optional(), description: z.string().max(10000).nullable().optional(), classification: z.enum(["INTERNAL", "CUSTOMER"]).optional(),
  projectTypeId: z.string().uuid().nullable().optional(), customerId: z.string().uuid().nullable().optional(), crmAccountId: z.string().uuid().nullable().optional(), customerContactId: z.string().uuid().nullable().optional(),
  managerUserId: z.string().uuid().nullable().optional(), plannedStartDate: z.string().max(10).nullable().optional(), targetEndDate: z.string().max(10).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), tags: z.array(z.string().max(40)).max(20).optional(), templateId: z.string().uuid().nullable().optional(),
  templateName: z.string().max(200).nullable().optional(),
};

// A project site's address: one of the customer's addresses, or typed for the project.
export const siteFields = {
  sourceAddressId: z.string().uuid().nullable().optional(), line1: z.string().max(200).optional(), line2: z.string().max(200).nullable().optional(), city: z.string().max(80).optional(),
  district: z.string().max(80).nullable().optional(), state: z.string().max(80).nullable().optional(), stateCode: z.string().max(4).nullable().optional(),
  postalCode: z.string().max(12).nullable().optional(), countryCode: z.string().max(2).optional(), isPrimary: z.boolean().optional(),
};
