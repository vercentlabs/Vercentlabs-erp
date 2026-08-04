import { z } from "zod";
import { passwordSchema } from "@/lib/password-policy";

const email = z.string().trim().toLowerCase().email().max(254);
const uuid = z.string().uuid();
const code = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((value) => value.toUpperCase());
const status = z.enum(["active", "inactive"]);

function booleanInput(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (value === undefined || value === null || value === "")
        return undefined;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return value;
      }
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
      }
      return value;
    }, z.boolean())
    .default(defaultValue);
}

function passwordsMatch<
  T extends { password: string; confirmPassword: string },
>(value: T, context: z.RefinementCtx) {
  if (value.password !== value.confirmPassword) {
    context.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match.",
    });
  }
}

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    email,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export const forgotPasswordSchema = z.object({ email });
export const resendVerificationSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(500),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(500),
});

export const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  legalCompanyName: z.string().trim().min(2).max(160),
  companyCode: code,
  branchName: z.string().trim().min(2).max(120),
  branchCode: code,
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  timezone: z.string().trim().min(3).max(80),
  baseCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});

const accessPeriodSchema = {
  accessStartsAt: z.string().datetime({ offset: true }).optional().nullable(),
  accessExpiresAt: z.string().datetime({ offset: true }).optional().nullable(),
};

export const invitationSchema = z
  .object({
    email,
    roleIds: z.array(uuid).min(1).max(12),
    primaryRoleId: uuid,
    companyIds: z.array(uuid).max(100).optional().default([]),
    branchIds: z.array(uuid).max(300).optional().default([]),
    departmentIds: z.array(uuid).max(300).optional().default([]),
    teamIds: z.array(uuid).max(300).optional().default([]),
    acknowledgeWarningConflicts: booleanInput(false),
    ...accessPeriodSchema,
  })
  .superRefine((value, context) => {
    if (!value.roleIds.includes(value.primaryRoleId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryRoleId"],
        message: "Primary role must be included in selected roles.",
      });
    }
    if (
      value.accessStartsAt &&
      value.accessExpiresAt &&
      new Date(value.accessExpiresAt) <= new Date(value.accessStartsAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessExpiresAt"],
        message: "Access expiry must be after the start date.",
      });
    }
  });

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(500),
  fullName: z.string().trim().max(100).optional().default(""),
  password: z.string().min(1).max(128),
  confirmPassword: z.string().optional().default(""),
});

export const contextSchema = z.object({
  companyId: uuid,
  branchId: uuid.nullable(),
});

export const organizationContextSchema = z.object({
  organizationId: uuid,
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  timezone: z.string().trim().min(3).max(80),
  baseCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});

export const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(160),
  code,
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  baseCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  taxId: z.string().trim().max(80).optional().default(""),
  status: status.default("active"),
});

export const branchSchema = z.object({
  companyId: uuid,
  name: z.string().trim().min(2).max(120),
  code,
  timezone: z.string().trim().min(3).max(80),
  status: status.default("active"),
});

export const departmentSchema = z.object({
  companyId: uuid.nullable().optional(),
  branchId: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(120),
  code,
  status: status.default("active"),
});

export const teamSchema = z.object({
  departmentId: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(120),
  code,
  status: status.default("active"),
});

export const costCenterSchema = z.object({
  companyId: uuid.nullable().optional(),
  departmentId: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(120),
  code,
  status: status.default("active"),
});

export const numberingSeriesSchema = z.object({
  entityType: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_]+$/),
  prefix: z.string().trim().min(1).max(24),
  nextNumber: z.coerce.number().int().positive(),
  padding: z.coerce.number().int().min(1).max(12),
  fiscalYearReset: booleanInput(false),
  status: status.default("active"),
});

export const userAccessSchema = z
  .object({
    status: z.enum(["active", "disabled"]),
    roleIds: z.array(uuid).min(1).max(12),
    primaryRoleId: uuid,
    companyIds: z.array(uuid).max(100),
    branchIds: z.array(uuid).max(300),
    departmentIds: z.array(uuid).max(300),
    teamIds: z.array(uuid).max(300),
    reason: z.string().trim().min(3).max(500),
    acknowledgeWarningConflicts: booleanInput(false),
    ...accessPeriodSchema,
  })
  .superRefine((value, context) => {
    if (!value.roleIds.includes(value.primaryRoleId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryRoleId"],
        message: "Primary role must be included in selected roles.",
      });
    }
    if (
      value.accessStartsAt &&
      value.accessExpiresAt &&
      new Date(value.accessExpiresAt) <= new Date(value.accessStartsAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessExpiresAt"],
        message: "Access expiry must be after the start date.",
      });
    }
  });

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_]+$/),
  description: z.string().trim().max(500).default(""),
  moduleKey: z.enum(["platform", "crm", "sales", "accounting", "procurement"]),
  riskLevel: z.enum(["standard", "sensitive", "privileged"]),
  permissionKeys: z.array(z.string().min(2).max(100)).max(160),
  acknowledgeWarningConflicts: booleanInput(false),
});

export const invitationActionSchema = z.object({
  action: z.enum(["resend", "revoke"]),
});
export const notificationActionSchema = z.object({
  id: uuid.optional(),
  action: z.enum(["read", "read-all"]),
});
export const sessionActionSchema = z.object({
  sessionId: uuid.optional(),
  action: z.enum(["revoke", "revoke-others"]),
});

export const resourceSchemas = {
  organization: organizationSchema,
  companies: companySchema,
  branches: branchSchema,
  departments: departmentSchema,
  teams: teamSchema,
  "cost-centres": costCenterSchema,
  "numbering-series": numberingSeriesSchema,
} as const;

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  locale: z.string().trim().min(2).max(20),
  timezone: z.string().trim().min(3).max(80),
  theme: z.enum(["system", "light", "dark"]),
});

export const approvalDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional().default(""),
  expectedVersion: z.number().int().positive(),
});

export const moduleStatusSchema = z.object({
  status: z.enum(["registered", "enabled", "disabled"]),
});
